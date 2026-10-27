import fp from "fastify-plugin";
import { jwtVerify, errors as joseErrors, type JWTVerifyGetKey } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError, ForbiddenError, ServiceUnavailableError } from "../errors.js";
import type { UserRecord, UserRepo } from "../db/user-repo.js";

export interface AuthOptions {
  getKey: JWTVerifyGetKey;
  issuer: string;
  audience: string;
  userRepo: UserRepo;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: UserRecord | null;
  }
}

export const authPlugin = fp<AuthOptions>(
  (app, opts) => {
    app.decorateRequest("user", null);

    app.decorate("authenticate", async (req: FastifyRequest) => {
      // Both the global fail-closed hook (plugins/require-auth.ts) and a
      // route's own preHandler call this. Verifying twice would mean two JWT
      // verifications and two findByExternalId round-trips per request, which
      // bears directly on NFR-1 (p95 < 250 ms at 50 RPS) and NFR-2's burst
      // target. req.user is per-request state, so an already-populated value
      // means this request has already authenticated successfully.
      //
      // A FAILED authentication throws, so it never reaches this line — there
      // is no path where a rejected request is later treated as authenticated.
      if (req.user !== null) return;

      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        throw new UnauthorizedError("No bearer token was supplied.");
      }
      const token = header.slice("Bearer ".length);

      let oid: unknown;
      let email: unknown;
      // The key-getter is a separate failure domain from the token. A JWKS
      // endpoint outage is OUR fault (5xx); an unverifiable token is the
      // caller's (401). One catch around both reports an outage as "your token
      // is invalid", which is actively misleading during an incident.
      let keyRetrievalFailed = false;
      const trackingGetKey: JWTVerifyGetKey = async (protectedHeader, input) => {
        try {
          return await opts.getKey(protectedHeader, input);
        } catch (cause) {
          // A kid that matches no published key is the TOKEN's problem, not
          // ours: jose raises this from the key-getter only AFTER attempting a
          // refetch, so the endpoint is demonstrably reachable. Treating it as
          // an outage would report a forged token as 503 "please retry",
          // masking an attack and emitting 5xx for a caller error (NFR-2).
          if (
            !(
              cause instanceof joseErrors.JWKSNoMatchingKey ||
              cause instanceof joseErrors.JWKSMultipleMatchingKeys
            )
          ) {
            keyRetrievalFailed = true;
          }
          throw cause;
        }
      };

      try {
        const { payload } = await jwtVerify(token, trackingGetKey, {
          issuer: opts.issuer,
          audience: opts.audience,
          // Entra signs with RS256. Stating it means the accepted set is a
          // decision in the code rather than whatever jose defaults to —
          // the control you want written down before Plan 3 points this at a
          // real tenant, not one inferred from jose rejecting `alg: none`.
          algorithms: ["RS256"],
          // Zero tolerance is the default, so ordinary skew between Entra's
          // clock and the container's produces spurious 401s on freshly
          // issued tokens.
          clockTolerance: "60s",
        });
        oid = payload.oid;
        email = payload.email;
      } catch (cause) {
        if (keyRetrievalFailed) {
          req.log.error({ err: cause }, "JWKS key retrieval failed");
          throw new ServiceUnavailableError(
            "Could not retrieve the signing keys needed to verify your session. Please retry.",
          );
        }
        // Malformed, bad signature, wrong issuer/audience, or expired.
        throw new UnauthorizedError("The bearer token is invalid or has expired.");
      }

      if (typeof oid !== "string" || oid.length === 0) {
        throw new UnauthorizedError("The token is missing the oid claim.");
      }

      let user = await opts.userRepo.findByExternalId(oid);
      // ADR-0036: a miss here is the common case for a legitimately
      // registered person's FIRST sign-in — registration no longer asks an
      // Admin to supply externalId, so the row starts with it unset. Bind it
      // now, by email, rather than 403ing someone an Admin already
      // registered. Every later request for this person hits the line
      // above instead, so this fallback runs at most once per person.
      if (!user) {
        if (typeof email === "string" && email.length > 0) {
          user = await opts.userRepo.bindExternalId(email, oid);
        }
      }
      if (!user) throw new ForbiddenError(); // spec §7: valid token, no record → 403
      req.user = user;
    });
  },
  { name: "auth", dependencies: ["problem-details"] },
);

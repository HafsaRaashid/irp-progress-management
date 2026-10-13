import { describe, it, expect, beforeAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { JWTVerifyGetKey } from "jose";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { createTracerProvider, tracingPlugin } from "../src/telemetry.js";
import { problemDetailsPlugin } from "../src/plugins/problem-details.js";
import { authPlugin } from "../src/plugins/auth.js";
import { fakeUserRepo } from "./helpers/fake-user-repo.js";
import { getLocalKeySet, signToken, signExpiredToken, testIssuer, testAudience } from "./helpers/keys.js";

interface ProtectedResponse { email: string; }

let getKey: JWTVerifyGetKey;
beforeAll(async () => { getKey = await getLocalKeySet(); });

async function buildApp() {
  const app = Fastify();
  await app.register(tracingPlugin, { tracerProvider: createTracerProvider(new InMemorySpanExporter()) });
  await app.register(problemDetailsPlugin);
  await app.register(authPlugin, {
    getKey, issuer: testIssuer, audience: testAudience,
    userRepo: fakeUserRepo([
      { id: "u1", externalId: "oid-1", email: "a@bistecglobal.com", displayName: "Amaya", role: "STUDENT" },
      // Pending registrations (ADR-0035): externalId unset, awaiting first sign-in.
      { id: "u2", externalId: null, email: "pending.bind@bistecglobal.com", displayName: "Nuwan", role: "STUDENT" },
      { id: "u3", externalId: null, email: "pending.case@bistecglobal.com", displayName: "Sachini", role: "STUDENT" },
      // Already bound to a DIFFERENT oid under the same email -- models a
      // reused email (e.g. Entra repointing a departed person's address).
      { id: "u4", externalId: "already-bound-oid", email: "reused@bistecglobal.com", displayName: "Kavindu", role: "STUDENT" },
      { id: "u5", externalId: null, email: "pending.noemail@bistecglobal.com", displayName: "Ishara", role: "STUDENT" },
    ]),
  });
  app.get("/protected", { preHandler: [app.authenticate] }, (req) => ({ email: req.user!.email }));
  return app;
}

function bearer(t: string) { return { authorization: `Bearer ${t}` }; }

describe("auth", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });

  it("accepts a valid token and attaches the user", async () => {
    const res = await app.inject({ method: "GET", url: "/protected", headers: bearer(await signToken({ oid: "oid-1" })) });
    expect(res.statusCode).toBe(200);
    expect(res.json<ProtectedResponse>().email).toBe("a@bistecglobal.com");
  });

  it("rejects a missing Authorization header with 401", async () => {
    expect((await app.inject({ method: "GET", url: "/protected" })).statusCode).toBe(401);
  });

  it("rejects an expired token with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/protected", headers: bearer(await signExpiredToken()) });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong-audience token with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/protected", headers: bearer(await signToken({ audience: "api://someone-else" })) });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a valid token whose oid has no user record with 403 (spec §7)", async () => {
    const res = await app.inject({ method: "GET", url: "/protected", headers: bearer(await signToken({ oid: "unknown-oid" })) });
    expect(res.statusCode).toBe(403);
  });

  // ADR-0035: on an oid miss, a registered-but-never-signed-in row binds to
  // the token's oid, matched by its email claim, instead of 403ing someone
  // an Admin already registered.
  describe("just-in-time oid binding (ADR-0035)", () => {
    it("binds a pending registration's externalId on first sign-in, by email", async () => {
      const first = await app.inject({
        method: "GET",
        url: "/protected",
        headers: bearer(await signToken({ oid: "fresh-oid-1", email: "pending.bind@bistecglobal.com" })),
      });
      expect(first.statusCode).toBe(200);
      expect(first.json<ProtectedResponse>().email).toBe("pending.bind@bistecglobal.com");

      // The bind is permanent: a later request for the same oid no longer
      // needs the email claim at all -- it hits findByExternalId directly.
      const second = await app.inject({
        method: "GET",
        url: "/protected",
        headers: bearer(await signToken({ oid: "fresh-oid-1" })),
      });
      expect(second.statusCode).toBe(200);
      expect(second.json<ProtectedResponse>().email).toBe("pending.bind@bistecglobal.com");
    });

    it("matches the email claim case-insensitively", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: bearer(await signToken({ oid: "fresh-oid-2", email: "PENDING.CASE@BistecGlobal.com" })),
      });
      expect(res.statusCode).toBe(200);
    });

    it("never rebinds a row whose externalId is already set, even under a reused email", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: bearer(await signToken({ oid: "new-hire-oid", email: "reused@bistecglobal.com" })),
      });
      // Not the already-bound row's 200, and not a silent hijack -- the
      // same opaque 403 as any other unregistered sign-in (spec §7).
      expect(res.statusCode).toBe(403);
    });

    it("does not attempt a bind when the token carries no email claim", async () => {
      // signToken's default omits `email` entirely. Asserting the 403
      // alone would only prove this oid matched nothing -- it says nothing
      // about whether a bind was attempted. Follow up with a second
      // request that DOES carry "pending.noemail@bistecglobal.com" and
      // confirm it still binds cleanly: that proves the first request left
      // the row untouched, not that it happened to match nothing either way.
      const first = await app.inject({
        method: "GET",
        url: "/protected",
        headers: bearer(await signToken({ oid: "no-email-oid" })),
      });
      expect(first.statusCode).toBe(403);

      const second = await app.inject({
        method: "GET",
        url: "/protected",
        headers: bearer(await signToken({ oid: "later-oid", email: "pending.noemail@bistecglobal.com" })),
      });
      expect(second.statusCode).toBe(200);
    });
  });
});

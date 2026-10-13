import type { FastifyPluginAsync } from "fastify";
import { civilDate } from "@irp/core";
import type { components } from "@irp/types";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { UserRepo, UserRecord } from "../db/user-repo.js";
import type { BatchRepo } from "../db/batch-repo.js";
import { toDbDate } from "../db/civil-date-map.js";
import { BatchNotFoundError, DuplicateUserError, EnrolmentRequiredError } from "../domain/errors.js";
import { requireAdmin } from "../plugins/roles.js";
import { ROLE_TO_API } from "./me.js";
import { USER_CREATE_BODY, USERS_QUERY } from "./schemas.js";

type ApiUserDetail = components["schemas"]["UserDetail"];
type ApiRole = components["schemas"]["Role"];

// The inverse of `ROLE_TO_API` (me.ts, reused below rather than duplicated) —
// a Record, not a ternary, for the same exhaustiveness reason: widening
// either union without adding a case here is a type error, not a silent
// fallthrough.
const API_ROLE_TO_DB: Record<ApiRole, UserRecord["role"]> = {
  Admin: "ADMIN",
  Student: "STUDENT",
};

function toApiUserDetail(record: UserRecord & { deletedAt: Date | null }): ApiUserDetail {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    // Reuses me.ts's DB->API mapping rather than a local ternary — the same
    // exhaustiveness guarantee `ROLE_TO_API` exists for, not duplicated here.
    role: ROLE_TO_API[record.role],
    archived: record.deletedAt !== null,
  };
}

// Same local guard Task 1 established (batch-repo.ts, absence-repo.ts,
// user-repo.ts) — needed again here because the atomic student-registration
// path below bypasses UserRepo.create and calls prisma.user.create directly
// inside the transaction.
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export const userRoutes: FastifyPluginAsync<{
  userRepo: UserRepo;
  batchRepo: BatchRepo;
  // Registration of a student creates the user and its initial enrolment
  // atomically (FR-3/FR-8): if the enrolment insert fails, the user insert
  // must not survive. That is the *only* reason this plugin is handed the
  // raw Prisma client rather than only the two repositories above — a
  // cross-repo transaction seam (e.g. a shared `withTransaction` abstraction
  // spanning UserRepo and BatchRepo) is not worth building for this single
  // call site. Every other operation in this file goes through the repos.
  prisma: PrismaClient;
  // eslint-disable-next-line @typescript-eslint/require-await
}> = async (app, opts) => {
  app.post<{ Body: components["schemas"]["UserCreate"] }>(
    "/api/v1/users",
    { schema: { body: USER_CREATE_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiUserDetail> => {
      requireAdmin(req);
      const dbRole = API_ROLE_TO_DB[req.body.role];
      const enrolment = req.body.enrolment;

      if (dbRole === "STUDENT" && enrolment === undefined) {
        throw new EnrolmentRequiredError("A student registration requires an initial enrolment.");
      }
      if (dbRole === "ADMIN" && enrolment !== undefined) {
        throw new EnrolmentRequiredError("A mentor registration must not carry an enrolment.");
      }

      const userInput = {
        // Spread, not a plain key: with exactOptionalPropertyTypes, an
        // explicit `externalId: undefined` is not the same type as the key
        // being absent (same reasoning as the GET handler's `role` spread
        // below). externalId is normally omitted entirely (ADR-0035) and
        // binds itself to the real oid on first sign-in.
        ...(req.body.externalId === undefined ? {} : { externalId: req.body.externalId }),
        email: req.body.email,
        displayName: req.body.displayName,
        role: dbRole,
      };

      if (enrolment === undefined) {
        const created = await opts.userRepo.create(userInput);
        return toApiUserDetail({ ...created, deletedAt: null });
      }

      // Resolve the batch BEFORE the transaction: a 404 for an unknown
      // batchId should never open (and then have to unwind) a transaction.
      const batch = await opts.batchRepo.getBatch(enrolment.batchId);
      if (!batch) throw new BatchNotFoundError(enrolment.batchId);
      const startDate = toDbDate(civilDate(enrolment.startDate));

      try {
        const created = await opts.prisma.$transaction(async (tx) => {
          const user = await tx.user.create({ data: userInput });
          await tx.enrolment.create({
            data: { studentId: user.id, batchId: enrolment.batchId, startDate },
          });
          return user;
        });
        return toApiUserDetail({
          id: created.id,
          externalId: created.externalId,
          email: created.email,
          displayName: created.displayName,
          role: created.role,
          deletedAt: created.deletedAt,
        });
      } catch (err) {
        // Only user.create's externalId/email unique constraints can fire
        // here in practice: enrolment.create's partial unique index scopes
        // to *open* enrolments per studentId, and studentId is the id just
        // minted inside this same transaction — a brand-new id can never
        // collide with an existing open enrolment. This branch is defensive
        // for that side, not covered by a test that could reach it.
        if (isUniqueViolation(err)) throw new DuplicateUserError(req.body.email);
        throw err;
      }
    },
  );

  app.get<{ Querystring: { role?: ApiRole; archived?: boolean } }>(
    "/api/v1/users",
    { schema: { querystring: USERS_QUERY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiUserDetail[]> => {
      requireAdmin(req);
      const archived = req.query.archived ?? false;
      // Built with a spread, not `{ role, archived }`: with
      // `exactOptionalPropertyTypes`, an explicit `role: undefined` is not the
      // same type as the key being absent, and `UserRepo.list`'s optional
      // `role?` requires the latter.
      const users = await opts.userRepo.list({
        ...(req.query.role === undefined ? {} : { role: API_ROLE_TO_DB[req.query.role] }),
        archived,
      });
      return users.map(toApiUserDetail);
    },
  );
};

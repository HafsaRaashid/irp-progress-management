import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { DuplicateUserError } from "../domain/errors.js";

// Same local guard Task 1 established (batch-repo.ts, absence-repo.ts) —
// not worth a shared helper for a single-line predicate used by three files.
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export interface UserRecord {
  id: string;
  // Null until this person's first successful sign-in (ADR-0035) — bound
  // automatically by email, never typed in at registration.
  externalId: string | null;
  email: string;
  displayName: string;
  // Mirrors the generated Prisma `Role` enum. Unlike the DayStatus duplication in
  // handoff.md §3, this one is compiler-checked: `role: u.role` below is assigned
  // against this interface, so a third Role member would fail typecheck, not drift.
  role: "ADMIN" | "STUDENT";
}

export interface UserRepo {
  findByExternalId(externalId: string): Promise<UserRecord | null>;
  // Unfiltered by deletedAt, unlike findByExternalId — includes archived
  // users. Callers decide whether an archived user is acceptable for their
  // purpose (e.g. reviews.ts still rejects a non-STUDENT role, but does not
  // reject an archived one; FR-5 hiding is a login-time concern, not this
  // lookup's).
  findById(id: string): Promise<(UserRecord & { deletedAt: Date | null }) | null>;
  // P2002 (externalId or email unique constraint) maps to DuplicateUserError.
  // externalId is optional (ADR-0035): registration normally omits it and
  // leaves the row pending until bindExternalId claims it on first sign-in.
  create(input: {
    externalId?: string;
    email: string;
    displayName: string;
    role: "ADMIN" | "STUDENT";
  }): Promise<UserRecord>;
  // ADR-0035: on an oid miss, bind by email instead of asking a human to
  // transcribe externalId at registration. Matches case-insensitively (the
  // email index is defined the same way — see schema.prisma), and only ever
  // claims a row that is still pending (externalId IS NULL) and not
  // archived; an already-bound row, or no matching row at all, returns null
  // and the caller falls through to its existing "no record" handling. A
  // single UPDATE ... RETURNING keeps the claim atomic — two
  // near-simultaneous first sign-ins can race, but at most one updates a row.
  bindExternalId(email: string, externalId: string): Promise<UserRecord | null>;
  // `archived: false` -> deletedAt: null (active, the default); `archived:
  // true` -> deletedAt != null (the FR-5 archive view). `role` narrows
  // further when supplied.
  list(filter: { role?: "ADMIN" | "STUDENT"; archived: boolean }): Promise<(UserRecord & { deletedAt: Date | null })[]>;
  // FR-5: soft archive. Idempotent by construction — the `updateMany` only
  // matches a row still `deletedAt: null`, so a repeat call touches zero
  // rows and still resolves successfully rather than erroring.
  archive(id: string, now: Date): Promise<void>;
  // FR-5: the inverse of archive. Idempotent the same way and for the same
  // reason — the `updateMany` only matches a row that is currently archived,
  // so restoring an active user touches zero rows and still resolves.
  //
  // Takes no `now`: archive stamps a time, restore only clears one. There is
  // nothing to record, because a soft archive destroys nothing — the row and
  // all its history were always there.
  restore(id: string): Promise<void>;
}

export function createUserRepo(prisma: PrismaClient): UserRepo {
  return {
    async findByExternalId(externalId) {
      const u = await prisma.user.findFirst({
        where: { externalId, deletedAt: null }, // FR-5: soft-deleted users are hidden
      });
      if (!u) return null;
      return {
        id: u.id,
        externalId: u.externalId,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
      };
    },

    async findById(id) {
      const u = await prisma.user.findUnique({ where: { id } });
      if (!u) return null;
      return {
        id: u.id,
        externalId: u.externalId,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        deletedAt: u.deletedAt,
      };
    },

    async create(input) {
      try {
        const u = await prisma.user.create({ data: input });
        return { id: u.id, externalId: u.externalId, email: u.email, displayName: u.displayName, role: u.role };
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateUserError(input.email);
        throw err;
      }
    },

    async list(filter) {
      const rows = await prisma.user.findMany({
        where: {
          deletedAt: filter.archived ? { not: null } : null,
          ...(filter.role === undefined ? {} : { role: filter.role }),
        },
        orderBy: { displayName: "asc" },
      });
      return rows.map((u) => ({
        id: u.id, externalId: u.externalId, email: u.email,
        displayName: u.displayName, role: u.role, deletedAt: u.deletedAt,
      }));
    },

    async bindExternalId(email, externalId) {
      const rows = await prisma.$queryRaw<
        { id: string; externalId: string; email: string; displayName: string; role: "ADMIN" | "STUDENT" }[]
      >`
        UPDATE "User"
        SET "externalId" = ${externalId}
        WHERE lower("email") = lower(${email})
          AND "externalId" IS NULL
          AND "deletedAt" IS NULL
        RETURNING "id", "externalId", "email", "displayName", "role"
      `;
      const u = rows[0];
      if (u === undefined) return null;
      return { id: u.id, externalId: u.externalId, email: u.email, displayName: u.displayName, role: u.role };
    },

    async archive(id, now) {
      // Idempotent: only stamps when not already archived.
      await prisma.user.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: now },
      });
    },

    async restore(id) {
      // Idempotent: only clears when currently archived.
      await prisma.user.updateMany({
        where: { id, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
    },
  };
}

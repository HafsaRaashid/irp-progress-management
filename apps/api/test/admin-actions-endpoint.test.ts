import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { civilDate } from "@irp/core";
import { createBatchRepo } from "../src/db/batch-repo.js";
import { buildTestServer } from "./helpers/build-test-server.js";
import { resetDb } from "./helpers/db.js";
import { signToken } from "./helpers/keys.js";
import { dbUrl } from "./helpers/require-db.js";

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

const UNKNOWN_UUID = "00000000-0000-0000-0000-000000000000";

interface ProblemLike {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

interface EnrolmentLike {
  id: string;
  studentId: string;
  batchId: string;
  startDate: string;
  endDate: string | null;
}

interface UserDetailLike {
  id: string;
  email: string;
  displayName: string;
  role: "Admin" | "Student";
  archived: boolean;
}

describe.skipIf(!dbUrl)(
  "POST /api/v1/students/{id}/transfer, DELETE /api/v1/users/{id}",
  () => {
    let app: FastifyInstance;
    let prisma: Awaited<ReturnType<typeof buildTestServer>>["prisma"];

    beforeAll(async () => {
      ({ app, prisma } = await buildTestServer(dbUrl!));
    });
    beforeEach(async () => {
      await resetDb(prisma);
    });
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });

    async function mentor(externalId: string) {
      return prisma.user.create({
        data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "ADMIN" },
      });
    }

    async function student(externalId: string) {
      return prisma.user.create({
        data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "STUDENT" },
      });
    }

    async function batch(name: string) {
      return createBatchRepo(prisma).create({
        name,
        startDate: civilDate("2026-05-10"),
        endDate: civilDate("2026-11-09"),
      });
    }

    // ---- transferStudent ----

    it("transfers a student: old enrolment ends effectiveDate-1, response is the new open enrolment", async () => {
      await mentor("transfer-admin-1");
      const from = await batch("Batch Transfer From 1");
      const to = await batch("Batch Transfer To 1");
      const s = await student("transfer-student-1");
      await createBatchRepo(prisma).enrol(s.id, from.id, civilDate("2026-05-10"));

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/students/${s.id}/transfer`,
        headers: bearer(await signToken({ oid: "transfer-admin-1" })),
        payload: { toBatchId: to.id, effectiveDate: "2026-08-10" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<EnrolmentLike>();
      expect(body.studentId).toBe(s.id);
      expect(body.batchId).toBe(to.id);
      expect(body.startDate).toBe("2026-08-10");
      expect(body.endDate).toBeNull();

      const oldEnrolment = await prisma.enrolment.findFirst({ where: { studentId: s.id, batchId: from.id } });
      expect(oldEnrolment?.endDate?.toISOString().slice(0, 10)).toBe("2026-08-09");
    });

    it("rejects an unknown student id with 404 student-not-found", async () => {
      await mentor("transfer-admin-2");
      const to = await batch("Batch Transfer To 2");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/students/${UNKNOWN_UUID}/transfer`,
        headers: bearer(await signToken({ oid: "transfer-admin-2" })),
        payload: { toBatchId: to.id, effectiveDate: "2026-08-10" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      const body = res.json<ProblemLike>();
      expect(body.type).toBe("https://irp.bistec.example/problems/student-not-found");
    });

    it("rejects an unknown target batch with 404 batch-not-found", async () => {
      await mentor("transfer-admin-3");
      const from = await batch("Batch Transfer From 3");
      const s = await student("transfer-student-3");
      await createBatchRepo(prisma).enrol(s.id, from.id, civilDate("2026-05-10"));

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/students/${s.id}/transfer`,
        headers: bearer(await signToken({ oid: "transfer-admin-3" })),
        payload: { toBatchId: UNKNOWN_UUID, effectiveDate: "2026-08-10" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      const body = res.json<ProblemLike>();
      expect(body.type).toBe("https://irp.bistec.example/problems/batch-not-found");
    });

    it("treats a mentor id in the student path as not found: 404 student-not-found", async () => {
      await mentor("transfer-admin-4");
      const mentorTarget = await mentor("transfer-mentor-target-4");
      const to = await batch("Batch Transfer To 4");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/students/${mentorTarget.id}/transfer`,
        headers: bearer(await signToken({ oid: "transfer-admin-4" })),
        payload: { toBatchId: to.id, effectiveDate: "2026-08-10" },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json<ProblemLike>();
      expect(body.type).toBe("https://irp.bistec.example/problems/student-not-found");
    });

    it("rejects a transfer for a student with no open enrolment: 409 no-open-enrolment", async () => {
      await mentor("transfer-admin-5");
      const to = await batch("Batch Transfer To 5");
      const s = await student("transfer-student-5");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/students/${s.id}/transfer`,
        headers: bearer(await signToken({ oid: "transfer-admin-5" })),
        payload: { toBatchId: to.id, effectiveDate: "2026-08-10" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      const body = res.json<ProblemLike>();
      expect(body.type).toBe("https://irp.bistec.example/problems/no-open-enrolment");
    });

    it("rejects effectiveDate <= the open enrolment's start with 400 invalid-transfer-date", async () => {
      await mentor("transfer-admin-6");
      const from = await batch("Batch Transfer From 6");
      const to = await batch("Batch Transfer To 6");
      const s = await student("transfer-student-6");
      await createBatchRepo(prisma).enrol(s.id, from.id, civilDate("2026-05-10"));

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/students/${s.id}/transfer`,
        headers: bearer(await signToken({ oid: "transfer-admin-6" })),
        payload: { toBatchId: to.id, effectiveDate: "2026-05-10" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      const body = res.json<ProblemLike>();
      expect(body.type).toBe("https://irp.bistec.example/problems/invalid-transfer-date");
    });

    it("rejects a student token on the transfer endpoint with 403 admin-only", async () => {
      const s = await student("transfer-student-7");
      const to = await batch("Batch Transfer To 7");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/students/${s.id}/transfer`,
        headers: bearer(await signToken({ oid: "transfer-student-7" })),
        payload: { toBatchId: to.id, effectiveDate: "2026-08-10" },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json<ProblemLike>();
      expect(body.type).toBe("https://irp.bistec.example/problems/admin-only");
    });

    // ---- archiveUser ----

    it("archives a user with 200 and archived: true", async () => {
      await mentor("archive-admin-1");
      const s = await student("archive-student-1");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${s.id}`,
        headers: bearer(await signToken({ oid: "archive-admin-1" })),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<UserDetailLike>();
      expect(body.id).toBe(s.id);
      expect(body.archived).toBe(true);

      const row = await prisma.user.findUnique({ where: { id: s.id } });
      expect(row?.deletedAt).not.toBeNull();
    });

    it("removes the archived student from the default listUsers view and surfaces it under ?archived=true", async () => {
      await mentor("archive-admin-2");
      const s = await student("archive-student-2");

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${s.id}`,
        headers: bearer(await signToken({ oid: "archive-admin-2" })),
      });
      expect(del.statusCode).toBe(200);

      const activeList = await app.inject({
        method: "GET",
        url: "/api/v1/users",
        headers: bearer(await signToken({ oid: "archive-admin-2" })),
      });
      expect(activeList.json<UserDetailLike[]>().map((u) => u.id)).not.toContain(s.id);

      const archivedList = await app.inject({
        method: "GET",
        url: "/api/v1/users?archived=true",
        headers: bearer(await signToken({ oid: "archive-admin-2" })),
      });
      const archivedIds = archivedList.json<UserDetailLike[]>().map((u) => u.id);
      expect(archivedIds).toContain(s.id);
    });

    it("revokes access: the archived student's own token now 403s on /me", async () => {
      await mentor("archive-admin-3");
      const s = await student("archive-student-3");
      const studentToken = await signToken({ oid: "archive-student-3" });

      // Confirm the token works before archiving.
      const before = await app.inject({ method: "GET", url: "/api/v1/me", headers: bearer(studentToken) });
      expect(before.statusCode).toBe(200);

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${s.id}`,
        headers: bearer(await signToken({ oid: "archive-admin-3" })),
      });
      expect(del.statusCode).toBe(200);

      const after = await app.inject({ method: "GET", url: "/api/v1/me", headers: bearer(studentToken) });
      expect(after.statusCode).toBe(403);
      const body = after.json<ProblemLike>();
      expect(body.type).toBe("https://irp.bistec.example/problems/not-registered");
    });

    // Task 8 review-decision carried forward: FR-5 archive revokes ACCESS and
    // roster presence, not history. userRepo.findById is deliberately
    // unfiltered by deletedAt, so an archived student's day history remains
    // fully reviewable by a mentor.
    it("keeps an archived student reviewable: GET /api/v1/students/{id}/days still 200s", async () => {
      const admin = await mentor("archive-admin-4");
      const s = await student("archive-student-4");

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${s.id}`,
        headers: bearer(await signToken({ oid: "archive-admin-4" })),
      });
      expect(del.statusCode).toBe(200);

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/students/${s.id}/days`,
        // Non-null by construction: mentor() above always creates the row
        // with a real externalId.
        headers: bearer(await signToken({ oid: admin.externalId! })),
      });

      expect(res.statusCode).toBe(200);
    });

    it("is idempotent: a repeat DELETE on an already-archived user still 200s", async () => {
      await mentor("archive-admin-5");
      const s = await student("archive-student-5");

      const first = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${s.id}`,
        headers: bearer(await signToken({ oid: "archive-admin-5" })),
      });
      expect(first.statusCode).toBe(200);
      const firstDeletedAt = (await prisma.user.findUnique({ where: { id: s.id } }))?.deletedAt;

      const second = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${s.id}`,
        headers: bearer(await signToken({ oid: "archive-admin-5" })),
      });
      expect(second.statusCode).toBe(200);
      const body = second.json<UserDetailLike>();
      expect(body.archived).toBe(true);

      const secondDeletedAt = (await prisma.user.findUnique({ where: { id: s.id } }))?.deletedAt;
      expect(secondDeletedAt?.toISOString()).toBe(firstDeletedAt?.toISOString());
    });

    it("rejects self-archive with 409 self-archive", async () => {
      const admin = await mentor("archive-admin-6");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${admin.id}`,
        headers: bearer(await signToken({ oid: "archive-admin-6" })),
      });

      expect(res.statusCode).toBe(409);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      const body = res.json<ProblemLike>();
      expect(body.type).toBe("https://irp.bistec.example/problems/self-archive");
    });

    it("rejects an unknown user id with 404 user-not-found", async () => {
      await mentor("archive-admin-7");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${UNKNOWN_UUID}`,
        headers: bearer(await signToken({ oid: "archive-admin-7" })),
      });

      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      const body = res.json<ProblemLike>();
      expect(body.type).toBe("https://irp.bistec.example/problems/user-not-found");
    });

    it("rejects a student token on the archive endpoint with 403 admin-only", async () => {
      const s = await student("archive-student-8");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${s.id}`,
        headers: bearer(await signToken({ oid: "archive-student-8" })),
      });

      expect(res.statusCode).toBe(403);
      const body = res.json<ProblemLike>();
      expect(body.type).toBe("https://irp.bistec.example/problems/admin-only");
    });

    it("restores an archived user with 200 and archived: false", async () => {
      await mentor("restore-admin-1");
      const s = await student("restore-student-1");

      await app.inject({
        method: "DELETE",
        url: `/api/v1/users/${s.id}`,
        headers: bearer(await signToken({ oid: "restore-admin-1" })),
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/users/${s.id}/restore`,
        headers: bearer(await signToken({ oid: "restore-admin-1" })),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<UserDetailLike>().archived).toBe(false);
      expect((await prisma.user.findUnique({ where: { id: s.id } }))?.deletedAt).toBeNull();
    });

    it("returns a restored student to the default listUsers view", async () => {
      // The round trip is the point: archive hides, restore un-hides. Asserting
      // only on the restore response would pass even if the list filter and the
      // deletedAt column ever disagreed.
      await mentor("restore-admin-2");
      const s = await student("restore-student-2");
      const token = bearer(await signToken({ oid: "restore-admin-2" }));

      await app.inject({ method: "DELETE", url: `/api/v1/users/${s.id}`, headers: token });
      const whileArchived = await app.inject({ method: "GET", url: "/api/v1/users", headers: token });
      expect(whileArchived.json<{ id: string }[]>().map((u) => u.id)).not.toContain(s.id);

      await app.inject({ method: "POST", url: `/api/v1/users/${s.id}/restore`, headers: token });

      const after = await app.inject({ method: "GET", url: "/api/v1/users", headers: token });
      expect(after.json<{ id: string }[]>().map((u) => u.id)).toContain(s.id);

      const archivedView = await app.inject({
        method: "GET",
        url: "/api/v1/users?archived=true",
        headers: token,
      });
      expect(archivedView.json<{ id: string }[]>().map((u) => u.id)).not.toContain(s.id);
    });

    it("restores access: the student's own token stops 403ing on /me", async () => {
      // Archive revokes access by making findByExternalId skip the row. Restore
      // has to give it back, or a "restored" user is restored in name only.
      await mentor("restore-admin-3");
      const s = await student("restore-student-3");
      const adminToken = bearer(await signToken({ oid: "restore-admin-3" }));

      await app.inject({ method: "DELETE", url: `/api/v1/users/${s.id}`, headers: adminToken });
      const denied = await app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: bearer(await signToken({ oid: "restore-student-3" })),
      });
      expect(denied.statusCode).toBe(403);

      await app.inject({ method: "POST", url: `/api/v1/users/${s.id}/restore`, headers: adminToken });

      const allowed = await app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: bearer(await signToken({ oid: "restore-student-3" })),
      });
      expect(allowed.statusCode).toBe(200);
    });

    it("is idempotent: restoring a user who was never archived still 200s and changes nothing", async () => {
      await mentor("restore-admin-4");
      const s = await student("restore-student-4");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/users/${s.id}/restore`,
        headers: bearer(await signToken({ oid: "restore-admin-4" })),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<UserDetailLike>().archived).toBe(false);
      expect((await prisma.user.findUnique({ where: { id: s.id } }))?.deletedAt).toBeNull();
    });

    it("rejects an unknown user id on restore with 404 user-not-found", async () => {
      await mentor("restore-admin-5");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/users/${UNKNOWN_UUID}/restore`,
        headers: bearer(await signToken({ oid: "restore-admin-5" })),
      });

      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.json<ProblemLike>().type).toBe(
        "https://irp.bistec.example/problems/user-not-found",
      );
    });

    it("rejects a student token on the restore endpoint with 403 admin-only", async () => {
      const s = await student("restore-student-6");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/users/${s.id}/restore`,
        headers: bearer(await signToken({ oid: "restore-student-6" })),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json<ProblemLike>().type).toBe("https://irp.bistec.example/problems/admin-only");
    });
  },
);

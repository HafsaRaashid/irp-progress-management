import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { civilDate } from "@irp/core";
import { createBatchRepo } from "../src/db/batch-repo.js";
import { buildTestServer } from "./helpers/build-test-server.js";
import { resetDb } from "./helpers/db.js";
import { signToken } from "./helpers/keys.js";
import { dbUrl } from "./helpers/require-db.js";

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

interface ProblemLike {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

interface UserDetailLike {
  id: string;
  email: string;
  displayName: string;
  role: "Admin" | "Student";
  archived: boolean;
}

describe.skipIf(!dbUrl)("Users: GET/POST /api/v1/users", () => {
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

  it("registers a mentor with 200 and no enrolment", async () => {
    await mentor("users-admin-caller-1");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-admin-caller-1" })),
      payload: {
        externalId: "oid-new-mentor-1",
        email: "n.perera@bistecglobal.com",
        displayName: "Nuwan Perera",
        role: "Admin",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<UserDetailLike>();
    expect(body.id).toBeTruthy();
    expect(body.email).toBe("n.perera@bistecglobal.com");
    expect(body.displayName).toBe("Nuwan Perera");
    expect(body.role).toBe("Admin");
    expect(body.archived).toBe(false);

    const created = await prisma.user.findUnique({ where: { id: body.id } });
    expect(created?.role).toBe("ADMIN");
  });

  it("registers a mentor without externalId, leaving it pending (ADR-0036)", async () => {
    await mentor("users-admin-caller-1b");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-admin-caller-1b" })),
      payload: {
        email: "pending.mentor@bistecglobal.com",
        displayName: "Pending Mentor",
        role: "Admin",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<UserDetailLike>();
    const created = await prisma.user.findUnique({ where: { id: body.id } });
    expect(created?.externalId).toBeNull();
  });

  it("registers a student with 200 and creates an open enrolment atomically", async () => {
    await mentor("users-admin-caller-2");
    const b = await batch("Batch Users Endpoint 2");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-admin-caller-2" })),
      payload: {
        externalId: "oid-new-student-1",
        email: "a.perera@bistecglobal.com",
        displayName: "Amaya Perera",
        role: "Student",
        enrolment: { batchId: b.id, startDate: "2026-08-10" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<UserDetailLike>();
    expect(body.role).toBe("Student");

    const enrolment = await prisma.enrolment.findFirst({ where: { studentId: body.id } });
    expect(enrolment).not.toBeNull();
    expect(enrolment?.batchId).toBe(b.id);
    expect(enrolment?.endDate).toBeNull();
    expect(enrolment?.startDate.toISOString().slice(0, 10)).toBe("2026-08-10");
  });

  it("rejects a student registration without an enrolment: 400 enrolment-required", async () => {
    await mentor("users-admin-caller-3");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-admin-caller-3" })),
      payload: {
        externalId: "oid-new-student-2",
        email: "b.perera@bistecglobal.com",
        displayName: "Bimal Perera",
        role: "Student",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/enrolment-required");
  });

  it("rejects an admin registration carrying an enrolment: 400 enrolment-required", async () => {
    await mentor("users-admin-caller-4");
    const b = await batch("Batch Users Endpoint 4");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-admin-caller-4" })),
      payload: {
        externalId: "oid-new-mentor-2",
        email: "c.perera@bistecglobal.com",
        displayName: "Chamath Perera",
        role: "Admin",
        enrolment: { batchId: b.id, startDate: "2026-08-10" },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/enrolment-required");
  });

  it("rejects a duplicate email with 409 duplicate-user", async () => {
    await mentor("users-admin-caller-5");

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-admin-caller-5" })),
      payload: {
        externalId: "oid-dup-1",
        email: "dup@bistecglobal.com",
        displayName: "Dup One",
        role: "Admin",
      },
    });
    expect(first.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-admin-caller-5" })),
      payload: {
        externalId: "oid-dup-2",
        email: "dup@bistecglobal.com",
        displayName: "Dup Two",
        role: "Admin",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/duplicate-user");
  });

  it("rejects a student registration naming an unknown batch: 404 batch-not-found", async () => {
    await mentor("users-admin-caller-6");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-admin-caller-6" })),
      payload: {
        externalId: "oid-new-student-3",
        email: "d.perera@bistecglobal.com",
        displayName: "Devni Perera",
        role: "Student",
        enrolment: { batchId: "00000000-0000-0000-0000-000000000000", startDate: "2026-08-10" },
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/batch-not-found");
  });

  it("rejects an extra body property with 400", async () => {
    await mentor("users-admin-caller-7");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-admin-caller-7" })),
      payload: {
        externalId: "oid-extra-1",
        email: "e.perera@bistecglobal.com",
        displayName: "Extra Perera",
        role: "Admin",
        extra: 1,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/validation-failed");
  });

  it("rejects a student token on POST /api/v1/users with 403 admin-only", async () => {
    await student("users-student-caller-1");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-student-caller-1" })),
      payload: {
        externalId: "oid-blocked-1",
        email: "f.perera@bistecglobal.com",
        displayName: "Forbidden Perera",
        role: "Admin",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/admin-only");
  });

  it("rejects a student token on GET /api/v1/users with 403 admin-only", async () => {
    await student("users-student-caller-2");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-student-caller-2" })),
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/admin-only");
  });

  it("lists active users by default, excluding archived ones", async () => {
    const caller = await mentor("users-admin-caller-8");
    const active = await student("users-active-8");
    const archived = await student("users-archived-8");
    await prisma.user.update({ where: { id: archived.id }, data: { deletedAt: new Date() } });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: bearer(await signToken({ oid: "users-admin-caller-8" })),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<UserDetailLike[]>();
    const ids = body.map((u) => u.id);
    expect(ids).toContain(caller.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(archived.id);
    expect(body.every((u) => !u.archived)).toBe(true);
  });

  it("?archived=true returns only archived users", async () => {
    await mentor("users-admin-caller-9");
    const active = await student("users-active-9");
    const archived = await student("users-archived-9");
    await prisma.user.update({ where: { id: archived.id }, data: { deletedAt: new Date() } });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users?archived=true",
      headers: bearer(await signToken({ oid: "users-admin-caller-9" })),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<UserDetailLike[]>();
    const ids = body.map((u) => u.id);
    expect(ids).toContain(archived.id);
    expect(ids).not.toContain(active.id);
    expect(body.every((u) => u.archived)).toBe(true);
  });

  it("?role=Student filters to students only", async () => {
    await mentor("users-admin-caller-10");
    const stu = await student("users-student-10");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users?role=Student",
      headers: bearer(await signToken({ oid: "users-admin-caller-10" })),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<UserDetailLike[]>();
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((u) => u.role === "Student")).toBe(true);
    expect(body.map((u) => u.id)).toContain(stu.id);
  });
});

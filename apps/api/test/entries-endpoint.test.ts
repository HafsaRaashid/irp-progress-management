import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { isWeekday, previousWeekday, toProgrammeDate } from "@irp/core";
import { buildTestServer } from "./helpers/build-test-server.js";
import { toDbDate } from "../src/db/civil-date-map.js";
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

interface EntryLike {
  id: string;
  entryDate: string;
  body: string;
  submittedAt: string;
  isLate: boolean;
  isExtra: boolean;
}

describe.skipIf(!dbUrl)("POST /api/v1/entries", () => {
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

  async function student(externalId: string) {
    return prisma.user.create({
      data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "STUDENT" },
    });
  }

  async function mentor(externalId: string) {
    return prisma.user.create({
      data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "ADMIN" },
    });
  }

  it("stores an on-time entry for today with both flags false", async () => {
    await student("stu-1");
    const today = toProgrammeDate(new Date());

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "stu-1" })),
      payload: { entryDate: today, body: "Wired the submission endpoint." },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<EntryLike>();
    expect(body.entryDate).toBe(today);
    expect(body.body).toBe("Wired the submission endpoint.");
    expect(body.isLate).toBe(false);
    // Weekends are optional (Extra); weekdays are neither late nor extra when
    // submitted for today, on time.
    expect(body.isExtra).toBe(!isWeekday(today));
  });

  it("flags a previous-weekday entry late when that day has ended", async () => {
    await student("stu-2");
    const today = toProgrammeDate(new Date());
    const target = previousWeekday(today);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "stu-2" })),
      payload: { entryDate: target, body: "Yesterday's notes, submitted late." },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<EntryLike>();
    // previousWeekday always returns a date strictly before today, so its
    // day has already ended in Colombo by the time this request lands.
    if (target !== today) {
      expect(body.isLate).toBe(true);
    }
    expect(body.isExtra).toBe(false);
  });

  it("rejects a date outside the window with 400 submission-window-closed", async () => {
    await student("stu-3");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "stu-3" })),
      payload: { entryDate: "2020-01-06", body: "Far too old to accept." },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/submission-window-closed");
  });

  it("rejects a calendar-invalid entryDate (2026-02-30, not a leap-valid day) with 400 before it ever reaches civilDate()", async () => {
    await student("stu-invalid-date");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "stu-invalid-date" })),
      payload: { entryDate: "2026-02-30", body: "This date does not exist." },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/validation-failed");
  });

  it("rejects an entry on an absent day with 409 absent-day-conflict", async () => {
    const s = await student("stu-4");
    const today = toProgrammeDate(new Date());
    await prisma.absenceRecord.create({
      data: { studentId: s.id, date: toDbDate(today), reason: "medical" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "stu-4" })),
      payload: { entryDate: today, body: "But I also worked?" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/absent-day-conflict");
  });

  it("rejects an entry on an Evaluated day with 409 day-locked", async () => {
    const s = await student("stu-5");
    const today = toProgrammeDate(new Date());

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "stu-5" })),
      payload: { entryDate: today, body: "First entry of the day." },
    });
    expect(first.statusCode).toBe(200);

    await prisma.dailyReport.updateMany({
      where: { studentId: s.id },
      data: { status: "EVALUATED", evaluatedAt: new Date() },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "stu-5" })),
      payload: { entryDate: today, body: "After the day was locked." },
    });

    expect(res.statusCode).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/day-locked");
  });

  it("rejects unknown body properties with 400", async () => {
    await student("stu-6");
    const today = toProgrammeDate(new Date());

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "stu-6" })),
      payload: { entryDate: today, body: "Has an extra field.", extra: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/validation-failed");
  });

  it("rejects a mentor token with 403", async () => {
    await mentor("mentor-1");
    const today = toProgrammeDate(new Date());

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "mentor-1" })),
      payload: { entryDate: today, body: "Mentors do not submit." },
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/students-only");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const today = toProgrammeDate(new Date());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      payload: { entryDate: today, body: "No token at all." },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/unauthorized");
  });
});

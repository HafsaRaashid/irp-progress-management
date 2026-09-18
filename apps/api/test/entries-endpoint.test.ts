import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { isWeekday, previousWeekday, toProgrammeDate } from "@irp/core";
import { buildTestServer } from "./helpers/build-test-server.js";
import { toDbDate } from "../src/db/civil-date-map.js";
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

interface EntryLike {
  id: string;
  entryDate: string;
  body: string;
  submittedAt: string;
  isLate: boolean;
  isExtra: boolean;
}

interface ReviewedEntryLike extends EntryLike {
  score: number | null;
  mentorFeedback: string | null;
  countsTowardEvaluation: boolean;
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

describe.skipIf(!dbUrl)("PUT /api/v1/entries/:id/review", () => {
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

  function weekdayInWindow() {
    const today = toProgrammeDate(new Date());
    return isWeekday(today) ? today : previousWeekday(today);
  }

  async function submittedEntry(studentExternalId: string): Promise<{ studentId: string; entryId: string }> {
    const s = await student(studentExternalId);
    const target = weekdayInWindow();
    const entryRes = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: studentExternalId })),
      payload: { entryDate: target, body: "Work for the review test." },
    });
    expect(entryRes.statusCode).toBe(200);
    return { studentId: s.id, entryId: entryRes.json<EntryLike>().id };
  }

  it("accepts a valid score/feedback/flag and returns them on the mentor-facing entry", async () => {
    const { studentId, entryId } = await submittedEntry("er-1-student");
    await mentor("er-1-mentor");

    const before = await prisma.entry.findUniqueOrThrow({ where: { id: entryId } });
    expect(before.score).toBeNull();
    expect(before.mentorFeedback).toBeNull();
    expect(before.countsTowardEvaluation).toBe(false);
    expect(await prisma.entry.count({ where: { studentId, countsTowardEvaluation: true } })).toBe(0);

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${entryId}/review`,
      headers: bearer(await signToken({ oid: "er-1-mentor" })),
      payload: { score: 85, feedback: "Good detail, keep it up.", countsTowardEvaluation: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ReviewedEntryLike>();
    expect(body.id).toBe(entryId);
    expect(body.score).toBe(85);
    expect(body.mentorFeedback).toBe("Good detail, keep it up.");
    expect(body.countsTowardEvaluation).toBe(true);
  });

  it("fully replaces score/feedback/flag on a second review write, rather than merging", async () => {
    const { entryId } = await submittedEntry("er-2-student");
    await mentor("er-2-mentor");
    const mentorHeader = bearer(await signToken({ oid: "er-2-mentor" }));

    const first = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${entryId}/review`,
      headers: mentorHeader,
      payload: { score: 60, feedback: "First pass.", countsTowardEvaluation: false },
    });
    expect(first.statusCode).toBe(200);

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${entryId}/review`,
      headers: mentorHeader,
      payload: { score: 95, feedback: "Revised after a closer look.", countsTowardEvaluation: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ReviewedEntryLike>();
    expect(body.score).toBe(95);
    expect(body.mentorFeedback).toBe("Revised after a closer look.");
    expect(body.countsTowardEvaluation).toBe(true);
  });

  it("rejects a score outside 0-100 with 400 validation-failed", async () => {
    const { entryId } = await submittedEntry("er-3-student");
    await mentor("er-3-mentor");

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${entryId}/review`,
      headers: bearer(await signToken({ oid: "er-3-mentor" })),
      payload: { score: 101, feedback: "Too high.", countsTowardEvaluation: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/validation-failed");
  });

  it("rejects unknown body properties with 400", async () => {
    const { entryId } = await submittedEntry("er-4-student");
    await mentor("er-4-mentor");

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${entryId}/review`,
      headers: bearer(await signToken({ oid: "er-4-mentor" })),
      payload: { score: 50, feedback: "Has an extra field.", countsTowardEvaluation: false, extra: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/validation-failed");
  });

  it("rejects a review write on an Evaluated day with 409 day-locked", async () => {
    const { studentId, entryId } = await submittedEntry("er-5-student");
    await mentor("er-5-mentor");

    await prisma.dailyReport.updateMany({
      where: { studentId },
      data: { status: "EVALUATED", evaluatedAt: new Date() },
    });

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${entryId}/review`,
      headers: bearer(await signToken({ oid: "er-5-mentor" })),
      payload: { score: 90, feedback: "Too late, day is locked.", countsTowardEvaluation: true },
    });

    expect(res.statusCode).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/day-locked");
  });

  it("rejects an unknown entry id with 404 entry-not-found", async () => {
    await mentor("er-6-mentor");

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${UNKNOWN_UUID}/review`,
      headers: bearer(await signToken({ oid: "er-6-mentor" })),
      payload: { score: 50, feedback: "Does not exist.", countsTowardEvaluation: false },
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/entry-not-found");
  });

  it("rejects a student token with 403 admin-only", async () => {
    const { entryId } = await submittedEntry("er-7-student");

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${entryId}/review`,
      headers: bearer(await signToken({ oid: "er-7-student" })),
      payload: { score: 50, feedback: "Students cannot review.", countsTowardEvaluation: false },
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/admin-only");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${UNKNOWN_UUID}/review`,
      payload: { score: 50, feedback: "No token at all.", countsTowardEvaluation: false },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/unauthorized");
  });

  it("integration: submit -> InReview -> review -> Evaluated -> a further review 409s", async () => {
    const { studentId, entryId } = await submittedEntry("er-8-student");
    await mentor("er-8-mentor");
    const mentorHeader = bearer(await signToken({ oid: "er-8-mentor" }));
    const report = await prisma.dailyReport.findFirstOrThrow({ where: { studentId } });

    const toInReview = await app.inject({
      method: "POST",
      url: `/api/v1/daily-reports/${report.id}/transition`,
      headers: mentorHeader,
      payload: { to: "InReview" },
    });
    expect(toInReview.statusCode).toBe(200);

    const review = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${entryId}/review`,
      headers: mentorHeader,
      payload: { score: 88, feedback: "Solid submission.", countsTowardEvaluation: true },
    });
    expect(review.statusCode).toBe(200);

    const toEvaluated = await app.inject({
      method: "POST",
      url: `/api/v1/daily-reports/${report.id}/transition`,
      headers: mentorHeader,
      payload: { to: "Evaluated" },
    });
    expect(toEvaluated.statusCode).toBe(200);

    const secondReview = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${entryId}/review`,
      headers: mentorHeader,
      payload: { score: 10, feedback: "Should never apply.", countsTowardEvaluation: false },
    });
    expect(secondReview.statusCode).toBe(409);
    const body = secondReview.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/day-locked");
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { addDays, isWeekday, nextWeekday, previousWeekday, toProgrammeDate, type CivilDate } from "@irp/core";
import { buildTestServer } from "./helpers/build-test-server.js";
import { resolveRange } from "../src/routes/me-days.js";
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

interface DailyReportLike {
  id: string;
  studentId: string;
  reportDate: string;
  status: string;
}

interface DayRecordLike {
  id: string;
  studentId: string;
  date: string;
  attended: boolean;
  tasksCompleted: boolean;
  note: string | null;
  recordedById: string;
}

interface DaySummaryLike {
  date: string;
  status: string;
  reportStatus: string | null;
  reportId: string | null;
  absenceReason: string | null;
  entries: {
    id: string;
    entryDate: string;
    body: string;
    score: number | null;
    mentorFeedback: string | null;
    countsTowardEvaluation: boolean;
  }[];
}

// Same construction `absences-endpoint.test.ts` uses: a weekday still inside
// the current submission window, deterministic regardless of which
// real-world day this suite runs on.
function weekdayInWindow(): CivilDate {
  const today = toProgrammeDate(new Date());
  return isWeekday(today) ? today : previousWeekday(today);
}

// nextWeekday always returns a date strictly after today (mirroring
// previousWeekday's own documented "strictly before" guarantee), so this is
// deterministic regardless of which real-world day this suite runs on.
function futureWeekday(): CivilDate {
  return nextWeekday(toProgrammeDate(new Date()));
}

// A known Monday (confirmed by `absence-repo.test.ts`'s own MONDAY constant)
// and the Sunday immediately before it — used for the day-record tests,
// which are not submission-window-gated and so need no fixed clock.
const A_MONDAY: CivilDate = "2026-08-03" as CivilDate;
const A_SUNDAY: CivilDate = "2026-08-02" as CivilDate;
const THE_NEXT_TUESDAY: CivilDate = "2026-08-04" as CivilDate;

describe.skipIf(!dbUrl)(
  "POST /api/v1/daily-reports/{id}/transition, PUT /api/v1/students/{id}/day-records/{date}, GET /api/v1/students/{id}/days, GET /api/v1/students/{id}/day-records",
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

    async function submittedReportId(studentExternalId: string): Promise<{ studentId: string; reportId: string }> {
      const s = await student(studentExternalId);
      const target = weekdayInWindow();
      const entryRes = await app.inject({
        method: "POST",
        url: "/api/v1/entries",
        headers: bearer(await signToken({ oid: studentExternalId })),
        payload: { entryDate: target, body: "Work for the transition test." },
      });
      expect(entryRes.statusCode).toBe(200);
      const report = await prisma.dailyReport.findFirstOrThrow({ where: { studentId: s.id } });
      return { studentId: s.id, reportId: report.id };
    }

    describe("transition", () => {
      it("moves Submitted to InReview (200), sets reviewedById and inReviewAt", async () => {
        const { reportId } = await submittedReportId("rev-t1-student");
        const m = await mentor("rev-t1-mentor");

        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearer(await signToken({ oid: "rev-t1-mentor" })),
          payload: { to: "InReview" },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DailyReportLike>();
        expect(body.id).toBe(reportId);
        expect(body.status).toBe("InReview");

        const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: reportId } });
        expect(row.status).toBe("IN_REVIEW");
        expect(row.reviewedById).toBe(m.id);
        expect(row.inReviewAt).not.toBeNull();
        expect(row.evaluatedAt).toBeNull();
      });

      it("moves InReview to Evaluated (200), sets evaluatedAt", async () => {
        const { reportId } = await submittedReportId("rev-t2-student");
        await mentor("rev-t2-mentor");
        const bearerHeader = bearer(await signToken({ oid: "rev-t2-mentor" }));

        const first = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearerHeader,
          payload: { to: "InReview" },
        });
        expect(first.statusCode).toBe(200);

        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearerHeader,
          payload: { to: "Evaluated" },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DailyReportLike>();
        expect(body.status).toBe("Evaluated");

        const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: reportId } });
        expect(row.status).toBe("EVALUATED");
        expect(row.evaluatedAt).not.toBeNull();
      });

      it("moves Submitted directly to Evaluated (200) -- a manual InReview step is no longer required", async () => {
        const { reportId } = await submittedReportId("rev-t7-student");
        const m = await mentor("rev-t7-mentor");

        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearer(await signToken({ oid: "rev-t7-mentor" })),
          payload: { to: "Evaluated" },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DailyReportLike>();
        expect(body.status).toBe("Evaluated");

        const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: reportId } });
        expect(row.status).toBe("EVALUATED");
        expect(row.reviewedById).toBe(m.id);
        // Backfilled to the same instant as evaluatedAt, since review and
        // evaluation happened in the same step here -- not left null just
        // because no separate InReview step ever ran.
        expect(row.inReviewAt).not.toBeNull();
        expect(row.evaluatedAt).not.toBeNull();
      });

      it("rejects a repeat InReview transition with 409 invalid-transition", async () => {
        const { reportId } = await submittedReportId("rev-t3-student");
        await mentor("rev-t3-mentor");
        const bearerHeader = bearer(await signToken({ oid: "rev-t3-mentor" }));

        const first = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearerHeader,
          payload: { to: "InReview" },
        });
        expect(first.statusCode).toBe(200);

        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearerHeader,
          payload: { to: "InReview" },
        });

        expect(res.statusCode).toBe(409);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/invalid-transition");
      });

      it("rejects Evaluated to InReview with 409 invalid-transition — forward-only, no way back", async () => {
        const { reportId } = await submittedReportId("rev-t4-student");
        await mentor("rev-t4-mentor");
        const bearerHeader = bearer(await signToken({ oid: "rev-t4-mentor" }));

        await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearerHeader,
          payload: { to: "InReview" },
        });
        const evaluated = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearerHeader,
          payload: { to: "Evaluated" },
        });
        expect(evaluated.statusCode).toBe(200);

        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearerHeader,
          payload: { to: "InReview" },
        });

        expect(res.statusCode).toBe(409);
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/invalid-transition");
      });

      it("rejects an unknown report id with 404 report-not-found", async () => {
        await mentor("rev-t5-mentor");

        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${UNKNOWN_UUID}/transition`,
          headers: bearer(await signToken({ oid: "rev-t5-mentor" })),
          payload: { to: "InReview" },
        });

        expect(res.statusCode).toBe(404);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/report-not-found");
      });

      it("rejects a student token with 403 admin-only", async () => {
        const { reportId } = await submittedReportId("rev-t6-student");

        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearer(await signToken({ oid: "rev-t6-student" })),
          payload: { to: "InReview" },
        });

        expect(res.statusCode).toBe(403);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/admin-only");
      });
    });

    describe("day records", () => {
      it("creates then overwrites a day record — second PUT wins (200 both)", async () => {
        const s = await student("rev-d1-student");
        const m = await mentor("rev-d1-mentor");
        const bearerHeader = bearer(await signToken({ oid: "rev-d1-mentor" }));

        const first = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${s.id}/day-records/${A_MONDAY}`,
          headers: bearerHeader,
          payload: { attended: true, tasksCompleted: false },
        });
        expect(first.statusCode).toBe(200);
        const firstBody = first.json<DayRecordLike>();
        expect(firstBody.attended).toBe(true);
        expect(firstBody.tasksCompleted).toBe(false);
        expect(firstBody.note).toBeNull();
        expect(firstBody.recordedById).toBe(m.id);

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${s.id}/day-records/${A_MONDAY}`,
          headers: bearerHeader,
          payload: { attended: true, tasksCompleted: true, note: "Caught up by evening." },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DayRecordLike>();
        expect(body.id).toBe(firstBody.id); // updated, not duplicated
        expect(body.tasksCompleted).toBe(true);
        expect(body.note).toBe("Caught up by evening.");
        expect(await prisma.mentorDayRecord.count()).toBe(1);
      });

      it("works for an entry-less day — FR-19 is independent of submissions", async () => {
        const s = await student("rev-d2-student");
        await mentor("rev-d2-mentor");
        expect(await prisma.entry.count({ where: { studentId: s.id } })).toBe(0);

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${s.id}/day-records/${A_MONDAY}`,
          headers: bearer(await signToken({ oid: "rev-d2-mentor" })),
          payload: { attended: false, tasksCompleted: false },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DayRecordLike>();
        expect(body.attended).toBe(false);
      });

      it("rejects a weekend date with 400 weekend-day-record", async () => {
        const s = await student("rev-d3-student");
        await mentor("rev-d3-mentor");

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${s.id}/day-records/${A_SUNDAY}`,
          headers: bearer(await signToken({ oid: "rev-d3-mentor" })),
          payload: { attended: true, tasksCompleted: true },
        });

        expect(res.statusCode).toBe(400);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/weekend-day-record");
      });

      it("rejects a date after today with 400 future-day-record — nothing to attend yet", async () => {
        const s = await student("rev-d7-student");
        await mentor("rev-d7-mentor");

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${s.id}/day-records/${futureWeekday()}`,
          headers: bearer(await signToken({ oid: "rev-d7-mentor" })),
          payload: { attended: true, tasksCompleted: true },
        });

        expect(res.statusCode).toBe(400);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/future-day-record");
      });

      it("accepts the boundary weekday (today's own, if today is one) — not just comfortably in the past", async () => {
        const s = await student("rev-d8-student");
        await mentor("rev-d8-mentor");

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${s.id}/day-records/${weekdayInWindow()}`,
          headers: bearer(await signToken({ oid: "rev-d8-mentor" })),
          payload: { attended: true, tasksCompleted: true },
        });

        expect(res.statusCode).toBe(200);
      });

      it("rejects an unknown student id with 404 student-not-found", async () => {
        await mentor("rev-d4-mentor");

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${UNKNOWN_UUID}/day-records/${A_MONDAY}`,
          headers: bearer(await signToken({ oid: "rev-d4-mentor" })),
          payload: { attended: true, tasksCompleted: true },
        });

        expect(res.statusCode).toBe(404);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/student-not-found");
      });

      it("rejects a mentor's own id as the student — not a STUDENT role — with 404 student-not-found", async () => {
        const m2 = await mentor("rev-d5-target-mentor");
        await mentor("rev-d5-mentor");

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${m2.id}/day-records/${A_MONDAY}`,
          headers: bearer(await signToken({ oid: "rev-d5-mentor" })),
          payload: { attended: true, tasksCompleted: true },
        });

        expect(res.statusCode).toBe(404);
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/student-not-found");
      });

      it("rejects a student token with 403 admin-only", async () => {
        const s = await student("rev-d6-student");

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${s.id}/day-records/${A_MONDAY}`,
          headers: bearer(await signToken({ oid: "rev-d6-student" })),
          payload: { attended: true, tasksCompleted: true },
        });

        expect(res.statusCode).toBe(403);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/admin-only");
      });
    });

    describe("list day records", () => {
      it("returns stored records in range, oldest first", async () => {
        const s = await student("rev-l1-student");
        await mentor("rev-l1-mentor");
        const bearerHeader = bearer(await signToken({ oid: "rev-l1-mentor" }));

        // Written out of chronological order -- listForStudent's ORDER BY,
        // not insertion order, is what the assertion below is actually
        // checking.
        const second = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${s.id}/day-records/${THE_NEXT_TUESDAY}`,
          headers: bearerHeader,
          payload: { attended: true, tasksCompleted: true, note: "Tuesday." },
        });
        expect(second.statusCode).toBe(200);
        const first = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${s.id}/day-records/${A_MONDAY}`,
          headers: bearerHeader,
          payload: { attended: false, tasksCompleted: true },
        });
        expect(first.statusCode).toBe(200);

        const res = await app.inject({
          method: "GET",
          url: `/api/v1/students/${s.id}/day-records?from=${A_MONDAY}&to=${THE_NEXT_TUESDAY}`,
          headers: bearerHeader,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DayRecordLike[]>();
        expect(body).toHaveLength(2);
        expect(body[0]!.date).toBe(A_MONDAY);
        expect(body[0]!.attended).toBe(false);
        expect(body[0]!.note).toBeNull();
        expect(body[1]!.date).toBe(THE_NEXT_TUESDAY);
        expect(body[1]!.note).toBe("Tuesday.");
      });

      it("rejects an unknown student id with 404 student-not-found", async () => {
        await mentor("rev-l2-mentor");

        const res = await app.inject({
          method: "GET",
          url: `/api/v1/students/${UNKNOWN_UUID}/day-records`,
          headers: bearer(await signToken({ oid: "rev-l2-mentor" })),
        });

        expect(res.statusCode).toBe(404);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/student-not-found");
      });

      it("rejects a student token with 403 admin-only", async () => {
        const s = await student("rev-l3-student");

        const res = await app.inject({
          method: "GET",
          url: `/api/v1/students/${s.id}/day-records`,
          headers: bearer(await signToken({ oid: "rev-l3-student" })),
        });

        expect(res.statusCode).toBe(403);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/admin-only");
      });
    });

    describe("student days", () => {
      it("mirrors the me/days happy shape for a target student", async () => {
        const s = await student("rev-s1-student");
        await mentor("rev-s1-mentor");
        const target = weekdayInWindow();

        const entryRes = await app.inject({
          method: "POST",
          url: "/api/v1/entries",
          headers: bearer(await signToken({ oid: "rev-s1-student" })),
          payload: { entryDate: target, body: "Wrote the student-days endpoint tests." },
        });
        expect(entryRes.statusCode).toBe(200);

        const res = await app.inject({
          method: "GET",
          url: `/api/v1/students/${s.id}/days?from=${target}&to=${target}`,
          headers: bearer(await signToken({ oid: "rev-s1-mentor" })),
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DaySummaryLike[]>();
        expect(body).toHaveLength(1);
        const day = body[0]!;
        expect(day.date).toBe(target);
        expect(day.reportStatus).toBe("Submitted");
        expect(day.reportId).not.toBeNull();
        expect(day.entries).toHaveLength(1);
        expect(day.entries[0]!.body).toBe("Wrote the student-days endpoint tests.");
      });

      it("defaults to the current cycle when from/to are omitted", async () => {
        const s = await student("rev-s2-student");
        await mentor("rev-s2-mentor");
        const { from, to } = resolveRange();

        const res = await app.inject({
          method: "GET",
          url: `/api/v1/students/${s.id}/days`,
          headers: bearer(await signToken({ oid: "rev-s2-mentor" })),
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DaySummaryLike[]>();
        expect(body[0]!.date).toBe(from);
        expect(body.at(-1)!.date).toBe(to);
      });

      it("caps the default range at today, not the cycle's end — a future day has nothing to review yet", async () => {
        const s = await student("rev-s2b-student");
        await mentor("rev-s2b-mentor");
        const today = toProgrammeDate(new Date());

        const res = await app.inject({
          method: "GET",
          url: `/api/v1/students/${s.id}/days`,
          headers: bearer(await signToken({ oid: "rev-s2b-mentor" })),
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DaySummaryLike[]>();
        // The list runs one contiguous day at a time from `from` to `to` --
        // asserting the last entry is today is enough to prove nothing past
        // it (e.g. the cycle's actual end date) is included by default.
        expect(body.at(-1)!.date).toBe(today);
      });

      it("still returns days after today when the caller asks for them explicitly via `to`", async () => {
        const s = await student("rev-s2c-student");
        await mentor("rev-s2c-mentor");
        const future = addDays(toProgrammeDate(new Date()), 5);

        const res = await app.inject({
          method: "GET",
          url: `/api/v1/students/${s.id}/days?to=${future}`,
          headers: bearer(await signToken({ oid: "rev-s2c-mentor" })),
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DaySummaryLike[]>();
        expect(body.at(-1)!.date).toBe(future);
      });

      it("rejects an unknown student id with 404 student-not-found", async () => {
        await mentor("rev-s3-mentor");

        const res = await app.inject({
          method: "GET",
          url: `/api/v1/students/${UNKNOWN_UUID}/days`,
          headers: bearer(await signToken({ oid: "rev-s3-mentor" })),
        });

        expect(res.statusCode).toBe(404);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/student-not-found");
      });

      it("rejects a student token with 403 admin-only", async () => {
        const s = await student("rev-s4-student");

        const res = await app.inject({
          method: "GET",
          url: `/api/v1/students/${s.id}/days`,
          headers: bearer(await signToken({ oid: "rev-s4-student" })),
        });

        expect(res.statusCode).toBe(403);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/admin-only");
      });

      it("returns the three review fields on each entry, reflecting a mentor's review", async () => {
        const s = await student("rev-s5-student");
        await mentor("rev-s5-mentor");
        const mentorHeader = bearer(await signToken({ oid: "rev-s5-mentor" }));
        const target = weekdayInWindow();

        const entryRes = await app.inject({
          method: "POST",
          url: "/api/v1/entries",
          headers: bearer(await signToken({ oid: "rev-s5-student" })),
          payload: { entryDate: target, body: "Entry awaiting review." },
        });
        expect(entryRes.statusCode).toBe(200);
        const entryId = entryRes.json<{ id: string }>().id;

        const before = await app.inject({
          method: "GET",
          url: `/api/v1/students/${s.id}/days?from=${target}&to=${target}`,
          headers: mentorHeader,
        });
        expect(before.statusCode).toBe(200);
        const beforeEntry = before.json<DaySummaryLike[]>()[0]!.entries[0]!;
        expect(beforeEntry.score).toBeNull();
        expect(beforeEntry.mentorFeedback).toBeNull();
        expect(beforeEntry.countsTowardEvaluation).toBe(false);

        const reviewRes = await app.inject({
          method: "PUT",
          url: `/api/v1/entries/${entryId}/review`,
          headers: mentorHeader,
          payload: { score: 92, feedback: "Excellent detail.", countsTowardEvaluation: true },
        });
        expect(reviewRes.statusCode).toBe(200);

        const after = await app.inject({
          method: "GET",
          url: `/api/v1/students/${s.id}/days?from=${target}&to=${target}`,
          headers: mentorHeader,
        });
        expect(after.statusCode).toBe(200);
        const afterEntry = after.json<DaySummaryLike[]>()[0]!.entries[0]!;
        expect(afterEntry.score).toBe(92);
        expect(afterEntry.mentorFeedback).toBe("Excellent detail.");
        expect(afterEntry.countsTowardEvaluation).toBe(true);
      });
    });
  },
);

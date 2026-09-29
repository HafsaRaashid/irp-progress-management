import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { addDays, isWeekday, nextWeekday, previousWeekday, toProgrammeDate, type CivilDate } from "@irp/core";
import { buildTestServer } from "./helpers/build-test-server.js";
import { resolveRange } from "../src/routes/me-days.js";
import { resetDb } from "./helpers/db.js";
import { signToken } from "./helpers/keys.js";
import { dbUrl } from "./helpers/require-db.js";
import type { NotificationEvent } from "../src/services/notification-service.js";

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
  entries: { id: string; entryDate: string; body: string }[];
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
      it("a submitted day is already InReview -- no transition needed to get there", async () => {
        const { reportId } = await submittedReportId("rev-t1-student");

        // No transition call at all. The report exists because a student
        // submitted, and that submission is itself the thing under review
        // (ASSUMPTION: O-19), so inReviewAt is already stamped.
        const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: reportId } });
        expect(row.status).toBe("IN_REVIEW");
        expect(row.inReviewAt).not.toBeNull();
        expect(row.evaluatedAt).toBeNull();
      });

      it("moves InReview to Evaluated (200) in one step, sets reviewedById and evaluatedAt", async () => {
        const { reportId } = await submittedReportId("rev-t2-student");
        const m = await mentor("rev-t2-mentor");

        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearer(await signToken({ oid: "rev-t2-mentor" })),
          payload: { to: "Evaluated" },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<DailyReportLike>();
        expect(body.id).toBe(reportId);
        expect(body.status).toBe("Evaluated");

        const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: reportId } });
        expect(row.status).toBe("EVALUATED");
        expect(row.reviewedById).toBe(m.id);
        expect(row.evaluatedAt).not.toBeNull();
      });

      it("rejects a repeat Evaluated transition with 409 invalid-transition", async () => {
        const { reportId } = await submittedReportId("rev-t3-student");
        await mentor("rev-t3-mentor");
        const bearerHeader = bearer(await signToken({ oid: "rev-t3-mentor" }));

        const first = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearerHeader,
          payload: { to: "Evaluated" },
        });
        expect(first.statusCode).toBe(200);

        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearerHeader,
          payload: { to: "Evaluated" },
        });

        expect(res.statusCode).toBe(409);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/invalid-transition");
      });

      it("rejects `to: InReview` at the contract with 400 -- it is no longer a target, not merely an illegal one", async () => {
        const { reportId } = await submittedReportId("rev-t4-student");
        await mentor("rev-t4-mentor");

        // Deliberately 400, not 409: with one state left to move to,
        // "InReview" is not a value the request body admits at all, so the
        // schema rejects it before any handler decides whether it would
        // have been a legal move. Forward-only is now enforced by the
        // contract's shape rather than by a runtime status comparison.
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${reportId}/transition`,
          headers: bearer(await signToken({ oid: "rev-t4-mentor" })),
          payload: { to: "InReview" },
        });

        expect(res.statusCode).toBe(400);
        expect(res.headers["content-type"]).toContain("application/problem+json");
      });

      it("rejects an unknown report id with 404 report-not-found", async () => {
        await mentor("rev-t5-mentor");

        const res = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${UNKNOWN_UUID}/transition`,
          headers: bearer(await signToken({ oid: "rev-t5-mentor" })),
          payload: { to: "Evaluated" },
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
          payload: { to: "Evaluated" },
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

      it("rejects a day-record write on a finished (Evaluated) day with 409 day-locked", async () => {
        // FR-20 applies to the MENTOR's own record, not just the student's
        // entries. Until 2026-09-28 this path had no lock check at all --
        // the write succeeded and only the Review page declining to render
        // the form stopped it, which is a convention, not a lock. Remove
        // the guard in mentor-record-repo.upsert and this test goes red
        // with a 200; that is the point of it.
        const { studentId } = await submittedReportId("rev-d9-student");
        await mentor("rev-d9-mentor");
        const header = bearer(await signToken({ oid: "rev-d9-mentor" }));
        const target = weekdayInWindow();

        const report = await prisma.dailyReport.findFirstOrThrow({ where: { studentId } });
        const finish = await app.inject({
          method: "POST",
          url: `/api/v1/daily-reports/${report.id}/transition`,
          headers: header,
          payload: { to: "Evaluated" },
        });
        expect(finish.statusCode).toBe(200);

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/students/${studentId}/day-records/${target}`,
          headers: header,
          payload: { attended: true, tasksCompleted: true },
        });

        expect(res.statusCode).toBe(409);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/day-locked");
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
        expect(day.reportStatus).toBe("InReview");
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
    });
  },
);

// FR-21: same isolation rationale as entries-endpoint.test.ts's notification
// describe block — a dedicated app instance carrying a spy notificationService.
describe.skipIf(!dbUrl)("POST /api/v1/daily-reports/{id}/transition — notifications (FR-21)", () => {
  let app: FastifyInstance;
  let prisma: Awaited<ReturnType<typeof buildTestServer>>["prisma"];
  const notify = vi.fn<(event: NotificationEvent) => void>();

  beforeAll(async () => {
    ({ app, prisma } = await buildTestServer(dbUrl!, { notificationService: { notify } }));
  });
  beforeEach(async () => {
    await resetDb(prisma);
    notify.mockReset();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function weekdayInWindow(): CivilDate {
    const today = toProgrammeDate(new Date());
    return isWeekday(today) ? today : previousWeekday(today);
  }

  async function submittedReportId(studentExternalId: string): Promise<{ studentId: string; reportId: string }> {
    const s = await prisma.user.create({
      data: {
        externalId: studentExternalId, email: `${studentExternalId}@dev.local`,
        displayName: studentExternalId, role: "STUDENT",
      },
    });
    const target = weekdayInWindow();
    const entryRes = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: studentExternalId })),
      payload: { entryDate: target, body: "Work for the notification test." },
    });
    expect(entryRes.statusCode).toBe(200);
    const report = await prisma.dailyReport.findFirstOrThrow({ where: { studentId: s.id } });
    return { studentId: s.id, reportId: report.id };
  }

  it("still returns 200 and commits the transition when notify() throws on every call", async () => {
    notify.mockImplementation(() => {
      throw new Error("notification dispatch exploded");
    });
    const { reportId } = await submittedReportId("notif-rev-1-student");
    await prisma.user.create({
      data: { externalId: "notif-rev-1-mentor", email: "notif-rev-1-mentor@dev.local", displayName: "m", role: "ADMIN" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/daily-reports/${reportId}/transition`,
      headers: bearer(await signToken({ oid: "notif-rev-1-mentor" })),
      payload: { to: "Evaluated" },
    });

    expect(res.statusCode).toBe(200);
    const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: reportId } });
    expect(row.status).toBe("EVALUATED");
  });

  it("calls notify() exactly once per transition, with `to` matching the request", async () => {
    const { studentId, reportId } = await submittedReportId("notif-rev-2-student");
    await prisma.user.create({
      data: { externalId: "notif-rev-2-mentor", email: "notif-rev-2-mentor@dev.local", displayName: "m", role: "ADMIN" },
    });
    const bearerHeader = bearer(await signToken({ oid: "notif-rev-2-mentor" }));
    // submittedReportId's own entry submission already triggered one
    // EntrySubmitted notify() call — not the transition this test asserts on.
    notify.mockClear();

    // One transition exists now, so "once per transition" is asserted over
    // the single one there is -- and the repeat below proves the count does
    // not creep on a rejected attempt.
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/daily-reports/${reportId}/transition`,
      headers: bearerHeader,
      payload: { to: "Evaluated" },
    });
    expect(first.statusCode).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ReportTransitioned", studentId, reportId, to: "Evaluated" }),
    );

    // Already Evaluated: 409, and crucially NO second notification -- a
    // student must not be told their day was finished twice.
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/daily-reports/${reportId}/transition`,
      headers: bearerHeader,
      payload: { to: "Evaluated" },
    });
    expect(second.statusCode).toBe(409);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

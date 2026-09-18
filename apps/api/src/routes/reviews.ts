import type { FastifyPluginAsync } from "fastify";
import { civilDate, compareDates, isWeekday, toProgrammeDate } from "@irp/core";
import type { components } from "@irp/types";
import type { EntryRepo, DailyReportRecord } from "../db/entry-repo.js";
import type { UserRepo } from "../db/user-repo.js";
import type { MentorRecordRepo, MentorDayRecordShape } from "../db/mentor-record-repo.js";
import type { DayService } from "../services/day-service.js";
import { StudentNotFoundError, WeekendDayRecordError, FutureDayRecordError } from "../domain/errors.js";
import { requireAdmin } from "../plugins/roles.js";
import { toApiEntryForMentor } from "./entries.js";
import { REPORT_STATUS_TO_API, resolveRange, toApiDay, DAYS_QUERY } from "./me-days.js";
import { TRANSITION_BODY, DAY_RECORD_BODY, UUID_PARAM, STUDENT_DATE_PARAM } from "./schemas.js";

type ApiDailyReport = components["schemas"]["DailyReport"];
type ApiDayRecord = components["schemas"]["DayRecord"];

// The API's `to` casing to the generated Prisma enum's — the inverse of
// REPORT_STATUS_TO_API, and deliberately only the two forward targets a
// caller may request (there is no "SUBMITTED" target; nothing moves back).
const TO_DB_STATUS = { InReview: "IN_REVIEW", Evaluated: "EVALUATED" } as const;

function toApiDailyReport(r: DailyReportRecord): ApiDailyReport {
  return {
    id: r.id,
    studentId: r.studentId,
    reportDate: r.reportDate,
    status: REPORT_STATUS_TO_API[r.status],
  };
}

function toApiDayRecord(r: MentorDayRecordShape): ApiDayRecord {
  return {
    id: r.id,
    studentId: r.studentId,
    date: r.date,
    attended: r.attended,
    tasksCompleted: r.tasksCompleted,
    note: r.note,
    recordedById: r.recordedById,
  };
}

/**
 * Resolves the student named in the path. `findById` is unfiltered by
 * deletedAt (an archived student's history is still reviewable), but the
 * role must be STUDENT — a mentor id in the same path shape is treated as
 * "no such student" (404), not answered.
 *
 * Exported for reuse by admin-actions.ts's transferStudent handler, which
 * needs the identical "exists and is a STUDENT" check before handing off to
 * BatchRepo.transfer.
 */
export async function resolveStudent(userRepo: UserRepo, id: string) {
  const user = await userRepo.findById(id);
  if (user?.role !== "STUDENT") throw new StudentNotFoundError(id);
  return user;
}

export const reviewRoutes: FastifyPluginAsync<{
  entryRepo: EntryRepo;
  userRepo: UserRepo;
  mentorRecordRepo: MentorRecordRepo;
  dayService: DayService;
  // eslint-disable-next-line @typescript-eslint/require-await
}> = async (app, opts) => {
  app.post<{ Params: { id: string }; Body: components["schemas"]["TransitionRequest"] }>(
    "/api/v1/daily-reports/:id/transition",
    { schema: { params: UUID_PARAM, body: TRANSITION_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiDailyReport> => {
      requireAdmin(req);
      const to = TO_DB_STATUS[req.body.to];
      const report = await opts.entryRepo.transition(req.params.id, to, req.user!.id, new Date());
      return toApiDailyReport(report);
    },
  );

  app.put<{ Params: { id: string; date: string }; Body: components["schemas"]["DayRecordUpsert"] }>(
    "/api/v1/students/:id/day-records/:date",
    { schema: { params: STUDENT_DATE_PARAM, body: DAY_RECORD_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiDayRecord> => {
      requireAdmin(req);
      await resolveStudent(opts.userRepo, req.params.id);
      const date = civilDate(req.params.date);
      if (!isWeekday(date)) throw new WeekendDayRecordError(req.params.date);
      if (compareDates(date, toProgrammeDate(new Date())) > 0) {
        throw new FutureDayRecordError(req.params.date);
      }
      const record = await opts.mentorRecordRepo.upsert({
        studentId: req.params.id,
        date,
        attended: req.body.attended,
        tasksCompleted: req.body.tasksCompleted,
        ...(req.body.note !== undefined && { note: req.body.note }),
        recordedById: req.user!.id,
      });
      return toApiDayRecord(record);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    "/api/v1/students/:id/days",
    { schema: { params: UUID_PARAM, querystring: DAYS_QUERY }, preHandler: [app.authenticate] },
    async (req): Promise<components["schemas"]["DaySummary"][]> => {
      requireAdmin(req);
      await resolveStudent(opts.userRepo, req.params.id);
      const now = new Date();
      const { from, to } = resolveRange(req.query.from, req.query.to, now);
      const days = await opts.dayService.listDays(req.params.id, from, to, now);
      return days.map((v) => toApiDay(v, toApiEntryForMentor));
    },
  );

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    "/api/v1/students/:id/day-records",
    { schema: { params: UUID_PARAM, querystring: DAYS_QUERY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiDayRecord[]> => {
      requireAdmin(req);
      await resolveStudent(opts.userRepo, req.params.id);
      const { from, to } = resolveRange(req.query.from, req.query.to, new Date());
      const records = await opts.mentorRecordRepo.listForStudent(req.params.id, from, to);
      return records.map(toApiDayRecord);
    },
  );
};

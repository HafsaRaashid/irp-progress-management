import type { CivilDate } from "@irp/core";
import { decideEntryFlags } from "../domain/entry-flags.js";
import {
  AbsentDayConflictError,
  LockedDayError,
  ReportNotFoundError,
  InvalidTransitionError,
} from "../domain/errors.js";
import type { DailyReportStatus, PrismaClient } from "../generated/prisma/client.js";
import { fromDbDate, toDbDate } from "./civil-date-map.js";
import { lockStudentDay } from "./day-lock.js";

// Mirrors REPORT_STATUS_TO_API in ../routes/me-days.ts. Duplicated rather
// than imported: db/ is a lower layer than routes/, and entry-repo.ts is
// itself pulled in (type-only, today) by routes/entries.ts, which
// routes/me-days.ts also imports -- reaching from here into routes/ would
// invert that layering even though no runtime cycle exists yet. A three-line
// map is cheaper than depending on that staying true.
const TRANSITION_STATUS_TO_API: Record<DailyReportStatus, "InReview" | "Evaluated"> = {
  IN_REVIEW: "InReview",
  EVALUATED: "Evaluated",
};

export interface EntryRecord {
  id: string;
  studentId: string;
  entryDate: CivilDate;
  body: string;
  submittedAt: Date;
  isLate: boolean;
  isExtra: boolean;
  /** Self-reported minutes in meetings (FR-17, ADR-0033). Null when not given. */
  meetingMinutes: number | null;
}

export interface DailyReportRecord {
  id: string;
  studentId: string;
  reportDate: CivilDate;
  status: DailyReportStatus;
}

export interface EntryRepo {
  addEntry(input: {
    studentId: string;
    entryDate: CivilDate;
    body: string;
    submittedAt: Date;
    /** Omitted, not merely undefined-vs-0: an absent value must store NULL, not 0. */
    meetingMinutes?: number;
  }): Promise<EntryRecord>;
  listEntries(studentId: string, from: CivilDate, to: CivilDate): Promise<EntryRecord[]>;
  getReport(studentId: string, date: CivilDate): Promise<DailyReportRecord | null>;
  listReports(studentId: string, from: CivilDate, to: CivilDate): Promise<DailyReportRecord[]>;
  /** Batched sibling of listEntries — same ordering, one query for many students (ADR-0018). */
  listEntriesForStudents(studentIds: string[], from: CivilDate, to: CivilDate): Promise<EntryRecord[]>;
  /** Batched sibling of listReports (ADR-0018). */
  listReportsForStudents(studentIds: string[], from: CivilDate, to: CivilDate): Promise<DailyReportRecord[]>;
  /**
   * The one forward transition left: IN_REVIEW -> EVALUATED (FR-18, FR-20).
   * `to` is a single-member union rather than a boolean-ish flag so the call
   * site still reads as a destination, and so adding a state later is a type
   * error at every caller rather than a silent behaviour change.
   */
  transition(
    reportId: string,
    to: "EVALUATED",
    mentorId: string,
    now: Date,
  ): Promise<DailyReportRecord>;
}

interface DbEntry {
  id: string; studentId: string; entryDate: Date; body: string;
  submittedAt: Date; isLate: boolean; isExtra: boolean; meetingMinutes: number | null;
}

function mapEntry(e: DbEntry): EntryRecord {
  return {
    id: e.id,
    studentId: e.studentId,
    entryDate: fromDbDate(e.entryDate),
    body: e.body,
    submittedAt: e.submittedAt,
    isLate: e.isLate,
    isExtra: e.isExtra,
    meetingMinutes: e.meetingMinutes,
  };
}

export function createEntryRepo(prisma: PrismaClient): EntryRepo {
  return {
    // The flags call throws SubmissionWindowClosedError before anything is
    // written, so an illegal date never reaches the database (FR-15 by
    // construction). Time validation is against the submittedAt INSTANT —
    // Plan 6 handlers pass new Date(); the seed passes history.
    async addEntry(input) {
      const flags = decideEntryFlags(input.entryDate, input.submittedAt);
      const dbDate = toDbDate(input.entryDate);

      return prisma.$transaction(async (tx) => {
        await lockStudentDay(tx, input.studentId, input.entryDate);
        const report = await tx.dailyReport.findUnique({
          where: { studentId_reportDate: { studentId: input.studentId, reportDate: dbDate } },
        });
        if (report?.status === "EVALUATED") {
          throw new LockedDayError(input.entryDate);
        }
        const absence = await tx.absenceRecord.findUnique({
          where: { studentId_date: { studentId: input.studentId, date: dbDate } },
        });
        if (absence) {
          throw new AbsentDayConflictError(input.entryDate);
        }
        // Upsert, not find-then-create: two concurrent first entries for the
        // same day would both see no report and the loser would throw P2002.
        // Prisma compiles this shape to a native INSERT ... ON CONFLICT.
        // Born IN_REVIEW, with inReviewAt stamped at the same instant: the
        // submission IS the thing under review, so there is no earlier state
        // for a mentor to move it out of (interview Q14, ASSUMPTION: O-19).
        // `update: {}` still -- a second entry on the same day must not reset
        // inReviewAt, and must not drag an already-EVALUATED day backwards
        // (it cannot reach here anyway; the lock check above throws first).
        await tx.dailyReport.upsert({
          where: { studentId_reportDate: { studentId: input.studentId, reportDate: dbDate } },
          update: {},
          create: {
            studentId: input.studentId,
            reportDate: dbDate,
            status: "IN_REVIEW",
            inReviewAt: input.submittedAt,
          },
        });
        const entry = await tx.entry.create({
          data: {
            studentId: input.studentId,
            entryDate: dbDate,
            body: input.body,
            submittedAt: input.submittedAt,
            isLate: flags.isLate,
            isExtra: flags.isExtra,
            // ?? null, not left as `number | undefined`: this tsconfig's
            // exactOptionalPropertyTypes forbids assigning a bare `undefined`
            // to a property Prisma types as `number | null` (no undefined in
            // the union) -- the generated create input wants the key either
            // OMITTED or explicitly null, and null is also the correct
            // semantic value here: "not reported" IS null, not merely absent.
            meetingMinutes: input.meetingMinutes ?? null,
          },
        });
        return mapEntry(entry);
      });
    },

    async listEntries(studentId, from, to) {
      const rows = await prisma.entry.findMany({
        where: { studentId, entryDate: { gte: toDbDate(from), lte: toDbDate(to) } },
        orderBy: [{ entryDate: "asc" }, { submittedAt: "asc" }],
      });
      return rows.map(mapEntry);
    },

    async getReport(studentId, date) {
      const r = await prisma.dailyReport.findUnique({
        where: { studentId_reportDate: { studentId, reportDate: toDbDate(date) } },
      });
      if (!r) return null;
      return { id: r.id, studentId: r.studentId, reportDate: fromDbDate(r.reportDate), status: r.status };
    },

    async listReports(studentId, from, to) {
      const rows = await prisma.dailyReport.findMany({
        where: { studentId, reportDate: { gte: toDbDate(from), lte: toDbDate(to) } },
        orderBy: { reportDate: "asc" },
      });
      return rows.map((r) => ({
        id: r.id, studentId: r.studentId, reportDate: fromDbDate(r.reportDate), status: r.status,
      }));
    },

    async listEntriesForStudents(studentIds, from, to) {
      if (studentIds.length === 0) return [];
      const rows = await prisma.entry.findMany({
        where: { studentId: { in: studentIds }, entryDate: { gte: toDbDate(from), lte: toDbDate(to) } },
        orderBy: [{ entryDate: "asc" }, { submittedAt: "asc" }],
      });
      return rows.map(mapEntry);
    },

    async listReportsForStudents(studentIds, from, to) {
      if (studentIds.length === 0) return [];
      const rows = await prisma.dailyReport.findMany({
        where: { studentId: { in: studentIds }, reportDate: { gte: toDbDate(from), lte: toDbDate(to) } },
        orderBy: { reportDate: "asc" },
      });
      return rows.map((r) => ({
        id: r.id, studentId: r.studentId, reportDate: fromDbDate(r.reportDate), status: r.status,
      }));
    },

    // updateMany with the expected current status in the `where` is the
    // concurrency guard: two mentors racing the same step both attempt the
    // same conditional update, and exactly one sees count === 1.
    async transition(reportId, to, mentorId, now) {
      // One transition exists now: IN_REVIEW -> EVALUATED. `to` is typed to
      // that single value, so there is no branch left to take -- the second
      // step went away with SUBMITTED (ASSUMPTION: O-19).
      const { count } = await prisma.dailyReport.updateMany({
        where: { id: reportId, status: "IN_REVIEW" },
        data: { status: to, reviewedById: mentorId, evaluatedAt: now },
      });
      if (count === 0) {
        const current = await prisma.dailyReport.findUnique({ where: { id: reportId } });
        if (!current) throw new ReportNotFoundError(reportId);
        // current.status/to are DB enum casing (SUBMITTED/IN_REVIEW/EVALUATED)
        // -- InvalidTransitionError's message is API-facing, so both are
        // mapped to API vocabulary before it ever sees them.
        throw new InvalidTransitionError(
          TRANSITION_STATUS_TO_API[current.status],
          TRANSITION_STATUS_TO_API[to],
        );
      }
      const r = await prisma.dailyReport.findUniqueOrThrow({ where: { id: reportId } });
      return { id: r.id, studentId: r.studentId, reportDate: fromDbDate(r.reportDate), status: r.status };
    },
  };
}

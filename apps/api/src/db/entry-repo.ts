import type { CivilDate } from "@irp/core";
import { decideEntryFlags } from "../domain/entry-flags.js";
import {
  AbsentDayConflictError,
  LockedDayError,
  ReportNotFoundError,
  InvalidTransitionError,
  EntryNotFoundError,
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
const TRANSITION_STATUS_TO_API: Record<DailyReportStatus, "Submitted" | "InReview" | "Evaluated"> = {
  SUBMITTED: "Submitted",
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
  score: number | null;
  mentorFeedback: string | null;
  countsTowardEvaluation: boolean;
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
  }): Promise<EntryRecord>;
  listEntries(studentId: string, from: CivilDate, to: CivilDate): Promise<EntryRecord[]>;
  getReport(studentId: string, date: CivilDate): Promise<DailyReportRecord | null>;
  listReports(studentId: string, from: CivilDate, to: CivilDate): Promise<DailyReportRecord[]>;
  /** Batched sibling of listEntries — same ordering, one query for many students (ADR-0018). */
  listEntriesForStudents(studentIds: string[], from: CivilDate, to: CivilDate): Promise<EntryRecord[]>;
  /** Batched sibling of listReports (ADR-0018). */
  listReportsForStudents(studentIds: string[], from: CivilDate, to: CivilDate): Promise<DailyReportRecord[]>;
  transition(
    reportId: string,
    to: "IN_REVIEW" | "EVALUATED",
    mentorId: string,
    now: Date,
  ): Promise<DailyReportRecord>;
  /**
   * A mentor's full-replace review of one entry (FR-10/FR-11/FR-19,
   * ASSUMPTION: O-18): score, feedback, and the evaluation-inclusion flag are
   * set together in one write. Same lock shape as `addEntry` — resolves the
   * entry's parent `DailyReport` by (studentId, entryDate) and throws
   * `LockedDayError` if it is `EVALUATED` (FR-20).
   *
   * Scoring an entry is itself review activity: a still-`SUBMITTED` day is
   * advanced to `IN_REVIEW` in the same transaction, so a mentor never needs
   * a separate manual "start review" step first. This method never actually
   * required `IN_REVIEW` to already hold before accepting a review write —
   * the auto-advance just makes the day's UI-visible status agree with what
   * was already true underneath it.
   */
  reviewEntry(
    id: string,
    input: { score: number; mentorFeedback: string; countsTowardEvaluation: boolean },
    mentorId: string,
    now: Date,
  ): Promise<EntryRecord>;
}

interface DbEntry {
  id: string; studentId: string; entryDate: Date; body: string;
  submittedAt: Date; isLate: boolean; isExtra: boolean;
  score: number | null; mentorFeedback: string | null; countsTowardEvaluation: boolean;
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
    score: e.score,
    mentorFeedback: e.mentorFeedback,
    countsTowardEvaluation: e.countsTowardEvaluation,
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
        await tx.dailyReport.upsert({
          where: { studentId_reportDate: { studentId: input.studentId, reportDate: dbDate } },
          update: {},
          create: { studentId: input.studentId, reportDate: dbDate },
        });
        const entry = await tx.entry.create({
          data: {
            studentId: input.studentId,
            entryDate: dbDate,
            body: input.body,
            submittedAt: input.submittedAt,
            isLate: flags.isLate,
            isExtra: flags.isExtra,
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
      let count: number;
      if (to === "IN_REVIEW") {
        ({ count } = await prisma.dailyReport.updateMany({
          where: { id: reportId, status: "SUBMITTED" },
          data: { status: to, reviewedById: mentorId, inReviewAt: now },
        }));
      } else {
        // EVALUATED is reachable directly from SUBMITTED now, not only from
        // IN_REVIEW: per-submission review can advance a day to InReview on
        // its own (reviewEntry, below), so requiring a separate manual
        // "Start review" step before evaluating is no longer necessary --
        // nor is scoring an entry required at all before evaluating. Two
        // attempts, not one updateMany over both statuses, because the data
        // written differs: inReviewAt is only backfilled to `now` when
        // jumping straight from SUBMITTED -- a day already IN_REVIEW keeps
        // its real inReviewAt instant.
        ({ count } = await prisma.dailyReport.updateMany({
          where: { id: reportId, status: "IN_REVIEW" },
          data: { status: to, reviewedById: mentorId, evaluatedAt: now },
        }));
        if (count === 0) {
          ({ count } = await prisma.dailyReport.updateMany({
            where: { id: reportId, status: "SUBMITTED" },
            data: { status: to, reviewedById: mentorId, inReviewAt: now, evaluatedAt: now },
          }));
        }
      }
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

    async reviewEntry(id, input, mentorId, now) {
      return prisma.$transaction(async (tx) => {
        const entry = await tx.entry.findUnique({ where: { id } });
        if (!entry) throw new EntryNotFoundError(id);

        const entryDate = fromDbDate(entry.entryDate);
        await lockStudentDay(tx, entry.studentId, entryDate);

        const report = await tx.dailyReport.findUnique({
          where: { studentId_reportDate: { studentId: entry.studentId, reportDate: entry.entryDate } },
        });
        if (report?.status === "EVALUATED") {
          throw new LockedDayError(entryDate);
        }
        if (report?.status === "SUBMITTED") {
          await tx.dailyReport.update({
            where: { id: report.id },
            data: { status: "IN_REVIEW", reviewedById: mentorId, inReviewAt: now },
          });
        }

        const updated = await tx.entry.update({
          where: { id },
          data: {
            score: input.score,
            mentorFeedback: input.mentorFeedback,
            countsTowardEvaluation: input.countsTowardEvaluation,
          },
        });
        return mapEntry(updated);
      });
    },
  };
}

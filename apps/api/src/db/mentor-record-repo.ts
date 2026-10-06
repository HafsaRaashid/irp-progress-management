import type { CivilDate } from "@irp/core";
import type { PrismaClient } from "../generated/prisma/client.js";
import { LockedDayError } from "../domain/errors.js";
import { fromDbDate, toDbDate } from "./civil-date-map.js";
import { lockStudentDay } from "./day-lock.js";

export interface MentorDayRecordShape {
  id: string;
  studentId: string;
  date: CivilDate;
  attended: boolean;
  tasksCompleted: boolean;
  note: string | null;
  recordedById: string;
}

export interface MentorRecordRepo {
  upsert(input: {
    studentId: string;
    date: CivilDate;
    attended: boolean;
    tasksCompleted: boolean;
    note?: string;
    recordedById: string;
  }): Promise<MentorDayRecordShape>;
  get(studentId: string, date: CivilDate): Promise<MentorDayRecordShape | null>;
  /**
   * Every stored record for one student in [from, to], date ascending — the
   * review page's prefill source (GET /api/v1/students/{id}/day-records).
   * Same range shape as EntryRepo/AbsenceRepo's listForStudent: a gte/lte
   * window over the mapped DB date, ordered by that same column.
   */
  listForStudent(studentId: string, from: CivilDate, to: CivilDate): Promise<MentorDayRecordShape[]>;
  /** Batched sibling of listForStudent (ADR-0018), for the per-day view. */
  listForStudents(studentIds: string[], from: CivilDate, to: CivilDate): Promise<MentorDayRecordShape[]>;
}

interface DbRecord {
  id: string; studentId: string; date: Date; attended: boolean;
  tasksCompleted: boolean; note: string | null; recordedById: string;
}

function map(r: DbRecord): MentorDayRecordShape {
  return { ...r, date: fromDbDate(r.date) };
}

export function createMentorRecordRepo(prisma: PrismaClient): MentorRecordRepo {
  return {
    /**
     * FR-20: a finished day is locked, and that now holds for the MENTOR's
     * own record too, not just the student's entries.
     *
     * It did not until 2026-09-28. `entry-repo.addEntry` and the absence
     * writes both threw `LockedDayError` on an EVALUATED day, but this path
     * had no check at all -- so `PUT /students/{id}/day-records/{date}`
     * succeeded against a finished day, and the only thing preventing it was
     * the Review page declining to render the form. A lock enforced by the
     * UI alone is not a lock; interview **Q17** ("can the admin change an
     * approval decision later?" -> *"approval decisions won't change
     * later"*) is a rule about the system, not about one screen.
     *
     * Same shape as addEntry deliberately: the advisory lock first
     * (ADR-0016), then the report read, then the write, all inside one
     * transaction -- otherwise two mentors racing a save against a day
     * being finished could both read IN_REVIEW and both write.
     */
    async upsert(input) {
      const dbDate = toDbDate(input.date);
      return prisma.$transaction(async (tx) => {
        await lockStudentDay(tx, input.studentId, input.date);
        const report = await tx.dailyReport.findUnique({
          where: { studentId_reportDate: { studentId: input.studentId, reportDate: dbDate } },
        });
        if (report?.status === "EVALUATED") {
          throw new LockedDayError(input.date);
        }
        const data = {
          attended: input.attended,
          tasksCompleted: input.tasksCompleted,
          note: input.note ?? null,
          recordedById: input.recordedById,
        };
        const row = await tx.mentorDayRecord.upsert({
          where: { studentId_date: { studentId: input.studentId, date: dbDate } },
          update: data,
          create: { studentId: input.studentId, date: dbDate, ...data },
        });
        return map(row);
      });
    },

    async get(studentId, date) {
      const row = await prisma.mentorDayRecord.findUnique({
        where: { studentId_date: { studentId, date: toDbDate(date) } },
      });
      return row ? map(row) : null;
    },

    async listForStudent(studentId, from, to) {
      const rows = await prisma.mentorDayRecord.findMany({
        where: { studentId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
        orderBy: { date: "asc" },
      });
      return rows.map(map);
    },

    async listForStudents(studentIds, from, to) {
      if (studentIds.length === 0) return [];
      const rows = await prisma.mentorDayRecord.findMany({
        where: { studentId: { in: studentIds }, date: { gte: toDbDate(from), lte: toDbDate(to) } },
        orderBy: { date: "asc" },
      });
      return rows.map(map);
    },
  };
}

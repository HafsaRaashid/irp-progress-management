/**
 * Idempotent demo seed (spec §6). Personas are deterministic functions of
 * the calendar — no randomness, no hand-set flags. Every entry goes through
 * entry-repo.addEntry with its HISTORICAL submittedAt, so isLate/isExtra are
 * decided by the same rule production uses; a state the engine cannot
 * produce cannot enter the database. No written instant is ever later than
 * `now` — history that hasn't happened yet is skipped, not invented.
 */
import {
  addDays,
  compareDates,
  cycleContaining,
  dayOfWeek,
  isWeekday,
  nextWeekday,
  shiftCycle,
  toProgrammeDate,
  workingDaysBetween,
} from "@irp/core";
import {
  SEED_BATCH_NAMES,
  SEED_EXTERNAL_IDS,
  SEED_MENTORS,
  SEED_STUDENTS,
  type SeedStudent,
} from "@irp/fixtures";
import type { PrismaClient } from "../generated/prisma/client.js";
import { colomboInstant, fromDbDate, toDbDate } from "../db/civil-date-map.js";
import { createAbsenceRepo } from "../db/absence-repo.js";
import { createBatchRepo } from "../db/batch-repo.js";
import { createCycleRepo } from "../db/cycle-repo.js";
import { createEntryRepo } from "../db/entry-repo.js";
import { createMentorRecordRepo } from "../db/mentor-record-repo.js";

const PROSE = [
  "Continued the invoice-parsing task; the edge cases around multi-page PDFs are nastier than expected.",
  "Paired with my mentor on the review comments from yesterday and reworked the validation layer.",
  "Wrote unit tests for the date-handling module and fixed two boundary bugs they caught.",
  "Attended the architecture walkthrough and took notes on the deployment pipeline.",
  "Refactored the report generator; extracted the formatting into its own module.",
  "Investigated the flaky integration test — root cause was a shared fixture; isolated it.",
  "Documented the API endpoints I built this week and added examples to each schema.",
  "Finished the batch-import feature and demoed it at the afternoon stand-up.",
];

const ABSENCE_REASONS = [
  "Medical appointment",
  "Family emergency — informed the mentor in the morning",
  "University exam",
];

function prose(dayIndex: number, salt: number): string {
  return PROSE[(dayIndex + salt) % PROSE.length]!;
}

/** Deterministic per-persona behaviour for one required day. */
type DayPlan =
  | { kind: "onTime"; time: string }
  | { kind: "late" }
  | { kind: "skip" }
  | { kind: "absent"; reason: string };

function planFor(student: SeedStudent, dayIndex: number): DayPlan {
  const onTime = { kind: "onTime", time: `17:${String(10 + ((dayIndex * 7) % 40)).padStart(2, "0")}` } as const;
  switch (student.kind) {
    case "late":
      return dayIndex % 3 === 2 ? { kind: "late" } : onTime;
    case "missed":
      return dayIndex % 4 === 3 ? { kind: "skip" } : onTime;
    case "absent":
      return dayIndex % 5 === 4
        ? { kind: "absent", reason: ABSENCE_REASONS[dayIndex % ABSENCE_REASONS.length]! }
        : onTime;
    case "mixed":
      if (dayIndex % 9 === 8) return { kind: "absent", reason: ABSENCE_REASONS[0]! };
      if (dayIndex % 6 === 3) return { kind: "skip" };
      if (dayIndex % 5 === 1) return { kind: "late" };
      return onTime;
    default:
      return onTime; // compliant, weekend (weekday part), joiner, transfer, archived
  }
}

export async function runSeed(prisma: PrismaClient, now: Date): Promise<void> {
  const today = toProgrammeDate(now);
  const currentCycle = cycleContaining(today);

  // ── wipe exactly what we own ─────────────────────────────────────────────
  const seedUsers = await prisma.user.findMany({ where: { externalId: { in: [...SEED_EXTERNAL_IDS] } } });
  const ids = seedUsers.map((u) => u.id);
  await prisma.$transaction([
    prisma.award.deleteMany({ where: { evaluation: { studentId: { in: ids } } } }),
    prisma.override.deleteMany({ where: { evaluation: { studentId: { in: ids } } } }),
    prisma.evaluation.deleteMany({ where: { studentId: { in: ids } } }),
    prisma.entry.deleteMany({ where: { studentId: { in: ids } } }),
    prisma.dailyReport.deleteMany({ where: { studentId: { in: ids } } }),
    prisma.mentorDayRecord.deleteMany({ where: { studentId: { in: ids } } }),
    prisma.absenceRecord.deleteMany({ where: { studentId: { in: ids } } }),
    // OR'd with "enrolled in a seed-owned batch", not just "studentId in
    // ids": the seed owns its batches by NAME, via SEED_BATCH_NAMES (the
    // cycle deleteMany right below already reflects that), and the batch
    // deleteMany two lines down throws a Prisma P2003 foreign-key violation
    // if ANY enrolment still references one of those batch ids -- including
    // a non-seed student's. Task 16's e2e Students-page registration test
    // proved this: a throwaway student registered into batch B and then
    // archived (soft-deleted, externalId never in SEED_EXTERNAL_IDS) left
    // its Enrolment row behind, and the NEXT db:seed run failed on
    // Enrolment_batchId_fkey trying to delete that batch out from under it.
    // Archiving a user only soft-deletes the User row; it was never going to
    // clear their Enrolment too.
    //
    // Ownership-by-name also means RENAMING SEED_BATCH_NAMES orphans the old
    // rows rather than migrating them: an existing dev database keeps the
    // previously-named batches (their cycles intact, enrolments cleared by
    // the studentId arm above) and gains the new ones, so the batch picker
    // shows both sets. Delete the old rows by name once, by hand, after any
    // such rename -- this happened on 2026-08-04 going from
    // "Batch Aurora"/"Batch Basalt" to "Batch 1"/"Batch 2".
    prisma.enrolment.deleteMany({
      where: {
        OR: [{ studentId: { in: ids } }, { batch: { name: { in: Object.values(SEED_BATCH_NAMES) } } }],
      },
    }),
    prisma.cycle.deleteMany({ where: { batch: { name: { in: Object.values(SEED_BATCH_NAMES) } } } }),
    prisma.batch.deleteMany({ where: { name: { in: Object.values(SEED_BATCH_NAMES) } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);

  // ── users ────────────────────────────────────────────────────────────────
  const mentorRows: { id: string }[] = [];
  for (const m of SEED_MENTORS) {
    mentorRows.push(await prisma.user.create({
      data: { externalId: m.externalId, email: m.email, displayName: m.name, role: "ADMIN" },
    }));
  }
  const studentRows = new Map<string, { id: string }>();
  for (const s of SEED_STUDENTS) {
    const row = await prisma.user.create({
      data: { externalId: s.externalId, email: s.email, displayName: s.name, role: "STUDENT" },
    });
    studentRows.set(s.externalId, row);
  }
  const studentIds = [...studentRows.values()].map((r) => r.id);

  // ── batches: A two cycles back, B at the current cycle start ────────────
  const batches = createBatchRepo(prisma);
  const aStart = shiftCycle(currentCycle.start, -2);
  const bStart = currentCycle.start;
  const batchA = await batches.create({ name: SEED_BATCH_NAMES.A, startDate: aStart, endDate: addDays(shiftCycle(aStart, 6), -1) });
  const batchB = await batches.create({ name: SEED_BATCH_NAMES.B, startDate: bStart, endDate: addDays(shiftCycle(bStart, 6), -1) });
  const batchIds = { A: batchA.id, B: batchB.id };

  // ── enrolments ───────────────────────────────────────────────────────────
  const transferDate = bStart; // Amaya moves A -> B when B opens
  for (const s of SEED_STUDENTS) {
    const id = studentRows.get(s.externalId)!.id;
    if (s.kind === "transfer") {
      await batches.enrol(id, batchIds.A, aStart);
      await batches.transfer(id, batchIds.B, transferDate);
    } else if (s.kind === "joiner") {
      // First weekday at least 3 days into the current cycle (FR-27 setup).
      let join = addDays(currentCycle.start, 3);
      while (!isWeekday(join)) join = addDays(join, 1);
      await batches.enrol(id, batchIds.B, join);
    } else {
      await batches.enrol(id, batchIds[s.batch], s.batch === "A" ? aStart : bStart);
    }
  }

  // ── entries, absences ────────────────────────────────────────────────────
  const entries = createEntryRepo(prisma);
  const absences = createAbsenceRepo(prisma);

  for (const s of SEED_STUDENTS) {
    const id = studentRows.get(s.externalId)!.id;
    const enrolment = await prisma.enrolment.findFirstOrThrow({
      where: { studentId: id }, orderBy: { startDate: "asc" },
    });
    const from = fromDbDate(enrolment.startDate);
    // The archived student stops three weeks after their batch starts.
    const to = s.kind === "archived" ? addDays(from, 21) : today;
    if (compareDates(from, to) > 0) continue;

    const days = workingDaysBetween(from, to);
    const salt = [...s.externalId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);

    // Never write an instant later than `now` — skip, don't clamp. A morning
    // seed run leaves today honestly pending; an evening run shows it
    // submitted. `hasHappened` is the ONLY gate; the engine still owns flags.
    const hasHappened = (instant: Date): boolean => instant.getTime() <= now.getTime();

    for (const [i, day] of days.entries()) {
      const plan = planFor(s, i);
      if (plan.kind === "skip") continue;
      if (plan.kind === "absent") {
        await absences.create({ studentId: id, date: day, reason: plan.reason });
        continue;
      }
      if (plan.kind === "late") {
        // Next weekday, 09:40 Colombo — inside grace, flagged late by the engine.
        const next = nextWeekday(day);
        const at = colomboInstant(next, "09:40");
        if (hasHappened(at)) {
          await entries.addEntry({ studentId: id, entryDate: day, body: prose(i, salt), submittedAt: at });
        }
        continue;
      }
      const at = colomboInstant(day, plan.time);
      if (!hasHappened(at)) continue;
      await entries.addEntry({ studentId: id, entryDate: day, body: prose(i, salt), submittedAt: at });
      // A second same-day entry every 6th day — FR-11 roll-up visible.
      const second = colomboInstant(day, "18:05");
      if (i % 6 === 5 && hasHappened(second)) {
        await entries.addEntry({ studentId: id, entryDate: day, body: prose(i + 3, salt), submittedAt: second });
      }
    }

    // Weekend persona: every Saturday between from..to, an Extra entry.
    if (s.kind === "weekend") {
      let cursor = from;
      while (compareDates(cursor, to) <= 0) {
        if (dayOfWeek(cursor) === 6) {
          const at = colomboInstant(cursor, "11:00");
          if (hasHappened(at)) {
            await entries.addEntry({
              studentId: id, entryDate: cursor,
              body: "Spent the morning polishing the demo and reading the review-queue docs.",
              submittedAt: at,
            });
          }
        }
        cursor = addDays(cursor, 1);
      }
    }
  }

  // ── review statuses + mentor records (state, not flags) ─────────────────
  const mentorRecords = createMentorRecordRepo(prisma);
  const mentor1 = mentorRows[0]!;
  const evaluatedBefore = toDbDate(addDays(today, -14));
  const inReviewBefore = toDbDate(addDays(today, -7));

  // Scoped to studentId: { in: studentIds } -- without it, this rewrites and
  // locks any non-seed student's reports too, and the next seed run's wipe
  // (which only deletes seed-owned rows) hits a mentor-record FK still
  // pointing at a report this update just moved to EVALUATED.
  await prisma.dailyReport.updateMany({
    where: { reportDate: { lt: evaluatedBefore }, studentId: { in: studentIds } },
    data: { status: "EVALUATED", reviewedById: mentor1.id, evaluatedAt: now, inReviewAt: now },
  });
  await prisma.dailyReport.updateMany({
    where: { reportDate: { lt: inReviewBefore, gte: evaluatedBefore }, studentId: { in: studentIds } },
    data: { status: "IN_REVIEW", reviewedById: mentor1.id, inReviewAt: now },
  });

  const evaluated = await prisma.dailyReport.findMany({
    where: { status: "EVALUATED", studentId: { in: studentIds } },
  });
  for (const report of evaluated) {
    const reportDate = fromDbDate(report.reportDate);
    if (!isWeekday(reportDate)) continue;
    await mentorRecords.upsert({
      studentId: report.studentId,
      date: reportDate,
      attended: true,
      tasksCompleted: true,
      recordedById: mentor1.id,
    });
  }

  // ── one already-seeded entry gets a review write ─────────────────────────
  // ASSUMPTION: O-18 — mentor-scored submissions (score/mentorFeedback/
  // countsTowardEvaluation) replace the AI-scored-cycle pipeline (FR-22-24),
  // pending mentor sign-off (docs/interview-and-prd.md §5). Plan 9's own
  // risk table (and the student-feedback-visibility spec that follows it)
  // requires at least one entry with feedback in seed data so that later
  // spec's E2E case has something to observe. `entryRepo.reviewEntry()`
  // doesn't exist until Plan 9 Task 2, so this writes directly via
  // `prisma.entry.update` against a real, already-created entry's id rather
  // than fabricating one.
  const reviewSubject = studentRows.get("dev-student-1")!;
  const entryToReview = await prisma.entry.findFirst({
    where: { studentId: reviewSubject.id },
    orderBy: [{ entryDate: "desc" }, { submittedAt: "desc" }],
  });
  if (entryToReview) {
    await prisma.entry.update({
      where: { id: entryToReview.id },
      data: {
        score: 88,
        mentorFeedback:
          "Solid write-up — the PDF edge-case handling shows you're thinking about robustness, not just the happy path.",
        countsTowardEvaluation: true,
      },
    });
  }

  // ── archive + cycles ─────────────────────────────────────────────────────
  const archived = SEED_STUDENTS.find((s) => s.kind === "archived")!;
  await prisma.user.update({
    where: { externalId: archived.externalId },
    data: { deletedAt: now },
  });

  const cycles = createCycleRepo(prisma);
  await cycles.ensureCycles(batchIds.A, today);
  await cycles.ensureCycles(batchIds.B, today);
}

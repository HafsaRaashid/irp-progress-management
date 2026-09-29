import {
  compareDates, cycleContaining, cycleFor, cycleWorkingDays,
  firstEvaluatedCycleStart, isWeekday, previousWeekday, shiftCycle, toProgrammeDate,
  PROGRAMME_MONTHS,
  type CivilDate, type CycleBounds, type DayStatus,
} from "@irp/core";
import type { BatchRecord, BatchRepo, RosterEnrolment } from "../db/batch-repo.js";
import type { DayService, DayView } from "./day-service.js";
import { BatchNotFoundError, InvalidCycleError } from "../domain/errors.js";

export interface CycleView {
  seq: number | null;
  startDate: CivilDate;
  endDate: CivilDate;
  requiredDayCount: number;
}

export interface DayCompliance {
  date: CivilDate;
  enrolled: number;
  submitted: number;
  late: number;
  absent: number;
  missed: number;
  pending: number;
}

export interface BatchTodayView {
  batch: BatchRecord;
  date: CivilDate;
  isFallbackDay: boolean;
  dayNumber: number;
  cycle: CycleView;
  counts: DayCompliance;
  extraCount: number;
  days: DayCompliance[];
  extraAfter: CivilDate[];
}

export interface CycleCounts {
  requiredDays: number;
  settledDays: number;
  onTime: number;
  late: number;
  absent: number;
  missed: number;
  pending: number;
  extra: number;
  complianceRate: number | null;
}

export interface ReviewProgress {
  inReview: number;
  evaluated: number;
}

export interface StudentDay {
  date: CivilDate;
  status: DayStatus;
}

export interface StudentDashboardView {
  /** The server's civil date in Asia/Colombo — the ribbon's ring must not be derived from the browser's clock. */
  today: CivilDate;
  programmeMonths: number;
  firstEvaluatedCycleStart: CivilDate | null;
  cycle: CycleView;
  days: StudentDay[];
  extraAfter: CivilDate[];
  summary: CycleCounts;
  /** Always null in this release — O-5 blocks the AI provider, so no Evaluation row exists (spec D2/D6). */
  strengthsAndWeaknesses: null;
}

export interface StudentSummaryView {
  student: { id: string; displayName: string; email: string };
  counts: CycleCounts;
  reviewProgress: ReviewProgress;
}

export interface BatchSummaryView {
  batch: BatchRecord;
  cycle: CycleView;
  /**
   * The batch's CURRENT cycle sequence — the highest sequence that has
   * actually started — independent of which cycle `cycle.seq` names. Lets a
   * client render a complete picker (1..currentSeq) no matter which cycle was
   * requested (Finding 2, Plan 7 fix wave). Null when the batch's first
   * evaluated cycle has not opened yet (ADR-0019).
   */
  currentSeq: number | null;
  students: StudentSummaryView[];
}

export interface DashboardService {
  batchToday(batchId: string, now: Date): Promise<BatchTodayView>;
  batchSummary(batchId: string, cycleSeq: number | undefined, now: Date): Promise<BatchSummaryView>;
  studentDashboard(studentId: string, now: Date): Promise<StudentDashboardView>;
}

/**
 * The shape `covers`/`countCycle` actually need from an enrolment interval —
 * satisfied by both `RosterEnrolment` (a batch's own roster read) and
 * `EnrolmentRecord` (a student's full history across every batch). A batch
 * summary clips against the former; a student's own month clips against the
 * latter, because the obligation follows the student, not a batch.
 */
interface EnrolmentInterval {
  startDate: CivilDate;
  endDate: CivilDate | null;
}

/** Whether an enrolment interval covers `d` (open-ended when endDate is null). */
function covers(e: EnrolmentInterval, d: CivilDate): boolean {
  return compareDates(e.startDate, d) <= 0 && (e.endDate === null || compareDates(e.endDate, d) >= 0);
}

/**
 * The required day a batch dashboard reports on.
 *
 * Today when today is a weekday inside the cycle; otherwise the most recent
 * required day at or before today, CLAMPED to the cycle. The clamp matters at a
 * boundary: a cycle opening on a Saturday has no earlier required day of its
 * own, and reaching into last month's Friday would report figures the ribbon
 * does not contain. In that one case the cycle's FIRST required day is
 * reported instead, with `enrolled` counted normally but every OTHER count
 * zero — honest (nobody has had a chance to submit yet), and flagged by
 * `isFallbackDay` either way.
 */
export function reportedDay(requiredDays: CivilDate[], today: CivilDate): CivilDate {
  const first = requiredDays[0];
  if (first === undefined) throw new Error("dashboard: a cycle with no required days is impossible");
  let chosen = first;
  for (const d of requiredDays) {
    if (compareDates(d, today) <= 0) chosen = d;
  }
  return chosen;
}

/** Four decimals — enough to distinguish 21/22 from 20/21, short enough to compare exactly in a test. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * One student's cycle, counted from their already-classified days, clipped to
 * their enrolment interval(s) IN THIS BATCH.
 *
 * `requiredDays` is enrolment-clipped, but NOT by trusting `day.status ===
 * "none"` — that comes from the day service's own obligation check, which is
 * student-scoped across every batch the student has ever held (FR-27's
 * "not enrolled ANYWHERE" reading, correct for a student's own day list). A
 * transfer out to a different batch and back leaves the student enrolled
 * somewhere the whole time, so those days never read `none` — left
 * unguarded, they would attribute the OTHER batch's obligation to this one's
 * summary. `enrolments` is this batch's own interval(s)
 * (`enrolmentsInRange(thisBatchId, ...)`), so `covers` here re-clips against
 * the batch actually being summarised. `extra` counts weekend ENTRIES,
 * matching RosterRow.extraCountThisCycle, not weekend days.
 *
 * KNOWN GAP, deliberately shipped: `extra` is NOT batch-clipped. The weekend
 * branch runs before the `covers` check, so a weekend entry made while the
 * student was transferred away counts toward BOTH batches' tallies when
 * their cycle windows overlap. It is pre-existing and systemic — roster
 * service's `extraCountThisCycle` has the identical unclipped shape — and it
 * never reaches a compliance denominator, so the score of record is
 * unaffected. It does reach the mentor's screen and, later, the AI summary's
 * positive context. Close it in both places at once or not at all; fixing
 * only this one re-introduces the disagreement it would be fixing.
 *
 * // ASSUMPTION: O-7 — absence counts as accounted-for. O-7 is still open on
 * whether lateness or absence carries an automatic penalty; the PRD's stated
 * assumption is that it does not, and this is the one place that shows.
 */
export function countCycle(days: DayView[], enrolments: EnrolmentInterval[]): CycleCounts {
  const counts: CycleCounts = {
    requiredDays: 0, settledDays: 0, onTime: 0, late: 0,
    absent: 0, missed: 0, pending: 0, extra: 0, complianceRate: null,
  };
  for (const day of days) {
    if (!isWeekday(day.date)) {
      counts.extra += day.entries.filter((e) => e.isExtra).length;
      continue;
    }
    if (!enrolments.some((e) => covers(e, day.date))) continue; // not enrolled in THIS batch: no obligation
    counts.requiredDays += 1;
    switch (day.status) {
      case "onTime": counts.onTime += 1; counts.settledDays += 1; break;
      case "late": counts.late += 1; counts.settledDays += 1; break;
      case "absent": counts.absent += 1; counts.settledDays += 1; break;
      case "missed": counts.missed += 1; counts.settledDays += 1; break;
      case "pending": counts.pending += 1; break;
      default: break; // future — reached by nobody yet
    }
  }
  if (counts.settledDays > 0) {
    counts.complianceRate = round4(
      (counts.onTime + counts.late + counts.absent) / counts.settledDays,
    );
  }
  return counts;
}

/** Daily reports in the window, by review state. A weekend entry creates a report too, so this is not weekday-clipped. */
export function countReviewProgress(days: DayView[]): ReviewProgress {
  const progress: ReviewProgress = { inReview: 0, evaluated: 0 };
  for (const day of days) {
    if (day.reportStatus === "IN_REVIEW") progress.inReview += 1;
    if (day.reportStatus === "EVALUATED") progress.evaluated += 1;
  }
  return progress;
}

/**
 * Weekend Extra (FR-33), attributed to the required day it follows so the
 * ribbon can draw a half-width slot there. A weekend at the very start of a
 * cycle anchors back into the previous one and is dropped rather than
 * mis-attributed. Counts ENTRIES, not days — a Saturday worked twice is two.
 */
export function extraSlots(
  dayLists: Iterable<DayView[]>,
  cycleStart: CivilDate,
): { extraCount: number; extraAfter: CivilDate[] } {
  let extraCount = 0;
  const anchors = new Set<CivilDate>();
  for (const days of dayLists) {
    for (const day of days) {
      if (isWeekday(day.date)) continue;
      const extras = day.entries.filter((e) => e.isExtra).length;
      if (extras === 0) continue;
      extraCount += extras;
      const anchor = previousWeekday(day.date);
      if (compareDates(anchor, cycleStart) >= 0) anchors.add(anchor);
    }
  }
  return { extraCount, extraAfter: [...anchors].sort() };
}

export function createDashboardService(deps: {
  batchRepo: Pick<BatchRepo, "getBatch" | "enrolmentsInRange" | "firstEnrolmentStart" | "listEnrolments">;
  dayService: Pick<DayService, "listDaysForStudents">;
}): DashboardService {
  /** The engine's cycle numbering for a batch (ADR-0019). Null before its first evaluated cycle. */
  function cycleView(bounds: CycleBounds, batch: BatchRecord): CycleView {
    return {
      seq: cycleFor(bounds.start, batch.startDate)?.index ?? null,
      startDate: bounds.start,
      endDate: bounds.end,
      requiredDayCount: cycleWorkingDays(bounds).length,
    };
  }

  /**
   * The roster read `batchToday` and `batchSummary` both need: this batch's
   * enrolments overlapping the window, and every one of those students'
   * classified days across it. Extracted once a third consumer (Task 4) was
   * imminent — kept to exactly what both existing callers use, nothing more.
   */
  async function loadRoster(
    batchId: string, bounds: CycleBounds, now: Date,
  ): Promise<{ enrolments: RosterEnrolment[]; byStudent: Map<string, DayView[]> }> {
    const enrolments = await deps.batchRepo.enrolmentsInRange(batchId, bounds.start, bounds.end);
    const studentIds = [...new Set(enrolments.map((e) => e.studentId))];
    const byStudent = await deps.dayService.listDaysForStudents(studentIds, bounds.start, bounds.end, now);
    return { enrolments, byStudent };
  }

  return {
    async batchToday(batchId, now) {
      const batch = await deps.batchRepo.getBatch(batchId);
      if (!batch) throw new BatchNotFoundError(batchId);

      const today = toProgrammeDate(now);
      const bounds = cycleContaining(today);
      const requiredDays = cycleWorkingDays(bounds);
      const { enrolments, byStudent } = await loadRoster(batchId, bounds, now);

      // Index every student's cycle once; each per-day count is then a lookup.
      const dayIndex = new Map<string, Map<CivilDate, DayView>>();
      for (const [id, days] of byStudent) {
        dayIndex.set(id, new Map(days.map((d) => [d.date, d])));
      }

      const complianceFor = (date: CivilDate): DayCompliance => {
        const counts: DayCompliance = {
          date, enrolled: 0, submitted: 0, late: 0, absent: 0, missed: 0, pending: 0,
        };
        for (const e of enrolments) {
          if (!covers(e, date)) continue;
          counts.enrolled += 1;
          const status: DayStatus | undefined = dayIndex.get(e.studentId)?.get(date)?.status;
          // A late entry IS submitted — `late` reports how many of the
          // submissions were, it is not a separate bucket (FR-13).
          if (status === "onTime" || status === "late") counts.submitted += 1;
          if (status === "late") counts.late += 1;
          if (status === "absent") counts.absent += 1;
          if (status === "missed") counts.missed += 1;
          if (status === "pending") counts.pending += 1;
        }
        return counts;
      };

      const days = requiredDays.map(complianceFor);
      const date = reportedDay(requiredDays, today);
      const counts = days.find((d) => d.date === date)!;

      const { extraCount, extraAfter } = extraSlots(byStudent.values(), bounds.start);

      return {
        batch,
        date,
        isFallbackDay: date !== today,
        dayNumber: days.findIndex((d) => d.date === date) + 1,
        cycle: cycleView(bounds, batch),
        counts,
        extraCount,
        days,
        extraAfter,
      };
    },

    async batchSummary(batchId, cycleSeq, now) {
      const found = await deps.batchRepo.getBatch(batchId);
      if (!found) throw new BatchNotFoundError(batchId);
      // Rebound to a `BatchRecord`-typed const: TS does not carry the
      // null-narrowing above into the nested `summarise` closure below, since
      // a closure could in principle be invoked at a point where the
      // narrowing no longer holds. `batch` itself is never reassigned, so
      // this is exactly as safe as the narrowing it restates.
      const batch: BatchRecord = found;

      const today = toProgrammeDate(now);
      const first = firstEvaluatedCycleStart(batch.startDate);
      // The batch's own numbering for today. Null before its first evaluated
      // cycle opens — there is no "current" cycle yet to default to or to
      // validate an explicit request against.
      const currentSeq = cycleFor(today, batch.startDate)?.index ?? null;

      /** Load the roster/day data for `bounds` and shape the response. Shared by both branches below. */
      async function summarise(bounds: CycleBounds, seq: number | null): Promise<BatchSummaryView> {
        const { enrolments, byStudent } = await loadRoster(batchId, bounds, now);

        // enrolmentsInRange is ordered by displayName, so first-seen order is
        // already the response order; the Map dedupes a student holding two
        // intervals in this cycle (a transfer into and out of the same batch)
        // into ONE roster row. That dedup is display-only: `countCycle` still
        // needs EVERY interval the student held in this batch to clip their
        // days correctly (a transfer out and back is exactly two), so those are
        // kept separately, grouped by student rather than collapsed.
        const seen = new Map<string, RosterEnrolment>();
        const byStudentEnrolments = new Map<string, RosterEnrolment[]>();
        for (const e of enrolments) {
          if (!seen.has(e.studentId)) seen.set(e.studentId, e);
          const intervals = byStudentEnrolments.get(e.studentId);
          if (intervals) intervals.push(e); else byStudentEnrolments.set(e.studentId, [e]);
        }

        return {
          batch,
          cycle: { ...cycleView(bounds, batch), seq },
          currentSeq,
          students: [...seen.values()].map((e) => {
            const days = byStudent.get(e.studentId) ?? [];
            // Non-null by construction: `seen` and `byStudentEnrolments` are
            // populated from the same loop over `enrolments`, so every key in
            // one is a key in the other.
            const studentEnrolments = byStudentEnrolments.get(e.studentId)!;
            return {
              student: { id: e.studentId, displayName: e.displayName, email: e.email },
              counts: countCycle(days, studentEnrolments),
              reviewProgress: countReviewProgress(days),
            };
          }),
        };
      }

      if (cycleSeq === undefined && currentSeq === null) {
        // Finding 1, Plan 7 fix wave: ADR-0019 says seq is nullable in EVERY
        // response. Flooring the default to a fabricated Cycle 1 (the old
        // behaviour) reported a *future* window here while batchToday
        // correctly reported the CURRENT CALENDAR cycle with seq null for the
        // same batch on the same day — two mentor pages disagreeing about
        // "now". Match batchToday: report the current calendar cycle's
        // bounds, honestly with no sequence, and whatever roster/compliance
        // data that window actually has (empty or future-only, as the data
        // dictates). An EXPLICIT `?cycle=` request in this state is
        // unaffected and still validated/rejected below as before.
        return summarise(cycleContaining(today), null);
      }

      const seq = cycleSeq ?? currentSeq ?? 1;
      if (!Number.isInteger(seq) || seq < 1) {
        throw new InvalidCycleError(`Cycle ${String(seq)} is not a valid 1-based cycle sequence.`);
      }
      if (currentSeq !== null && seq > currentSeq) {
        throw new InvalidCycleError(
          `Cycle ${String(seq)} has not started — this batch is on cycle ${String(currentSeq)}.`,
        );
      }
      if (currentSeq === null && seq > 1) {
        throw new InvalidCycleError(`Cycle ${String(seq)} has not started — this batch has no evaluated cycle yet.`);
      }

      return summarise(cycleContaining(shiftCycle(first, seq - 1)), seq);
    },

    async studentDashboard(studentId, now) {
      const today = toProgrammeDate(now);
      const bounds = cycleContaining(today);
      const admission = await deps.batchRepo.firstEnrolmentStart(studentId);
      const byStudent = await deps.dayService.listDaysForStudents(
        [studentId], bounds.start, bounds.end, now,
      );
      const days = byStudent.get(studentId) ?? [];
      const { extraAfter } = extraSlots([days], bounds.start);

      return {
        today,
        programmeMonths: PROGRAMME_MONTHS,
        firstEvaluatedCycleStart: admission === null ? null : firstEvaluatedCycleStart(admission),
        cycle: {
          // The programme clock runs from the student's FIRST enrolment, so a
          // transfer never resets "Month N of 6" (spec §3, Enrolment).
          seq: admission === null ? null : (cycleFor(today, admission)?.index ?? null),
          startDate: bounds.start,
          endDate: bounds.end,
          requiredDayCount: cycleWorkingDays(bounds).length,
        },
        days: days
          .filter((d) => isWeekday(d.date))
          .map((d) => ({ date: d.date, status: d.status })),
        extraAfter,
        // Corrected 2026-08-03: countCycle's signature changed in Task 3's fix
        // wave to `countCycle(days, enrolments)`, because a batch summary must
        // clip each student's obligation to THAT batch's intervals. A
        // student's own month is the opposite case — the obligation follows
        // the student, not a batch — so pass their full enrolment list. Widen
        // `countCycle`/`covers` to accept a structural
        // `{ startDate: CivilDate; endDate: CivilDate | null }` so both
        // `RosterEnrolment` and `EnrolmentRecord` satisfy it; do not duplicate
        // the counter.
        summary: countCycle(days, await deps.batchRepo.listEnrolments(studentId)),
        strengthsAndWeaknesses: null,
      };
    },
  };
}

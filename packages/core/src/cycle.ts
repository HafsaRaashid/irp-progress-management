import { addDays, addMonths, compareDates, dateParts, type CivilDate } from "./civil-date.js";
import { workingDaysBetween } from "./weekday.js";

/**
 * The programme's length in evaluation cycles — the "of 6" in FR-29's
 * "Month N of 6". Lives with the cycle arithmetic because it is the same
 * domain fact, and both the API payload and any future evaluation code need
 * one source for it.
 */
export const PROGRAMME_MONTHS = 6;

export interface CycleBounds {
  readonly start: CivilDate;
  readonly end: CivilDate;
}

/** The two dates a batch's cycles are cut from. Structural, so a `BatchRecord` satisfies it. */
export interface BatchWindow {
  readonly startDate: CivilDate;
  readonly endDate: CivilDate;
}

export interface Cycle extends CycleBounds {
  /** 1-based position within the batch. */
  readonly index: number;
}

/**
 * Where `date` sits against a batch's own dates.
 *
 * `after` is not `during` even though the last cycle still brackets it: a
 * batch that has finished has no current cycle, only a last one.
 */
export type BatchPhase = "before" | "during" | "after";

/**
 * Cycles are cut from the BATCH's own dates (ADR-0035, superseding the fixed
 * 10th-to-9th windows of FR-9's first reading).
 *
 * Cycle 1 starts on the batch's start date. Cycle k starts on the same
 * day-of-month k-1 months later, and runs to the day before cycle k+1 starts.
 * The last cycle is cut at the batch's end date, so it can be short, and no
 * cycle starts after it.
 *
 * Every start is shifted from the batch's start date, never from the previous
 * cycle's start: `addMonths` clamps to month length, and stepping from the
 * previous result would let one short month (a batch starting on the 31st)
 * drag every later cycle to the 28th.
 */
function startOf(batch: BatchWindow, index: number): CivilDate {
  return addMonths(batch.startDate, index - 1);
}

/** How many cycles the batch holds: every one whose start is on or before its end date. */
export function cycleCount(batch: BatchWindow): number {
  if (compareDates(batch.endDate, batch.startDate) < 0) {
    throw new RangeError(`Batch ends (${batch.endDate}) before it starts (${batch.startDate})`);
  }
  let count = 1;
  while (compareDates(startOf(batch, count + 1), batch.endDate) <= 0) count += 1;
  return count;
}

/** Cycle `index` (1-based) of the batch, or null when the batch has no such cycle. */
export function cycleBounds(batch: BatchWindow, index: number): Cycle | null {
  if (!Number.isInteger(index) || index < 1 || index > cycleCount(batch)) return null;
  const start = startOf(batch, index);
  const nextStart = startOf(batch, index + 1);
  const unclippedEnd = addDays(nextStart, -1);
  const end = compareDates(unclippedEnd, batch.endDate) > 0 ? batch.endDate : unclippedEnd;
  return { start, end, index };
}

export function batchPhase(batch: BatchWindow, date: CivilDate): BatchPhase {
  if (compareDates(date, batch.startDate) < 0) return "before";
  if (compareDates(date, batch.endDate) > 0) return "after";
  return "during";
}

/**
 * The cycle `date` falls in. A date outside the batch is clamped to its
 * nearest edge — the first cycle before the batch, the last after it — so a
 * caller always gets a real cycle to show; pair it with `batchPhase` when the
 * distinction matters.
 */
export function cycleAt(batch: BatchWindow, date: CivilDate): Cycle {
  const count = cycleCount(batch);
  const clamped =
    compareDates(date, batch.startDate) < 0
      ? batch.startDate
      : compareDates(date, batch.endDate) > 0
        ? batch.endDate
        : date;
  const from = dateParts(batch.startDate);
  const to = dateParts(clamped);
  // A month-count estimate, then nudged: the clamp in `addMonths` can put a
  // cycle's start a few days either side of the naive day-of-month.
  let index = Math.min(count, Math.max(1, (to.year - from.year) * 12 + (to.month - from.month) + 1));
  while (index > 1 && compareDates(startOf(batch, index), clamped) > 0) index -= 1;
  while (index < count && compareDates(startOf(batch, index + 1), clamped) <= 0) index += 1;
  // `index` is in [1, count] by construction, so this is never null.
  return cycleBounds(batch, index)!;
}

/**
 * The first cycle of `batch` a student admitted on `admission` is evaluated
 * for, or null when there is none.
 *
 * This implements only the JOINING half of FR-27. The full requirement is
 * that a student who joins *or leaves* partway through a cycle is not
 * evaluated for that cycle; here, admission counts only when it lands exactly
 * on a cycle start, and otherwise evaluation begins with the following cycle.
 * A student admitted on or before the batch's start is evaluated from cycle 1.
 * A student admitted after the batch's last cycle began joins too late for any
 * of it, so the answer is null.
 *
 * Departure is not modelled at all. A caller must NOT treat this as
 * FR-27-complete: it will happily name a cycle for a student who left halfway
 * through it.
 */
export function firstEvaluatedCycle(batch: BatchWindow, admission: CivilDate): Cycle | null {
  if (compareDates(admission, batch.startDate) <= 0) return cycleBounds(batch, 1);
  if (compareDates(admission, batch.endDate) > 0) return null;
  const containing = cycleAt(batch, admission);
  return admission === containing.start ? containing : cycleBounds(batch, containing.index + 1);
}

/** Every weekday inside a cycle. Weekends are absent, not marked (FR-12). */
export function cycleWorkingDays(bounds: CycleBounds): CivilDate[] {
  return workingDaysBetween(bounds.start, bounds.end);
}

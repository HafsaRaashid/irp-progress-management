import { compareDates, type CivilDate, type CycleBounds, type SubmissionWindow } from "@irp/core";

/**
 * The `listMyDays` range StudentToday needs: wide enough to cover the whole
 * current cycle (CycleCalendar renders every calendar day, O-17) AND every
 * date the open submission window still targets, which can reach into the
 * PREVIOUS cycle — e.g. on Monday the 10th (a cycle boundary), the previous
 * weekday (Friday the 7th) is still inside its grace window.
 *
 * `to` is always the cycle's own end: the window's newest target is always
 * today, which is always inside the current cycle.
 */
export function historyRangeFor(
  openWindow: SubmissionWindow,
  cycle: CycleBounds,
): { from: CivilDate; to: CivilDate } {
  const oldestTarget = openWindow.targetDates[openWindow.targetDates.length - 1];
  const from =
    oldestTarget !== undefined && compareDates(oldestTarget, cycle.start) < 0
      ? oldestTarget
      : cycle.start;
  return { from, to: cycle.end };
}

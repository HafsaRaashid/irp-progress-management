import { formatCivilDateLabel, formatMonthDayLabel } from "./format-civil-date";

/**
 * The subset of MyDashboard the heading reads. Structural, so the SDK type or
 * a test literal both satisfy it.
 */
export interface CyclePositionLike {
  programmeMonths: number;
  firstEvaluatedCycleStart: string | null;
  cycle: { seq: number | null; startDate: string; endDate: string };
}

/**
 * "Month 3 of 6 · 10 July – 9 August" — §8.2's heading line, now rendered on
 * both the student's home (above the ribbon) and My month. It lived only in
 * my-month/page.tsx until the §8.2 restructure moved the ribbon to the home
 * page; two copies of this three-branch rule would have been two chances to
 * get the mid-cycle-joiner case wrong.
 *
 * Never "Month null of N": a mid-cycle joiner has no seq until their first
 * evaluated cycle opens (FR-27), and a caller with no enrolment at all has
 * neither a seq nor a firstEvaluatedCycleStart.
 */
export function cycleHeading(d: CyclePositionLike): string {
  if (d.cycle.seq !== null) {
    // formatMonthDayLabel, not formatCivilDateLabel: this is a RANGE, and
    // "Friday 10 July – Saturday 9 August" puts two weekday names in front of
    // the student that mean nothing on a month boundary. The branch below
    // names a SINGLE day and keeps its weekday, which §11's copy voice wants.
    return `Month ${String(d.cycle.seq)} of ${String(d.programmeMonths)} · ${formatMonthDayLabel(d.cycle.startDate)} – ${formatMonthDayLabel(d.cycle.endDate)}`;
  }
  if (d.firstEvaluatedCycleStart !== null) {
    return `Your first evaluated month starts ${formatCivilDateLabel(d.firstEvaluatedCycleStart)}`;
  }
  return "You are not enrolled in a batch yet.";
}

/**
 * Just the month's date range — "10 September – 9 October".
 *
 * For a surface where something ELSE already states the programme position.
 * The student home's greeting band carries the journey bar ("Month 3 of 6"
 * plus distance travelled), so the ribbon beneath it only needs to say which
 * dates its marks cover; repeating the month there put the same fact on screen
 * twice, three inches apart.
 *
 * My progress still uses cycleHeading() above, because nothing else on that
 * page names the month.
 *
 * Falls back to cycleHeading()'s wording when there is no sequence to be
 * positioned against (FR-27): a joiner needs the sentence, not a bare range.
 */
export function cycleRangeLabel(d: CyclePositionLike): string {
  if (d.cycle.seq === null) return cycleHeading(d);
  return `${formatMonthDayLabel(d.cycle.startDate)} – ${formatMonthDayLabel(d.cycle.endDate)}`;
}

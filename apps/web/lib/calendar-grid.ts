import { addDays, compareDates, dayOfWeek, type CivilDate, type CycleBounds } from "@irp/core";

/** One calendar-day cell before it is given compliance data. */
export interface GridCell {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** False for a leading/trailing adjacent-month day shown dimmed for row structure only. */
  inCycle: boolean;
}

/** Monday-first offset: dayOfWeek is 0 Sunday..6 Saturday; Monday becomes 0, Sunday becomes 6. */
function mondayFirstOffset(date: CivilDate): number {
  return (dayOfWeek(date) + 6) % 7;
}

/**
 * The full Monday-to-Sunday week grid a cycle's calendar view needs:
 * every week the cycle touches, including dimmed leading/trailing days from
 * the adjacent months so every row has exactly 7 cells (design spec §3).
 */
export function weeksForCycle(bounds: CycleBounds): GridCell[][] {
  const gridStart = addDays(bounds.start, -mondayFirstOffset(bounds.start));
  const gridEnd = addDays(bounds.end, 6 - mondayFirstOffset(bounds.end));

  const cells: GridCell[] = [];
  for (let d = gridStart; compareDates(d, gridEnd) <= 0; d = addDays(d, 1)) {
    cells.push({
      date: d,
      inCycle: compareDates(d, bounds.start) >= 0 && compareDates(d, bounds.end) <= 0,
    });
  }

  const weeks: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

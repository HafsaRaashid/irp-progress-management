import type { DayMark } from "@/components/cycle-ribbon/cycle-ribbon";
import type { DayStatus } from "@irp/client";
import { addDays, civilDate, type CycleBounds } from "@irp/core";
import { weeksForCycle } from "./calendar-grid";

/** The subset of DayCompliance the mark rule reads. Structural, so either the SDK type or a literal satisfies it. */
export interface DayComplianceLike {
  date: string;
  enrolled: number;
  submitted: number;
  late: number;
  absent: number;
  missed: number;
  pending: number;
}

/**
 * Domain status to visual mark, for ONE student's day.
 *
 * `pending` becomes an outline rather than a mark of its own: the grace window
 * is still open, so nothing has gone wrong and drawing a filled bar would
 * claim work that has not been recorded. The design system has no pending
 * mark (§7 lists six), and inventing a seventh colour was rejected there for
 * the same reason it was rejected for Extra.
 *
 * `extra` and `none` also fall through to the outline. Neither should reach
 * here — callers pass required days only — but a total function that claims
 * nothing is a better failure than a crash on a screen a mentor is reading.
 */
export function studentDayMark(status: DayStatus): DayMark {
  switch (status) {
    case "onTime": return "ok";
    case "late": return "late";
    case "absent": return "absent";
    case "missed": return "missed";
    default: return "future";
  }
}

/**
 * Batch compliance for one day to a single mark, worst unresolved outcome
 * first: missed, then late, then absent, then partial, then ok.
 *
 * A mentor scanning the strip needs the failure before the warning and the
 * warning before the excused absence. `partial` ranks below all three because
 * pending work is not yet a problem — it is simply an afternoon that has not
 * finished. `fill` is set on `partial` alone; it is the only mark CycleRibbon
 * renders proportionally (see its MARK_COLOR comment).
 */
export function batchDayMark(day: Omit<DayComplianceLike, "date">): { mark: DayMark; fill?: number } {
  // `late` is deliberately absent from this sum: the API's `submitted`
  // ALREADY includes late submissions (a late entry is still submitted), and
  // `late` only reports how many of them were. Adding it would double-count
  // and make a fully-late day read as over-subscribed. If `DayCompliance`
  // ever makes `late` a disjoint bucket instead, this line breaks silently —
  // no current test pairs a nonzero `late` with a nonzero `pending`.
  const reached = day.submitted + day.absent + day.missed + day.pending;
  if (day.enrolled === 0 || reached === 0) return { mark: "future" };
  if (day.missed > 0) return { mark: "missed" };
  if (day.late > 0) return { mark: "late" };
  if (day.absent > 0) return { mark: "absent" };
  if (day.submitted >= day.enrolled) return { mark: "ok" };
  return { mark: "partial", fill: day.submitted / day.enrolled };
}

export type WeekdayCellMark = DayMark;

/** One calendar-grid cell, replacing RibbonDay (O-17, ADR-0030). */
export interface CalendarCell {
  date: string;
  isToday: boolean;
  /** False for adjacent-month padding — carries no compliance data, never interactive. */
  inCycle: boolean;
  /** Undefined for adjacent-month padding. */
  kind?: "weekday" | "weekend";
  /** Only when kind === "weekday". */
  mark?: WeekdayCellMark;
  /** Only when kind === "weekday" && mark === "partial", 0..1. */
  fill?: number;
  /**
   * Only when kind === "weekend". The batch transform can only resolve this
   * per WEEKEND PAIR (extraAfter names the Friday, not the actual Saturday/
   * Sunday worked) — both cells of a flagged weekend get the same value. The
   * student transform resolves it per DAY, from listMyDays' real per-date
   * status. See the implementation plan's audit finding 2.
   */
  extra?: boolean;
}

function isWeekendDate(date: string): boolean {
  // Mirrors isWeekday's own UTC-midnight parsing (@irp/core) — not a new rule.
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function baseCell(cell: { date: string; inCycle: boolean }, today: string): Pick<CalendarCell, "date" | "isToday" | "inCycle"> {
  return { date: cell.date, isToday: cell.inCycle && cell.date === today, inCycle: cell.inCycle };
}

/**
 * Batch compliance over a full cycle grid (replaces toBatchRibbonDays, O-17).
 * `extraAfter` is Friday-anchored (one flag per weekend, not per day) — both
 * weekend cells of a flagged pair render extra: true. Deliberate scope limit,
 * not a bug: see the implementation plan's audit finding 2.
 */
export function toBatchCalendarDays(
  bounds: CycleBounds,
  days: DayComplianceLike[],
  extraAfter: string[],
  today: string,
): CalendarCell[][] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const extraWeekends = new Set<string>(
    extraAfter.flatMap((friday) => [addDays(civilDate(friday), 1), addDays(civilDate(friday), 2)]),
  );

  return weeksForCycle(bounds).map((week) =>
    week.map((cell): CalendarCell => {
      const base = baseCell(cell, today);
      if (!cell.inCycle) return base;
      if (isWeekendDate(cell.date)) {
        return { ...base, kind: "weekend", extra: extraWeekends.has(cell.date) };
      }
      const day = byDate.get(cell.date);
      if (day === undefined) return { ...base, kind: "weekday", mark: "future" };
      const { mark, fill } = batchDayMark(day);
      return { ...base, kind: "weekday", mark, ...(fill !== undefined && { fill }) };
    }),
  );
}

/**
 * Student compliance over a full cycle grid (replaces toStudentRibbonDays,
 * O-17). Unlike the batch side, `days` here comes from listMyDays and already
 * carries one row per calendar date (including weekends) with a real
 * DayStatus, so weekend extra/none resolves per day, not per weekend pair.
 */
export function toStudentCalendarDays(
  bounds: CycleBounds,
  days: { date: string; status: DayStatus }[],
  today: string,
): CalendarCell[][] {
  const byDate = new Map(days.map((d) => [d.date, d.status]));

  return weeksForCycle(bounds).map((week) =>
    week.map((cell): CalendarCell => {
      const base = baseCell(cell, today);
      if (!cell.inCycle) return base;
      const status = byDate.get(cell.date) ?? "future";
      if (isWeekendDate(cell.date)) {
        return { ...base, kind: "weekend", extra: status === "extra" };
      }
      return { ...base, kind: "weekday", mark: studentDayMark(status) };
    }),
  );
}

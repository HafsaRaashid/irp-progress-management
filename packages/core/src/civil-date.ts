/**
 * A calendar date with no time and no timezone, as `YYYY-MM-DD`.
 *
 * Every piece of calendar arithmetic in this engine runs on CivilDate rather
 * than Date. A Date is an instant, and doing "add one day" to an instant is
 * how timezone bugs get in. ISO date strings also compare lexicographically,
 * so ordering is free.
 */
export type CivilDate = string & { readonly __brand: "CivilDate" };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse and validate an ISO calendar date. Throws RangeError if not real. */
export function civilDate(value: string): CivilDate {
  const match = ISO_DATE.exec(value);
  if (match === null) {
    throw new RangeError(`Not an ISO calendar date (expected YYYY-MM-DD): ${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Date.UTC normalises out-of-range parts, so round-tripping detects
  // impossible dates such as 2026-02-30.
  //
  // Date.UTC remaps years 0-99 to 1900-1999, which would falsely reject
  // "0099-01-01". setUTCFullYear has no such special case.
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a real calendar date: ${value}`);
  }
  return value as CivilDate;
}

/**
 * Split a CivilDate into its numeric parts.
 *
 * A CivilDate is `YYYY-MM-DD` by construction — civilDate() is the only way
 * to make one — so fixed-offset slicing is safe and needs no assertion. Do
 * not re-run the regex here: that would require a non-null assertion on
 * exec(), which is both a lint violation and a smell.
 *
 * Prefer this over `split("-").map(Number)` with a tuple cast — that cast
 * suppresses a genuine `| undefined` under noUncheckedIndexedAccess.
 */
export function dateParts(date: CivilDate): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

function toUtcMidnight(date: CivilDate): Date {
  const { year, month, day } = dateParts(date);
  // Built the same way civilDate() validates, and for the same reason:
  // Date.UTC remaps years 0-99 to 1900-1999, so it would turn a validated
  // "0099-01-01" into 1999 and hand back silently wrong arithmetic to every
  // caller downstream. setUTCFullYear has no such special case.
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  return instant;
}

function fromUtcMidnight(instant: Date): CivilDate {
  return instant.toISOString().slice(0, 10) as CivilDate;
}

/** Shift a calendar date by whole days. Negative shifts backwards. */
export function addDays(date: CivilDate, days: number): CivilDate {
  const instant = toUtcMidnight(date);
  instant.setUTCDate(instant.getUTCDate() + days);
  return fromUtcMidnight(instant);
}

/**
 * Shift a calendar date by whole months, keeping the day-of-month. A target
 * month too short for that day clamps to its last day (31 Jan + 1 month is
 * 28 Feb), so the result is always a real date.
 *
 * Clamping makes this non-associative: `addMonths(addMonths(d, 1), 1)` can
 * differ from `addMonths(d, 2)`. Callers stepping through a series must
 * always shift from the SAME anchor, never from the previous result, or the
 * clamp compounds (31 Jan -> 28 Feb -> 28 Mar instead of 31 Mar).
 */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const { year, month, day } = dateParts(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12; // 0-based
  // Day 0 of the following month is the last day of the target month.
  const probe = new Date(0);
  probe.setUTCFullYear(targetYear, targetMonth + 1, 0);
  const lastDay = probe.getUTCDate();
  probe.setUTCFullYear(targetYear, targetMonth, Math.min(day, lastDay));
  return fromUtcMidnight(probe);
}

/** Day of week: 0 Sunday … 6 Saturday. */
export function dayOfWeek(date: CivilDate): number {
  return toUtcMidnight(date).getUTCDay();
}

/** -1 if a is earlier, 0 if equal, 1 if a is later. */
export function compareDates(a: CivilDate, b: CivilDate): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

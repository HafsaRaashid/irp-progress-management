import { addDays, compareDates, type CivilDate } from "@irp/core";

/**
 * My progress's "This week" / "This month" toggle (confirmed direction: a
 * toggle defaulting to the full month, not a default-collapsed view).
 *
 * "This week" is a trailing 7-day window ending on `today` — NOT a calendar
 * week (Mon–Sun). The earlier "Week of …" dividers used calendar weeks and
 * were pulled for reading as confusing; a rolling window needs no label of
 * its own and avoids reintroducing the same ambiguity under a different
 * name.
 */
export function isWithinTrailingWeek(date: CivilDate, today: CivilDate): boolean {
  const windowStart = addDays(today, -6);
  return compareDates(date, windowStart) >= 0 && compareDates(date, today) <= 0;
}

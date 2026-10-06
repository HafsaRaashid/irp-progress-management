// Student-facing date labels get the weekday name (§11's copy voice: "Monday",
// not "2026-07-31"). ISO strings stay the wire format everywhere else --
// <option> values, hidden inputs, API calls -- this is presentation only.
const WEEKDAY_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * "Friday 31 July" for an ISO calendar date ("YYYY-MM-DD") -- no comma; that
 * is what this Node/ICU build's "en-GB" long-weekday formatter actually
 * produces, verified against the running test output.
 *
 * Built from a UTC-midnight instant carrying the exact year/month/day, then
 * formatted in Asia/Colombo. That zone's offset is positive (+05:30), so
 * converting a UTC-midnight instant only ever moves the wall clock LATER
 * within the same calendar day (00:00 UTC -> 05:30 Colombo) -- never
 * backward across midnight -- so this can never display the wrong day.
 */
export function formatCivilDateLabel(isoDate: string): string {
  const parts = isoDate.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return WEEKDAY_DATE_FORMAT.format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * "31 July" — the same civil date WITHOUT its weekday name.
 *
 * Only for a date RANGE. formatCivilDateLabel above keeps the weekday and is
 * correct everywhere a SINGLE day is named, which is what §11's copy voice
 * asks for ("You can still submit for Monday until…"). On a month boundary the
 * weekday is noise: "Month 3 of 6 · Friday 10 July – Saturday 9 August" tells
 * the student two things they cannot act on. cycle-heading.ts is the one
 * caller.
 *
 * Same UTC-midnight construction as above, and the same reasoning applies:
 * Asia/Colombo's offset is positive, so formatting a UTC-midnight instant in
 * it only ever moves the wall clock later within the same calendar day.
 */
const MONTH_DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  day: "numeric",
  month: "long",
});

export function formatMonthDayLabel(isoDate: string): string {
  const parts = isoDate.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return MONTH_DAY_FORMAT.format(new Date(Date.UTC(year, month - 1, day)));
}

/** Just the weekday name ("Friday"), for short inline copy. */
export function formatWeekdayName(isoDate: string): string {
  const parts = isoDate.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    weekday: "long",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * "5:37 pm" for an entry's `submittedAt` -- a full UTC instant, not a civil
 * date, so this is the one formatter here that does NOT reconstruct a
 * UTC-midnight Date -- the instant is already precise and is passed straight
 * to Intl. Was declared separately in student-today.tsx and my-progress's
 * page needed the identical formatter for the same reason (differentiating
 * multiple entries on one day) -- duplicating it a second time is exactly
 * what counts-row.tsx's own history warns against.
 */
export const ENTRY_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

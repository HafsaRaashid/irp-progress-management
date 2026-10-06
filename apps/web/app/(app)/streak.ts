import type { DayStatus } from "@irp/client";

/**
 * The student's own submitted-day count for the current month — FR-29, and
 * FR-30-safe by construction: own data only, no peer, no rank, no score, and
 * no rate that invites comparison.
 *
 * DERIVED, not fetched. `StudentDashboard.days` already carries every required
 * day in the current cycle with this student's own classification, so this adds
 * no API surface.
 *
 * ## Why this is not "days in a row"
 *
 * `days` is CURRENT-CYCLE ONLY — the spec says so outright. A consecutive-run
 * counter built on it would reset to zero on the 10th of every month, telling a
 * student with a forty-day run that they have none. That is not fixable
 * client-side, and this slice adds no API field, so the honest figure is the
 * one the data can actually support: how many of this month's required days so
 * far carry a submission.
 *
 * ## Why the denominator is days ELAPSED, not days in the cycle
 *
 * On day 3 of a 22-day month a student who has submitted everything would read
 * "3 of 22" — 14%, which looks like failure and is simply wrong as a measure of
 * how they are doing. "3 of 3" is both accurate and what they have earned.
 *
 * ## Why weekends cannot reach either side of it
 *
 * Safe by construction rather than by a filter: `days` holds REQUIRED days
 * only, and weekend work is reported separately through `extraAfter`. **Do not
 * re-derive this from `submissionWindow().targetDates`** — that list DOES carry
 * Saturday and Sunday on a Monday, and a count built from it would put optional
 * work in a compliance denominator, contradicting FR-12 and the glossary.
 */
export interface Streak {
  /** Required days so far this month carrying a submission, on time or late. */
  submitted: number;
  /** Required days so far this month whose outcome has settled. */
  elapsed: number;
}

/**
 * Statuses whose outcome is final. A day still inside its grace window has not
 * happened yet as far as this count is concerned — including it would show a
 * student a shortfall for an afternoon they can still submit for.
 */
const SETTLED = new Set<DayStatus>(["onTime", "late", "absent", "missed"]);

/** Counted as submitted. A late entry was accepted — §3.2: "accepted, flagged, not punished". */
const SUBMITTED = new Set<DayStatus>(["onTime", "late"]);

export function streakFor(days: readonly { status: DayStatus }[]): Streak {
  let submitted = 0;
  let elapsed = 0;

  for (const day of days) {
    if (!SETTLED.has(day.status)) continue;

    // ASSUMPTION: O-7 — absence carries no automatic penalty, so an excused
    // day is not a lapse. It is excluded from BOTH sides rather than counted
    // as a miss: a student absent with a reason should not watch this figure
    // fall. If leadership rules that absence penalises the score, this branch
    // is what changes.
    if (day.status === "absent") continue;

    elapsed += 1;
    if (SUBMITTED.has(day.status)) submitted += 1;
  }

  return { submitted, elapsed };
}

/**
 * The chip's copy, or null when there is nothing honest to say yet.
 *
 * It names NO window. The ribbon directly above renders cycleHeading()'s
 * "Month 3 of 6 · 10 July – 9 August", so the context is established one
 * element up — which also keeps the word "cycle" out of student-facing copy
 * without having to find a synonym for it here.
 */
export function streakLabel(streak: Streak): string | null {
  if (streak.elapsed === 0) return null;
  return `${String(streak.submitted)} of ${String(streak.elapsed)} days submitted`;
}

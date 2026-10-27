import { compareDates, type CivilDate } from "@irp/core";
import type { EnrolmentRecord } from "../db/batch-repo.js";

/**
 * The enrolment whose batch calendar a student follows (ADR-0035): the one
 * covering `today`, else the latest they held — a student who has left, or
 * not yet started, still gets a calendar to look at. Null for someone with
 * no enrolment at all, such as a mentor.
 *
 * ADR-0017's disjoint intervals guarantee at most one covers any day, so
 * "the one covering today" is never ambiguous.
 */
export function currentEnrolment(enrolments: EnrolmentRecord[], today: CivilDate): EnrolmentRecord | null {
  const covering = enrolments.find(
    (e) => compareDates(e.startDate, today) <= 0 && (e.endDate === null || compareDates(e.endDate, today) >= 0),
  );
  if (covering !== undefined) return covering;
  // Not enrolled today: the latest interval by start date. A future one (not
  // started yet) wins over a past one, which is the calendar they are about to join.
  let latest: EnrolmentRecord | null = null;
  for (const e of enrolments) {
    if (latest === null || compareDates(e.startDate, latest.startDate) > 0) latest = e;
  }
  return latest;
}

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { streakFor, streakLabel } from "@/app/(app)/streak";
import type { DayStatus } from "@irp/client";

const days = (...statuses: DayStatus[]): { status: DayStatus }[] =>
  statuses.map((status) => ({ status }));

describe("streakFor", () => {
  it("counts nothing before anything has settled", () => {
    expect(streakFor(days("pending", "future", "future"))).toEqual({ submitted: 0, elapsed: 0 });
  });

  it("counts a full month of on-time days", () => {
    expect(streakFor(days("onTime", "onTime", "onTime"))).toEqual({ submitted: 3, elapsed: 3 });
  });

  /**
   * THE regression this exists to prevent. The denominator is days ELAPSED,
   * not days in the cycle: three settled days into a 22-day month, a student
   * who has submitted everything must read "3 of 3", never "3 of 22". The
   * latter is 14% and looks like failure for a perfect record.
   */
  it("uses days elapsed as the denominator, never the length of the month", () => {
    const monthSoFar = days("onTime", "onTime", "onTime", ...Array<DayStatus>(19).fill("future"));
    expect(streakFor(monthSoFar)).toEqual({ submitted: 3, elapsed: 3 });
    expect(streakLabel(streakFor(monthSoFar))).toBe("3 of 3 days submitted");
  });

  /**
   * ASSUMPTION: O-7 — absence carries no automatic penalty, so it is in
   * NEITHER the numerator nor the denominator. A student absent with a reason
   * should not watch this figure fall for a day they were excused from.
   */
  it("excludes an absence from both sides rather than counting it as a miss", () => {
    expect(streakFor(days("onTime", "absent", "onTime"))).toEqual({ submitted: 2, elapsed: 2 });
    expect(streakLabel(streakFor(days("onTime", "absent", "onTime")))).toBe("2 of 2 days submitted");
  });

  /** §3.2: a late entry is "accepted, flagged, not punished". It was submitted. */
  it("counts a late submission as submitted", () => {
    expect(streakFor(days("onTime", "late"))).toEqual({ submitted: 2, elapsed: 2 });
  });

  it("counts a missed day in the denominator only", () => {
    expect(streakFor(days("onTime", "missed", "onTime"))).toEqual({ submitted: 2, elapsed: 3 });
  });

  /**
   * A day still inside its grace window has not happened yet for this count.
   * Including it would show a shortfall for an afternoon the student can
   * still submit for — the figure would dip every morning and recover every
   * evening, which is both wrong and demoralising.
   */
  it("ignores a day still inside its grace window", () => {
    expect(streakFor(days("onTime", "onTime", "pending"))).toEqual({ submitted: 2, elapsed: 2 });
  });

  /**
   * Weekends are safe BY CONSTRUCTION: `days` carries required days only, and
   * weekend work is reported through `extraAfter`. Asserted anyway, because
   * the obvious wrong implementation derives this from
   * submissionWindow().targetDates — which DOES carry Saturday and Sunday on a
   * Monday — and that would put optional work in a compliance denominator,
   * contradicting FR-12 and the glossary. `extra` must never move either side.
   */
  it("never lets weekend work reach either side of the count", () => {
    expect(streakFor(days("onTime", "extra", "onTime", "extra"))).toEqual({
      submitted: 2,
      elapsed: 2,
    });
  });

  it("ignores a day with no record at all", () => {
    expect(streakFor(days("onTime", "none"))).toEqual({ submitted: 1, elapsed: 1 });
  });
});

describe("streakLabel", () => {
  /**
   * A mid-cycle joiner, or a student on the first morning of a month, has
   * nothing settled. "0 of 0 days submitted" is noise at best and reads as a
   * reproach at worst, so the chip renders nothing at all.
   */
  it("says nothing when nothing has settled", () => {
    expect(streakLabel({ submitted: 0, elapsed: 0 })).toBeNull();
  });

  it("names no window, since the ribbon above already does", () => {
    const label = streakLabel({ submitted: 12, elapsed: 14 })!;
    expect(label).toBe("12 of 14 days submitted");
    expect(label).not.toContain("cycle");
    expect(label).not.toContain("month");
  });

  /** FR-30: no score, no rank, no percentage, nothing comparative. */
  it("renders a count, never a rate or a grade", () => {
    const label = streakLabel({ submitted: 12, elapsed: 14 })!;
    expect(label).not.toContain("%");
    expect(label).not.toMatch(/rank|score|average|top|best/i);
  });
});

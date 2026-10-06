// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cycleHeading } from "@/app/(app)/cycle-heading";

/**
 * cycleHeading had NO test anywhere until this file — `grep -rln "cycleHeading"
 * apps/web/test/` returned nothing — despite owning a three-branch rule that
 * renders on two pages and must never produce "Month null of 6".
 *
 * All three branches are covered here, not only the one the date-range change
 * touched. The mid-cycle-joiner branches are the ones with a real failure mode:
 * `cycle.seq` is null until a student's first evaluated cycle opens (FR-27),
 * and the programme pips on My progress have to agree with whatever this
 * function decides, so both have to be pinned.
 */
describe("cycleHeading", () => {
  const enrolled = {
    programmeMonths: 6,
    firstEvaluatedCycleStart: "2026-06-10",
    cycle: { seq: 3, startDate: "2026-07-10", endDate: "2026-08-09" },
  };

  it("names the month, the programme length and the date range", () => {
    expect(cycleHeading(enrolled)).toBe("Month 3 of 6 · 10 July – 9 August");
  });

  /**
   * The range carries NO weekday names. formatCivilDateLabel would render
   * "Friday 10 July – Saturday 9 August", which puts two facts in front of the
   * student that mean nothing on a month boundary. A single day keeps its
   * weekday — see the joiner case below, which is deliberately different.
   */
  it("omits weekday names from the range, which are noise on a month boundary", () => {
    const heading = cycleHeading(enrolled);
    for (const weekday of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
      expect(heading).not.toContain(weekday);
    }
  });

  /** A mid-cycle joiner, before their first evaluated cycle opens (FR-27). */
  it("never renders a null sequence as a number", () => {
    const joiner = { ...enrolled, cycle: { ...enrolled.cycle, seq: null } };
    const heading = cycleHeading(joiner);
    expect(heading).not.toContain("null");
    expect(heading).not.toContain("NaN");
    expect(heading).toBe("Your first evaluated month starts Wednesday 10 June");
  });

  /**
   * The joiner branch names ONE day, so it KEEPS its weekday — §11's copy
   * voice. This is the counterpart to the range test above and the reason both
   * formatters exist.
   */
  it("keeps the weekday when naming a single day", () => {
    const joiner = { ...enrolled, cycle: { ...enrolled.cycle, seq: null } };
    expect(cycleHeading(joiner)).toContain("Wednesday");
  });

  /** No enrolment at all: no seq AND no first evaluated cycle. */
  it("says so plainly when there is no enrolment", () => {
    const unenrolled = {
      programmeMonths: 6,
      firstEvaluatedCycleStart: null,
      cycle: { seq: null, startDate: "2026-07-10", endDate: "2026-08-09" },
    };
    expect(cycleHeading(unenrolled)).toBe("You are not enrolled in a batch yet.");
  });

  /**
   * Dates resolve in Asia/Colombo, never the runner's zone. Built from a
   * UTC-midnight instant, so a machine behind UTC would roll these back a day
   * if the timezone were ever dropped from the formatter.
   */
  it("renders dates in Asia/Colombo regardless of the runner's timezone", () => {
    const yearEnd = {
      programmeMonths: 6,
      firstEvaluatedCycleStart: null,
      cycle: { seq: 1, startDate: "2026-01-01", endDate: "2026-12-31" },
    };
    expect(cycleHeading(yearEnd)).toBe("Month 1 of 6 · 1 January – 31 December");
  });
});

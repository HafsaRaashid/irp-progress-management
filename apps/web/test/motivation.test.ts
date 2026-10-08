// @vitest-environment node
import { describe, expect, it } from "vitest";
import { motivationFor, currentRun } from "@/app/(app)/motivation";
import type { DayStatus } from "@irp/client";

const d = (date: string, status: DayStatus) => ({ date, status });

describe("currentRun", () => {
  it("counts the trailing run of submitted days", () => {
    expect(currentRun([d("1", "onTime"), d("2", "onTime"), d("3", "onTime")])).toBe(3);
  });

  it("counts a late day as showing up (§3.2: accepted, flagged, not punished)", () => {
    expect(currentRun([d("1", "onTime"), d("2", "late")])).toBe(2);
  });

  it("breaks the run on a missed day", () => {
    expect(currentRun([d("1", "onTime"), d("2", "missed"), d("3", "onTime")])).toBe(1);
  });

  /**
   * // ASSUMPTION: O-7 — absence carries no penalty, so being excused must not
   * cost a student their streak. The absent day is transparent: it neither
   * extends the run nor ends it.
   */
  it("treats an absence as transparent, neither extending nor breaking the run", () => {
    expect(currentRun([d("1", "onTime"), d("2", "absent"), d("3", "onTime")])).toBe(2);
  });

  it("does not let an unsubmitted today break the run", () => {
    expect(currentRun([d("1", "onTime"), d("2", "onTime"), d("3", "pending")])).toBe(2);
  });
});

describe("motivationFor", () => {
  /**
   * THE test this module exists for. A struggling student must never be told
   * what they missed. Every branch reachable with misses in the data is
   * checked for the vocabulary of reproach.
   */
  it("never mentions a gap, a miss, or a count of failures — on any branch", () => {
    const rough = [
      d("2026-10-01", "missed"), d("2026-10-02", "missed"),
      d("2026-10-05", "missed"), d("2026-10-06", "pending"),
    ];
    const line = motivationFor({ days: rough, today: "2026-10-06", seq: 3 });
    expect(line).not.toMatch(/miss|behind|lost|broke|failed|gap|again|only|but/i);
    // It says what is still possible instead.
    expect(line).toBe("Today's still open.");
  });

  it("stays forward-looking even when the whole month has gone badly", () => {
    const allMissed = Array.from({ length: 12 }, (_, i) =>
      d(`2026-10-${String(i + 1).padStart(2, "0")}`, "missed"));
    const line = motivationFor({ days: allMissed, today: "2026-10-13", seq: 3 });
    expect(line).not.toMatch(/miss|behind|failed|zero|none/i);
    expect(line).toBe("Today's still open.");
  });

  it("celebrates a personal best, and only when it really is one", () => {
    const days = Array.from({ length: 6 }, (_, i) =>
      d(`2026-10-${String(i + 1).padStart(2, "0")}`, "onTime"));
    expect(motivationFor({ days, today: "2026-10-06", seq: 3 }))
      .toBe("6 days running — your longest yet.");
  });

  it("does not claim a personal best for a run that is not the longest", () => {
    // A 7-day run earlier, broken, then a 5-day run now.
    const days = [
      ...Array.from({ length: 7 }, (_, i) => d(`a${String(i)}`, "onTime")),
      d("break", "missed"),
      ...Array.from({ length: 5 }, (_, i) => d(`b${String(i)}`, "onTime")),
      d("2026-10-20", "onTime"),
    ];
    const line = motivationFor({ days, today: "2026-10-20", seq: 3 });
    expect(line).not.toContain("longest");
    expect(line).toBe("6 days running.");
  });

  /** A return after a break is acknowledged as a return, never as a recovery from failure. */
  it("acknowledges a comeback without naming what it came back from", () => {
    const days = [d("2026-10-01", "onTime"), d("2026-10-02", "missed"), d("2026-10-06", "onTime")];
    const line = motivationFor({ days, today: "2026-10-06", seq: 3 });
    expect(line).toBe("Back on it. Logged for today.");
    expect(line).not.toMatch(/miss|break|again/i);
  });

  it("offers a clean slate at the start of a month, identically after a good or bad one", () => {
    const fresh = [d("2026-10-12", "pending"), d("2026-10-13", "future")];
    expect(motivationFor({ days: fresh, today: "2026-10-12", seq: 4 })).toBe("Month 4 starts here.");
  });

  /** A mid-cycle joiner has no sequence yet (FR-27) — never "Month null starts here". */
  it("handles a joiner with no month number", () => {
    const fresh = [d("2026-10-12", "future")];
    const line = motivationFor({ days: fresh, today: "2026-10-12", seq: null });
    expect(line).toBe("Your first month starts here.");
    expect(line).not.toContain("null");
  });

  /** FR-30: nothing comparative can appear, on any branch. */
  it("never renders a score, a rank, a percentage or a peer", () => {
    const cases: { days: { date: string; status: DayStatus }[]; today: string; seq: number | null }[] = [
      { days: [d("x", "onTime")], today: "x", seq: 1 },
      { days: [d("x", "missed")], today: "y", seq: 2 },
      { days: [d("x", "absent")], today: "y", seq: null },
      { days: [], today: "y", seq: 3 },
    ];
    for (const c of cases) {
      const line = motivationFor(c);
      expect(line).not.toMatch(/%|rank|score|average|peer|than|top|best in|cohort/i);
    }
  });
});

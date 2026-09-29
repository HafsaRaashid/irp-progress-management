import { describe, it, expect } from "vitest";
import { civilDate } from "@irp/core";
import { weeksForCycle } from "@/lib/calendar-grid";

describe("weeksForCycle", () => {
  it("pads a cycle starting mid-week with dimmed leading days from the same Monday-first row", () => {
    // 2026-08-10 is a Monday, so this cycle needs no leading padding --
    // use one that starts on a Wednesday instead.
    const weeks = weeksForCycle({ start: civilDate("2026-07-10"), end: civilDate("2026-08-09") });
    // 2026-07-10 is a Friday.
    const firstWeek = weeks[0]!;
    expect(firstWeek).toHaveLength(7);
    expect(firstWeek[0]!.date).toBe("2026-07-06"); // Monday of that week
    expect(firstWeek[0]!.inCycle).toBe(false);
    expect(firstWeek[4]!.date).toBe("2026-07-10"); // the cycle's actual first day
    expect(firstWeek[4]!.inCycle).toBe(true);
  });

  it("pads a cycle ending mid-week with dimmed trailing days", () => {
    // 2026-07-10 to 2026-08-09: 2026-08-09 is a Sunday, so the cycle's own
    // last day already ends its row -- assert on a cycle whose end is NOT a
    // Sunday instead.
    const oddEnd = weeksForCycle({ start: civilDate("2026-06-10"), end: civilDate("2026-07-09") });
    const lastWeek = oddEnd[oddEnd.length - 1]!;
    // 2026-07-09 is a Thursday.
    expect(lastWeek[3]!.date).toBe("2026-07-09");
    expect(lastWeek[3]!.inCycle).toBe(true);
    expect(lastWeek[4]!.inCycle).toBe(false);
    expect(lastWeek[6]!.inCycle).toBe(false);
  });

  it("every week has exactly 7 days running Monday to Sunday", () => {
    const weeks = weeksForCycle({ start: civilDate("2026-08-10"), end: civilDate("2026-09-09") });
    for (const week of weeks) {
      expect(week).toHaveLength(7);
    }
    expect(weeks.flat().length % 7).toBe(0);
  });

  it("returns every in-cycle date exactly once, earliest first", () => {
    const weeks = weeksForCycle({ start: civilDate("2026-08-10"), end: civilDate("2026-09-09") });
    const inCycleDates = weeks.flat().filter((c) => c.inCycle).map((c) => c.date);
    expect(inCycleDates[0]).toBe("2026-08-10");
    expect(inCycleDates[inCycleDates.length - 1]).toBe("2026-09-09");
    expect(new Set(inCycleDates).size).toBe(inCycleDates.length);
  });
});

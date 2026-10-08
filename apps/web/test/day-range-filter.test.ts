// @vitest-environment node
import { describe, expect, it } from "vitest";
import { civilDate } from "@irp/core";
import { isWithinTrailingWeek } from "@/app/(app)/day-range-filter";

describe("isWithinTrailingWeek", () => {
  const today = civilDate("2026-10-06"); // a Tuesday

  it("includes today itself", () => {
    expect(isWithinTrailingWeek(today, today)).toBe(true);
  });

  it("includes exactly 6 days back -- a 7-day window", () => {
    expect(isWithinTrailingWeek(civilDate("2026-09-30"), today)).toBe(true);
  });

  it("excludes 7 days back, one day outside the window", () => {
    expect(isWithinTrailingWeek(civilDate("2026-09-29"), today)).toBe(false);
  });

  it("excludes a date after today", () => {
    expect(isWithinTrailingWeek(civilDate("2026-10-07"), today)).toBe(false);
  });

  it("is a rolling window, not a calendar week -- crosses a month boundary correctly", () => {
    const today2 = civilDate("2026-10-02"); // a Friday, 6 days back lands in September
    expect(isWithinTrailingWeek(civilDate("2026-09-26"), today2)).toBe(true);
    expect(isWithinTrailingWeek(civilDate("2026-09-25"), today2)).toBe(false);
  });
});

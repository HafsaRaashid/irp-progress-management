import { describe, expect, it } from "vitest";
import { addDays, addMonths, civilDate, compareDates, dayOfWeek } from "./civil-date.js";

describe("civilDate", () => {
  it("accepts a valid ISO calendar date", () => {
    expect(civilDate("2026-07-28")).toBe("2026-07-28");
  });

  it("rejects a malformed string", () => {
    expect(() => civilDate("28-07-2026")).toThrow(RangeError);
  });

  it("rejects an impossible date", () => {
    expect(() => civilDate("2026-02-30")).toThrow(RangeError);
  });

  it("accepts a real leap day", () => {
    expect(civilDate("2028-02-29")).toBe("2028-02-29");
  });

  it("rejects a leap day in a non-leap year", () => {
    expect(() => civilDate("2026-02-29")).toThrow(RangeError);
  });

  // Guards the Date.UTC year-remapping trap: years 0-99 become 1900-1999,
  // which would make the validation round-trip reject a valid date.
  it("accepts a valid date in the first century", () => {
    expect(civilDate("0099-01-01")).toBe("0099-01-01");
  });

  it("still rejects an impossible date in the first century", () => {
    expect(() => civilDate("0099-02-30")).toThrow(RangeError);
  });
});

describe("addDays", () => {
  it("adds within a month", () => {
    expect(addDays(civilDate("2026-07-01"), 5)).toBe("2026-07-06");
  });

  it("rolls over a month boundary", () => {
    expect(addDays(civilDate("2026-07-31"), 1)).toBe("2026-08-01");
  });

  it("rolls over a year boundary", () => {
    expect(addDays(civilDate("2026-12-31"), 1)).toBe("2027-01-01");
  });

  it("subtracts across a month boundary", () => {
    expect(addDays(civilDate("2026-03-01"), -1)).toBe("2026-02-28");
  });

  it("handles a leap year February", () => {
    expect(addDays(civilDate("2028-03-01"), -1)).toBe("2028-02-29");
  });

  // civilDate() validates years 0-99 via setUTCFullYear, so the arithmetic
  // must be built the same way. Date.UTC would remap 0099 to 1999 and return
  // "1999-01-02" here — validated input, silently wrong output.
  it("stays in the first century instead of remapping to 1900-1999", () => {
    expect(addDays(civilDate("0099-01-01"), 1)).toBe("0099-01-02");
  });
});

describe("addMonths", () => {
  it("keeps the day of the month", () => {
    expect(addMonths(civilDate("2026-08-15"), 1)).toBe("2026-09-15");
  });

  it("rolls over a year boundary, forwards and backwards", () => {
    expect(addMonths(civilDate("2026-12-15"), 1)).toBe("2027-01-15");
    expect(addMonths(civilDate("2026-01-15"), -1)).toBe("2025-12-15");
  });

  it("clamps to the last day of a shorter month", () => {
    expect(addMonths(civilDate("2026-01-31"), 1)).toBe("2026-02-28");
    expect(addMonths(civilDate("2026-08-31"), 1)).toBe("2026-09-30");
  });

  it("clamps to 29 February in a leap year", () => {
    expect(addMonths(civilDate("2028-01-31"), 1)).toBe("2028-02-29");
  });

  it("is not associative once a month clamps, which is why callers shift from one anchor", () => {
    const start = civilDate("2026-01-31");
    expect(addMonths(addMonths(start, 1), 1)).toBe("2026-03-28");
    expect(addMonths(start, 2)).toBe("2026-03-31");
  });

  it("shifts by more than a year", () => {
    expect(addMonths(civilDate("2026-08-15"), 18)).toBe("2028-02-15");
  });

  it("stays in the first century", () => {
    expect(addMonths(civilDate("0099-01-15"), 1)).toBe("0099-02-15");
  });
});

describe("dayOfWeek", () => {
  it("returns 2 for a known Tuesday", () => {
    expect(dayOfWeek(civilDate("2026-07-28"))).toBe(2);
  });

  it("returns 6 for a known Saturday", () => {
    expect(dayOfWeek(civilDate("2026-08-01"))).toBe(6);
  });

  it("returns 0 for a known Sunday", () => {
    expect(dayOfWeek(civilDate("2026-08-02"))).toBe(0);
  });

  // Proleptic Gregorian: 0099-01-01 is a Thursday (4). 1999-01-01 was a
  // Friday (5), so a Date.UTC-based implementation returns 5 here.
  it("returns the first-century weekday, not the 1900s remap", () => {
    expect(dayOfWeek(civilDate("0099-01-01"))).toBe(4);
  });
});

describe("compareDates", () => {
  it("orders earlier before later", () => {
    expect(compareDates(civilDate("2026-07-01"), civilDate("2026-07-02"))).toBe(-1);
  });

  it("returns 0 for equal dates", () => {
    expect(compareDates(civilDate("2026-07-01"), civilDate("2026-07-01"))).toBe(0);
  });

  it("orders later after earlier", () => {
    expect(compareDates(civilDate("2026-08-01"), civilDate("2026-07-31"))).toBe(1);
  });
});

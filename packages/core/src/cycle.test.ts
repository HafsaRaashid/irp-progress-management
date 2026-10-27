import { describe, expect, it } from "vitest";
import { civilDate } from "./civil-date.js";
import {
  batchPhase,
  cycleAt,
  cycleBounds,
  cycleCount,
  cycleWorkingDays,
  firstEvaluatedCycle,
  PROGRAMME_MONTHS,
  type BatchWindow,
} from "./cycle.js";
import { isWeekday } from "./weekday.js";

/** A six-month batch starting mid-month, the shape that motivated batch-anchored cycles. */
const BATCH: BatchWindow = {
  startDate: civilDate("2026-08-15"),
  endDate: civilDate("2027-02-14"),
};

describe("cycleBounds", () => {
  it("starts cycle 1 on the batch start date", () => {
    expect(cycleBounds(BATCH, 1)).toEqual({ start: "2026-08-15", end: "2026-09-14", index: 1 });
  });

  it("starts each later cycle on the same day of the month", () => {
    expect(cycleBounds(BATCH, 2)).toEqual({ start: "2026-09-15", end: "2026-10-14", index: 2 });
    expect(cycleBounds(BATCH, 5)).toEqual({ start: "2026-12-15", end: "2027-01-14", index: 5 });
  });

  it("ends the last cycle on the batch end date", () => {
    expect(cycleBounds(BATCH, 6)).toEqual({ start: "2027-01-15", end: "2027-02-14", index: 6 });
  });

  it("clips the last cycle to the batch end when the batch stops early", () => {
    const short: BatchWindow = { startDate: civilDate("2026-08-15"), endDate: civilDate("2026-10-01") };
    expect(cycleBounds(short, 2)).toEqual({ start: "2026-09-15", end: "2026-10-01", index: 2 });
  });

  it("has no cycle past the batch end, before 1, or non-integer", () => {
    expect(cycleBounds(BATCH, 7)).toBeNull();
    expect(cycleBounds(BATCH, 0)).toBeNull();
    expect(cycleBounds(BATCH, 1.5)).toBeNull();
  });

  it("keeps a 31st start on the 31st where the month has one, and clamps where it does not", () => {
    const thirtyFirst: BatchWindow = { startDate: civilDate("2026-01-31"), endDate: civilDate("2026-07-30") };
    expect(cycleBounds(thirtyFirst, 1)).toEqual({ start: "2026-01-31", end: "2026-02-27", index: 1 });
    expect(cycleBounds(thirtyFirst, 2)).toEqual({ start: "2026-02-28", end: "2026-03-30", index: 2 });
    // Shifted from the batch start, not from February's clamped 28th.
    expect(cycleBounds(thirtyFirst, 3)).toEqual({ start: "2026-03-31", end: "2026-04-29", index: 3 });
  });

  it("leaves no gap and no overlap between consecutive cycles", () => {
    for (let i = 1; i < cycleCount(BATCH); i += 1) {
      const a = cycleBounds(BATCH, i)!;
      const b = cycleBounds(BATCH, i + 1)!;
      const dayAfter = new Date(`${a.end}T00:00:00Z`);
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      expect(b.start).toBe(dayAfter.toISOString().slice(0, 10));
    }
  });
});

describe("cycleCount", () => {
  it("counts the cycles a batch holds", () => {
    expect(cycleCount(BATCH)).toBe(6);
  });

  it("counts a one-day batch as one cycle", () => {
    const oneDay: BatchWindow = { startDate: civilDate("2026-08-15"), endDate: civilDate("2026-08-15") };
    expect(cycleCount(oneDay)).toBe(1);
  });

  it("counts a batch that ends the day before a would-be cycle starts without that cycle", () => {
    const b: BatchWindow = { startDate: civilDate("2026-08-15"), endDate: civilDate("2026-09-14") };
    expect(cycleCount(b)).toBe(1);
  });

  it("rejects a batch that ends before it starts", () => {
    const bad: BatchWindow = { startDate: civilDate("2026-08-15"), endDate: civilDate("2026-08-14") };
    expect(() => cycleCount(bad)).toThrow(RangeError);
  });
});

describe("batchPhase", () => {
  it("is before, during or after the batch's own dates, both ends inclusive", () => {
    expect(batchPhase(BATCH, civilDate("2026-08-14"))).toBe("before");
    expect(batchPhase(BATCH, civilDate("2026-08-15"))).toBe("during");
    expect(batchPhase(BATCH, civilDate("2027-02-14"))).toBe("during");
    expect(batchPhase(BATCH, civilDate("2027-02-15"))).toBe("after");
  });
});

describe("cycleAt", () => {
  it("puts the batch start day at the start of cycle 1", () => {
    expect(cycleAt(BATCH, civilDate("2026-08-15"))).toEqual({ start: "2026-08-15", end: "2026-09-14", index: 1 });
  });

  it("puts the day before a cycle start at the end of the previous cycle", () => {
    expect(cycleAt(BATCH, civilDate("2026-09-14")).index).toBe(1);
    expect(cycleAt(BATCH, civilDate("2026-09-15")).index).toBe(2);
  });

  it("places a mid-cycle date correctly", () => {
    expect(cycleAt(BATCH, civilDate("2026-11-02"))).toEqual({ start: "2026-10-15", end: "2026-11-14", index: 3 });
  });

  it("agrees with cycleBounds for every date in the batch", () => {
    for (let d = new Date("2026-08-15T00:00:00Z"); d <= new Date("2027-02-14T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      const date = civilDate(d.toISOString().slice(0, 10));
      const cycle = cycleAt(BATCH, date);
      expect(cycle.start <= date && date <= cycle.end).toBe(true);
      expect(cycleBounds(BATCH, cycle.index)).toEqual(cycle);
    }
  });

  it("agrees with cycleBounds for every date of a batch starting on the 31st", () => {
    const b: BatchWindow = { startDate: civilDate("2026-01-31"), endDate: civilDate("2026-07-30") };
    for (let d = new Date("2026-01-31T00:00:00Z"); d <= new Date("2026-07-30T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      const date = civilDate(d.toISOString().slice(0, 10));
      const cycle = cycleAt(b, date);
      expect(cycle.start <= date && date <= cycle.end).toBe(true);
    }
  });

  it("clamps a date before the batch to cycle 1 and a date after it to the last cycle", () => {
    expect(cycleAt(BATCH, civilDate("2026-01-01")).index).toBe(1);
    expect(cycleAt(BATCH, civilDate("2030-01-01")).index).toBe(6);
  });
});

describe("firstEvaluatedCycle", () => {
  it("is cycle 1 for a student admitted on the batch start", () => {
    expect(firstEvaluatedCycle(BATCH, civilDate("2026-08-15"))?.index).toBe(1);
  });

  it("is cycle 1 for a student admitted before the batch start", () => {
    expect(firstEvaluatedCycle(BATCH, civilDate("2026-07-01"))?.index).toBe(1);
  });

  it("is the same cycle when admitted exactly on a later cycle's start", () => {
    expect(firstEvaluatedCycle(BATCH, civilDate("2026-09-15"))).toEqual({
      start: "2026-09-15", end: "2026-10-14", index: 2,
    });
  });

  it("skips to the next cycle when admitted mid-cycle (FR-27)", () => {
    expect(firstEvaluatedCycle(BATCH, civilDate("2026-09-20"))?.index).toBe(3);
  });

  it("skips to the next cycle when admitted on a cycle's last day", () => {
    expect(firstEvaluatedCycle(BATCH, civilDate("2026-09-14"))?.index).toBe(2);
  });

  it("is null when admitted during the last cycle, with no next one to start", () => {
    expect(firstEvaluatedCycle(BATCH, civilDate("2027-01-20"))).toBeNull();
  });

  it("is null when admitted after the batch ended", () => {
    expect(firstEvaluatedCycle(BATCH, civilDate("2027-03-01"))).toBeNull();
  });
});

describe("cycleWorkingDays", () => {
  const bounds = { start: civilDate("2026-08-10"), end: civilDate("2026-09-09") };

  it("contains only weekdays", () => {
    for (const day of cycleWorkingDays(bounds)) {
      expect(isWeekday(day)).toBe(true);
    }
  });

  it("starts on or after the cycle start and ends on or before the cycle end", () => {
    const days = cycleWorkingDays(bounds);
    expect(days.at(0)).toBe("2026-08-10");
    expect(days.at(-1)).toBe("2026-09-09");
  });

  it("returns between 20 and 24 working days for a typical cycle", () => {
    const days = cycleWorkingDays(bounds);
    expect(days.length).toBeGreaterThanOrEqual(20);
    expect(days.length).toBeLessThanOrEqual(24);
  });
});

describe("PROGRAMME_MONTHS", () => {
  it("is the six-cycle programme length FR-29 reports against", () => {
    expect(PROGRAMME_MONTHS).toBe(6);
  });
});

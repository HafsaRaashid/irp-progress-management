import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  civilDate,
  classifyDay,
  cycleAt,
  cycleBounds,
  cycleCount,
  cycleWorkingDays,
  isWeekday,
  nextWeekday,
  previousWeekday,
  submissionWindow,
  toProgrammeDate,
  type DayFacts,
} from "./index.js";

/** Every date from 2026-01-01 for three years. */
function everyDateForThreeYears(): string[] {
  const dates: string[] = [];
  let cursor = civilDate("2026-01-01");
  const stop = civilDate("2029-01-01");
  while (cursor < stop) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

describe("invariants across three years of dates", () => {
  const all = everyDateForThreeYears();

  it("previousWeekday never returns a weekend", () => {
    for (const date of all) {
      expect(isWeekday(previousWeekday(civilDate(date)))).toBe(true);
    }
  });

  it("nextWeekday never returns a weekend", () => {
    for (const date of all) {
      expect(isWeekday(nextWeekday(civilDate(date)))).toBe(true);
    }
  });

  // One batch per start day of the month, so the 29th-31st clamping paths run.
  const batches = Array.from({ length: 31 }, (_, i) => {
    const startDate = civilDate(`2026-01-${String(i + 1).padStart(2, "0")}`);
    return { startDate, endDate: addDays(addMonths(startDate, 6), -1) };
  });

  it("cycleWorkingDays never contains a weekend", () => {
    for (const batch of batches) {
      for (let i = 1; i <= cycleCount(batch); i += 1) {
        for (const day of cycleWorkingDays(cycleBounds(batch, i)!)) {
          expect(isWeekday(day)).toBe(true);
        }
      }
    }
  });

  it("every cycle starts on the batch's day of the month, clamped to the month's length", () => {
    for (const batch of batches) {
      const startDay = Number(batch.startDate.slice(8, 10));
      for (let i = 1; i <= cycleCount(batch); i += 1) {
        const { start } = cycleBounds(batch, i)!;
        expect(start).toBe(addMonths(batch.startDate, i - 1));
        expect(Number(start.slice(8, 10))).toBeLessThanOrEqual(startDay);
      }
    }
  });

  it("the first cycle starts on the batch start and the last ends on the batch end", () => {
    for (const batch of batches) {
      expect(cycleBounds(batch, 1)!.start).toBe(batch.startDate);
      expect(cycleBounds(batch, cycleCount(batch))!.end).toBe(batch.endDate);
    }
  });

  it("every date in a batch falls in exactly the cycle cycleAt reports", () => {
    for (const batch of batches) {
      for (let date = batch.startDate; date <= batch.endDate; date = addDays(date, 1)) {
        const { start, end, index } = cycleAt(batch, date);
        expect(start <= date && date <= end).toBe(true);
        const containing = Array.from({ length: cycleCount(batch) }, (_, k) => cycleBounds(batch, k + 1)!)
          .filter((c) => c.start <= date && date <= c.end);
        expect(containing.map((c) => c.index)).toEqual([index]);
      }
    }
  });

  // A single mid-day instant per date exercises the calendar arithmetic
  // thoroughly and the timezone boundary not at all. 18:29:59.999Z is the
  // last millisecond of a Colombo day and 18:30:00.000Z the first of the
  // next, so each date is also probed either side of the rollover — where a
  // UTC-vs-Colombo mixup would show up as an off-by-one day.
  const instantsFor = (date: string): Date[] => [
    new Date(`${date}T06:00:00Z`),
    new Date(`${date}T18:29:59.999Z`),
    new Date(`${date}T18:30:00.000Z`),
  ];

  it("submissionWindow always offers today as a target, including across the Colombo midnight boundary", () => {
    // Today can never be out of grace, weekday or weekend. "Today" is the
    // Colombo date at that instant, which past 18:30Z is the NEXT UTC date.
    for (const date of all) {
      for (const instant of instantsFor(date)) {
        const today = toProgrammeDate(instant);
        expect(submissionWindow(instant).targetDates).toContain(today);
      }
    }
  });

  it("submissionWindow never offers a future date, including across the Colombo midnight boundary", () => {
    for (const date of all) {
      for (const instant of instantsFor(date)) {
        const today = toProgrammeDate(instant);
        for (const target of submissionWindow(instant).targetDates) {
          expect(target <= today).toBe(true);
        }
      }
    }
  });

  it("a weekend is never missed, late, absent or pending (FR-12, FR-33)", () => {
    const withEntry: DayFacts = {
      hasEntry: true,
      firstEntryAt: new Date("2026-01-01T00:00:00Z"),
      hasAbsence: true,
    };
    const withoutEntry: DayFacts = {
      hasEntry: false,
      firstEntryAt: null,
      hasAbsence: true,
    };
    const wellAfter = new Date("2029-06-01T06:00:00Z");
    for (const date of all) {
      if (isWeekday(civilDate(date))) continue;
      expect(classifyDay(civilDate(date), withEntry, wellAfter)).toBe("extra");
      expect(classifyDay(civilDate(date), withoutEntry, wellAfter)).toBe("none");
    }
  });

  // Asserting the exact status, not just "not extra and not none" — the
  // negative form would pass for six different statuses and so proves very
  // little. Every date in this sweep is a past weekday with nothing on
  // record and grace long closed, which is exactly "missed".
  it("a weekday with nothing recorded and grace closed is always missed", () => {
    const facts: DayFacts = { hasEntry: false, firstEntryAt: null, hasAbsence: false };
    const wellAfter = new Date("2029-06-01T06:00:00Z");
    for (const date of all) {
      if (!isWeekday(civilDate(date))) continue;
      expect(classifyDay(civilDate(date), facts, wellAfter)).toBe("missed");
    }
  });
});

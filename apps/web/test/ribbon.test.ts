import { describe, expect, it } from "vitest";
import { civilDate } from "@irp/core";
import { batchDayMark, studentDayMark, toBatchCalendarDays, toStudentCalendarDays } from "@/lib/ribbon";

const day = (over: Partial<Parameters<typeof batchDayMark>[0]> = {}) => ({
  enrolled: 10, submitted: 10, late: 0, absent: 0, missed: 0, pending: 0, ...over,
});

describe("studentDayMark", () => {
  it("maps each settled status onto its own mark", () => {
    expect(studentDayMark("onTime")).toBe("ok");
    expect(studentDayMark("late")).toBe("late");
    expect(studentDayMark("absent")).toBe("absent");
    expect(studentDayMark("missed")).toBe("missed");
  });

  it("draws pending as an outline, not a failure — the grace window is still open", () => {
    expect(studentDayMark("pending")).toBe("future");
  });

  it("draws future and none as outlines", () => {
    expect(studentDayMark("future")).toBe("future");
    expect(studentDayMark("none")).toBe("future");
  });

  it("never returns a mark for extra — weekend work is a slot, not a day bar (FR-33)", () => {
    // `extra` can only reach here through a caller that failed to filter
    // weekends out. An outline is the safe rendering: it claims nothing.
    expect(studentDayMark("extra")).toBe("future");
  });
});

describe("batchDayMark", () => {
  it("is ok only when everyone submitted and nobody was late", () => {
    expect(batchDayMark(day())).toEqual({ mark: "ok" });
  });

  it("ranks missed above late, late above absent, and absent above partial", () => {
    expect(batchDayMark(day({ submitted: 8, late: 1, absent: 1, missed: 1 })).mark).toBe("missed");
    expect(batchDayMark(day({ submitted: 9, late: 1, absent: 1 })).mark).toBe("late");
    expect(batchDayMark(day({ submitted: 9, absent: 1 })).mark).toBe("absent");
    expect(batchDayMark(day({ submitted: 6, pending: 4 })).mark).toBe("partial");
  });

  it("fills partial proportionally, and only partial", () => {
    expect(batchDayMark(day({ submitted: 6, pending: 4 }))).toEqual({ mark: "partial", fill: 0.6 });
    expect(batchDayMark(day({ submitted: 9, absent: 1 })).fill).toBeUndefined();
  });

  it("draws a day nobody has reached, and a day with nobody enrolled, as an outline", () => {
    expect(batchDayMark(day({ submitted: 0, pending: 0 }))).toEqual({ mark: "future" });
    expect(batchDayMark(day({ enrolled: 0, submitted: 0 }))).toEqual({ mark: "future" });
  });
});

describe("toBatchCalendarDays", () => {
  const bounds = { start: civilDate("2026-08-10"), end: civilDate("2026-09-09") };

  it("marks a weekday cell from the matching DayCompliance row", () => {
    const weeks = toBatchCalendarDays(
      bounds,
      [{ date: "2026-08-10", enrolled: 4, submitted: 4, late: 0, absent: 0, missed: 0, pending: 0 }],
      [],
      "2026-08-10",
    );
    const cell = weeks.flat().find((c) => c.date === "2026-08-10")!;
    expect(cell.kind).toBe("weekday");
    expect(cell.mark).toBe("ok");
    expect(cell.isToday).toBe(true);
  });

  it("marks BOTH weekend days of a flagged pair as extra (extraAfter cannot tell Saturday from Sunday)", () => {
    // 2026-08-14 is a Friday; extraAfter names it to flag the following weekend.
    const weeks = toBatchCalendarDays(bounds, [], ["2026-08-14"], "2026-08-10");
    const saturday = weeks.flat().find((c) => c.date === "2026-08-15")!;
    const sunday = weeks.flat().find((c) => c.date === "2026-08-16")!;
    expect(saturday.kind).toBe("weekend");
    expect(saturday.extra).toBe(true);
    expect(sunday.kind).toBe("weekend");
    expect(sunday.extra).toBe(true);
  });

  it("leaves an unflagged weekend as extra: false, distinct from adjacent-month padding", () => {
    const weeks = toBatchCalendarDays(bounds, [], [], "2026-08-10");
    const saturday = weeks.flat().find((c) => c.date === "2026-08-15")!;
    expect(saturday.inCycle).toBe(true);
    expect(saturday.kind).toBe("weekend");
    expect(saturday.extra).toBe(false);
  });

  it("adjacent-month padding carries no kind and is never today", () => {
    // bounds.start (2026-08-10) is itself a Monday, so week 0 has no leading
    // padding -- the trailing padding is on the LAST week instead, since
    // bounds.end (2026-09-09) is a Wednesday.
    const weeks = toBatchCalendarDays(bounds, [], [], "2026-08-10");
    const padding = weeks[weeks.length - 1]!.find((c) => !c.inCycle)!;
    expect(padding.kind).toBeUndefined();
    expect(padding.isToday).toBe(false);
  });
});

describe("toStudentCalendarDays", () => {
  const bounds = { start: civilDate("2026-08-10"), end: civilDate("2026-09-09") };

  it("marks a weekend cell extra or none independently per day", () => {
    const weeks = toStudentCalendarDays(
      bounds,
      [
        { date: "2026-08-15", status: "extra" },
        { date: "2026-08-16", status: "none" },
      ],
      "2026-08-10",
    );
    expect(weeks.flat().find((c) => c.date === "2026-08-15")!.extra).toBe(true);
    expect(weeks.flat().find((c) => c.date === "2026-08-16")!.extra).toBe(false);
  });

  it("marks a weekday cell via studentDayMark", () => {
    const weeks = toStudentCalendarDays(bounds, [{ date: "2026-08-11", status: "late" }], "2026-08-10");
    const cell = weeks.flat().find((c) => c.date === "2026-08-11")!;
    expect(cell.kind).toBe("weekday");
    expect(cell.mark).toBe("late");
  });
});

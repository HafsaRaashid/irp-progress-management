import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CycleCalendar } from "@/components/cycle-calendar/cycle-calendar";
import type { CalendarCell } from "@/lib/ribbon";

function week(cells: Partial<CalendarCell>[]): CalendarCell[] {
  return cells.map((c) => ({ date: "2026-08-10", isToday: false, inCycle: true, ...c }));
}

describe("CycleCalendar", () => {
  it("renders one cell per day across all weeks, including dimmed adjacent-month cells", () => {
    const weeks = [
      week([
        { date: "2026-08-03", inCycle: false },
        { date: "2026-08-04", inCycle: false },
        { date: "2026-08-05", inCycle: false },
        { date: "2026-08-06", inCycle: false },
        { date: "2026-08-07", inCycle: false },
        { date: "2026-08-08", inCycle: false },
        { date: "2026-08-09", inCycle: false },
      ]),
      week([
        { date: "2026-08-10", kind: "weekday", mark: "ok" },
        { date: "2026-08-11", kind: "weekday", mark: "ok" },
        { date: "2026-08-12", kind: "weekday", mark: "ok" },
        { date: "2026-08-13", kind: "weekday", mark: "ok" },
        { date: "2026-08-14", kind: "weekday", mark: "ok" },
        { date: "2026-08-15", kind: "weekend", extra: false },
        { date: "2026-08-16", kind: "weekend", extra: false },
      ]),
    ];
    render(<CycleCalendar weeks={weeks} />);
    expect(screen.getAllByRole("gridcell")).toHaveLength(14);
  });

  it("gives a weekday cell both a compliance mark and a grace-cutoff accessible label", () => {
    const weeks = [week([{ date: "2026-08-10", kind: "weekday", mark: "late" }])];
    render(<CycleCalendar weeks={weeks} />);
    const cell = screen.getByRole("gridcell", { name: /late/i });
    expect(cell.getAttribute("aria-label")).toMatch(/until/i);
  });

  it("gives a weekend cell no grace-cutoff wording", () => {
    const weeks = [week([{ date: "2026-08-15", kind: "weekend", extra: true }])];
    render(<CycleCalendar weeks={weeks} />);
    const cell = screen.getByRole("gridcell", { name: /extra/i });
    expect(cell.getAttribute("aria-label")).not.toMatch(/until/i);
  });

  it("marks the today cell distinctly from an ordinary cell of the same status", () => {
    const weeks = [week([{ date: "2026-08-10", kind: "weekday", mark: "ok", isToday: true }])];
    render(<CycleCalendar weeks={weeks} />);
    expect(screen.getByRole("gridcell", { name: /today/i })).toBeInTheDocument();
  });
});

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

  it("labels the grid's seven columns Monday-first (whole-branch review finding I-2)", () => {
    const weeks = [week([{ date: "2026-08-10", kind: "weekday", mark: "ok" }])];
    render(<CycleCalendar weeks={weeks} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    ]);
  });

  it("shows a dimmed day number on adjacent-month padding, not an empty cell (whole-branch review finding I-2)", () => {
    const weeks = [week([{ date: "2026-08-03", inCycle: false }])];
    render(<CycleCalendar weeks={weeks} />);
    const padding = screen.getByRole("gridcell", { name: /outside this cycle/i });
    expect(padding).toHaveTextContent("3");
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

  it("remounts the grid when a mark changes, so the mount-only rise animation replays (whole-branch review finding I-5)", () => {
    const weeks = [week([{ date: "2026-08-10", kind: "weekday", mark: "future" }])];
    const { rerender } = render(<CycleCalendar weeks={weeks} />);
    const before = screen.getByRole("gridcell", { name: /future/i });

    rerender(<CycleCalendar weeks={[week([{ date: "2026-08-10", kind: "weekday", mark: "ok" }])]} />);

    const after = screen.getByRole("gridcell", { name: /ok/i });
    expect(after).not.toBe(before);
  });

  it("does not remount the grid on a re-render with unchanged marks", () => {
    const weeks = [week([{ date: "2026-08-10", kind: "weekday", mark: "ok" }])];
    const { rerender } = render(<CycleCalendar weeks={weeks} />);
    const before = screen.getByRole("gridcell", { name: /ok/i });

    rerender(<CycleCalendar weeks={weeks} label="unrelated update" />);

    const after = screen.getByRole("gridcell", { name: /ok/i });
    expect(after).toBe(before);
  });
});

import { civilDate, graceDeadlineFor } from "@irp/core";
import { MARK_COLOR } from "@/components/cycle-ribbon/cycle-ribbon";
import type { CalendarCell } from "@/lib/ribbon";

const DEADLINE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function dayOfMonth(iso: string): string {
  return iso.slice(8, 10);
}

function cellLabel(cell: CalendarCell): string {
  if (!cell.inCycle) return `${cell.date}: outside this cycle`;
  const todaySuffix = cell.isToday ? ", today" : "";
  if (cell.kind === "weekend") {
    return `${cell.date}: ${cell.extra === true ? "extra" : "no work recorded"}${todaySuffix}`;
  }
  const cutoff = graceDeadlineFor(civilDate(cell.date));
  return `${cell.date}: ${cell.mark}${todaySuffix}, submit until ${DEADLINE_FORMAT.format(cutoff)}`;
}

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Cell({ cell }: { cell: CalendarCell }) {
  if (!cell.inCycle) {
    // Dimmed, not empty: design-system.md §7's mock and ADR-0030 both call
    // for the adjacent-month day number to still be visible, just
    // de-emphasised -- an empty cell reads as a rendering fault, not as
    // "this date belongs to another month" (whole-branch review finding
    // I-2).
    return (
      <div role="gridcell" aria-label={cellLabel(cell)} className="flex h-11 items-start justify-start p-1">
        <span className="tabular text-[10px]" style={{ color: "var(--ink-muted)", opacity: 0.5 }}>
          {dayOfMonth(cell.date)}
        </span>
      </div>
    );
  }

  if (cell.kind === "weekend") {
    return (
      <div
        role="gridcell"
        aria-label={cellLabel(cell)}
        className="relative flex h-11 flex-col items-center justify-center gap-1 rounded-[2px] border"
        style={{
          borderColor: "var(--line)",
          outline: cell.isToday ? "1.5px solid var(--primary)" : undefined,
          outlineOffset: cell.isToday ? "2px" : undefined,
        }}
      >
        {cell.extra === true && (
          <span aria-hidden="true" className="text-[10px]" style={{ color: "var(--ink-muted)" }}>
            +
          </span>
        )}
        <span className="tabular text-[10px]" style={{ color: "var(--ink-muted)" }}>
          {dayOfMonth(cell.date)}
        </span>
      </div>
    );
  }

  const mark = cell.mark ?? "future";
  const heightPct = mark === "partial" ? Math.round((cell.fill ?? 0) * 100) : 100;
  const background = mark === "future" ? "transparent" : MARK_COLOR[mark];

  return (
    <div
      role="gridcell"
      aria-label={cellLabel(cell)}
      className="relative flex h-11 flex-col items-stretch justify-end gap-1 rounded-[2px] border"
      style={{
        borderColor: "var(--line)",
        outline: cell.isToday ? "1.5px solid var(--primary)" : undefined,
        outlineOffset: cell.isToday ? "2px" : undefined,
      }}
    >
      <span
        className="ribbon-mark block w-full rounded-[2px]"
        style={{ height: `${String(heightPct)}%`, background }}
      />
      <span className="tabular absolute bottom-0.5 left-1 text-[10px]" style={{ color: "var(--ink-muted)" }}>
        {dayOfMonth(cell.date)}
      </span>
    </div>
  );
}

export interface CycleCalendarProps {
  weeks: CalendarCell[][];
  label?: string;
  caption?: string;
}

/**
 * The signature element replacing CycleRibbon (ADR-0030, O-17). A standard
 * 7-column week grid, one row per week the cycle spans (design spec §3).
 */
export function CycleCalendar({ weeks, label, caption }: CycleCalendarProps) {
  return (
    <figure
      className="rounded-[var(--radius-panel)] border p-6"
      style={{ background: "var(--surface)", borderColor: "var(--line)" }}
    >
      {label !== undefined && (
        <figcaption
          className="tabular mb-3 text-xs uppercase tracking-[0.08em]"
          style={{ color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}
        >
          {label}
        </figcaption>
      )}
      {/*
        Keyed on every cell's drawn state so a submission landing (a mark
        flipping, e.g. future -> ok) remounts the grid and replays the
        .ribbon-mark rise animation, the same technique CycleRibbon uses
        (design-system.md §10, "the one delight moment in the system") --
        React reconciles same-keyed DOM in place and a mount-only CSS
        animation never replays on props alone.
      */}
      <div
        role="grid"
        aria-label="Cycle calendar"
        className="flex flex-col gap-1"
        key={weeks.flat().map((c) => `${c.mark ?? ""}${c.extra === true ? "x" : ""}`).join("")}
      >
        {/* Spec §4: "row/column headers for weeks and weekdays". Monday-first per the
            implementation plan's audit finding 4. */}
        <div role="row" className="grid grid-cols-7 gap-1">
          {WEEKDAY_HEADERS.map((day) => (
            <div
              key={day}
              role="columnheader"
              className="tabular text-center text-[10px] uppercase"
              style={{ color: "var(--ink-muted)" }}
            >
              {day}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          // A week has no stable id of its own; its first cell's date is unique across the whole grid and never reorders.
          <div key={week[0]?.date} role="row" className="grid grid-cols-7 gap-1">
            {week.map((cell) => (
              <Cell key={cell.date} cell={cell} />
            ))}
          </div>
        ))}
      </div>
      {caption !== undefined && (
        <p className="tabular mt-3 text-xs" style={{ color: "var(--ink-muted)" }}>
          {caption}
        </p>
      )}
    </figure>
  );
}

import { civilDate, graceDeadlineFor } from "@irp/core";
import type { CalendarCell } from "@/lib/ribbon";

// docs/design-system.md §7 (replaced by this component, O-17): same four-
// colour ramp the ribbon used. "extra" is --ink-muted, distinguished by
// glyph, not colour, same reasoning as the ribbon's ExtraSlot.
const MARK_COLOR: Record<Exclude<NonNullable<CalendarCell["mark"]>, "future">, string> = {
  ok: "var(--st-ok)",
  partial: "var(--st-ok)",
  late: "var(--st-late)",
  absent: "var(--st-absent)",
  missed: "var(--st-missed)",
};

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

function Cell({ cell }: { cell: CalendarCell }) {
  if (!cell.inCycle) {
    return (
      <div
        role="gridcell"
        aria-label={cellLabel(cell)}
        className="h-11 rounded-[2px]"
        style={{ background: "transparent" }}
      />
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
      <div role="grid" aria-label="Cycle calendar" className="flex flex-col gap-1">
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

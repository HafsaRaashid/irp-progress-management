# Cycle Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `CycleRibbon` with a month-grid `CycleCalendar` at its two live call sites (mentor's Today, student's Today), per O-17.

**Architecture:** A new pure date-math module computes the week-padded grid for a cycle; new
transform functions (`toBatchCalendarDays`/`toStudentCalendarDays`, replacing
`toBatchRibbonDays`/`toStudentRibbonDays` in `apps/web/lib/ribbon.ts`) turn the existing API
aggregates into that grid's cells; a new `CycleCalendar` component renders it. `CycleRibbon` itself
is left in place, unimported, as the revert path the spec's §10 risk table asks for. The mentor's
Today page is restructured from "one ribbon stacked per batch" to "one calendar, one batch selected
via chips" (D3), which needs `searchParams` threading from the root page down, the same pattern
`apps/web/app/(app)/cycles/page.tsx` already uses.

**Tech Stack:** Next.js 16 Server Components, `@irp/core` (`civilDate`, `addDays`, `dayOfWeek`,
`compareDates`, `cycleContaining`, `graceDeadlineFor`), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-cycle-calendar-design.md`

## Global Constraints

- **No new API endpoint.** Every data point the calendar renders already exists in
  `getBatchDashboardToday` / `getMyDashboard` (weekday aggregates) or `listMyDays` (full calendar
  range, per-day). This plan does not touch `spec/openapi.yaml`.
- **This maps to no FR** (spec §2). The calendar's entry points (`CycleCalendar`,
  `MentorToday`'s batch-selection, the widened `listMyDays` call in `StudentToday`) are marked
  `// ASSUMPTION: O-17`.
- **`CycleRibbon` and its five-state `DayMark` vocabulary are not touched or deleted.** The
  low-level classifiers `batchDayMark`/`studentDayMark` in `apps/web/lib/ribbon.ts` are unchanged —
  only the two functions that shape their output for a specific widget are renamed and rebuilt.
- **Weekend cells carry a separate, smaller vocabulary than weekday cells**, not an extension of
  `DayMark` (see the audit finding below — required-day and weekend classification are genuinely
  different shapes, not the same five/six states with one more added).
- **Desktop only, 1280px minimum, no scrolling for the FR-28 zone** (NFR-13). §7 of the spec makes
  this an explicit go/no-go gate — Task 8 below is that gate, not a cosmetic pass.
- **Colour is never the sole carrier** (`docs/design-system.md` §12) — every cell's accessible name
  states its status as text.
- **`apps/web` changes require `pnpm --filter @irp/web build` (with `AUTH_DEV_BYPASS=false`), not
  just `pnpm typecheck`**, per `CLAUDE.md`'s recorded `next build`-vs-`tsc` trap. Every task below
  that touches `apps/web` must be verified against a real build before being called done, and the
  branch's own final task must confirm typecheck was run **after**, not before, that build (the
  `.next/dev/types` vs `.next/types` staleness trap).

## Audit findings (read before Task 1)

1. **The spec's third call site does not exist and is dropped from this plan, by your decision.**
   `apps/web/app/(app)/my-month/page.tsx` carries no `CycleRibbon` today — it was moved to
   `student-today.tsx` in the §8.2 restructure, and `my-month`'s own comments say so explicitly
   ("the ribbon...moved to the student's home"). There is also no existing cycle-picker for a
   student's own dashboard: `getMyDashboard` takes no query parameters at all (only
   `getBatchDashboardSummary`, the **mentor's** Cycles page, is cycle-addressable). This plan ships
   `CycleCalendar` at exactly two call sites — `mentor-today.tsx` and `student-today.tsx` — and
   corrects the spec's §3 call-site list in Task 7 rather than silently building the (larger, new)
   past-cycle-browsing feature the original wording implied. **Consequence for D5:** the spec's
   "cycle-based navigation, chip-style" decision was about browsing away from the current cycle —
   the one thing only the dropped my-month call site needed. Neither remaining call site
   (mentor-today, student-today) ever showed anything but the current cycle even with the old
   ribbon, so D5 has no code to implement here; it is moot for this plan's actual scope, not
   silently skipped.
2. **`extraAfter` cannot tell Saturday and Sunday apart.** Both `StudentDashboard.extraAfter` and
   `BatchDashboardToday.extraAfter` are arrays of the **Friday's** date, one entry per weekend that
   had *any* extra work — not the actual Saturday/Sunday date(s) worked. The ribbon could get away
   with this because it renders one combined `+` slot per weekend; a grid renders Saturday and
   Sunday as two separate cells and cannot distinguish which one (or both) were worked from this
   field alone. **Deliberate scope decision, not a bug to fix here:** both cells of a flagged
   weekend render the same `extra` mark. Documented at the point it matters in Task 3; do not
   "improve" this by inferring which day from entry timestamps — that data is not in the aggregate
   this plan is scoped to use, and inventing a heuristic would silently misrepresent a real record.
3. **The student side has genuinely richer data available than the spec assumed.**
   `StudentDashboard.days` (`StudentDay[]`) is required-days-only, exactly like the batch side. But
   `listMyDays` (`DaySummary[]`, already called by both `student-today.tsx` and `my-month`) returns
   one row **per calendar date** across an arbitrary range, including weekends, with a real
   `DayStatus` (`onTime`/`late`/`absent`/`missed`/`pending`/`extra`/`none`/`future`) per row — this
   is the same endpoint `my-month` already relies on for its full-cycle history. Task 5 widens
   `StudentToday`'s existing `listMyDays` call from the open-submission-window range to the whole
   cycle and uses it (not `StudentDashboard.days`) as `CycleCalendar`'s weekend data source, giving
   students real independent Saturday/Sunday marks the mentor view cannot have. This is a real
   asymmetry between the two views — call it out in review, not just in this document.
4. **Week start.** Neither the spec nor `docs/design-system.md` states a start-of-week convention.
   This plan uses **Monday-first** (weekdays contiguous, weekend at the row's end), matching how a
   working week already reads everywhere else in this app (roster, ribbon left-to-right). Recorded
   here as a plan-level design decision — it is cosmetic and touches no FR, so it does not need its
   own open point.

## Review Focus

- **A cycle that starts or ends mid-week** — the grid's first/last row must show correctly dimmed
  adjacent-month days on both ends, not just the end the ribbon never had to think about (the
  ribbon was a linear strip with no row boundary).
- **A weekend that is genuinely quiet** (no extra work either side) must render distinctly from a
  weekend that is dimmed adjacent-month padding — both are "no compliance mark," but one is inside
  the viewed cycle and one is not; collapsing them would misreport which dates belong to the cycle.
- **A batch with only one enrolled student who has since transferred out mid-cycle** — the
  mentor's calendar must still render the full grid (dimmed pre-enrolment cells), not error or
  blank, since `batchDayMark`'s `enrolled === 0` branch already returns `future` and the grid must
  carry that through per cell, not just per ribbon-bar.
- **The batch selector's default when `batchId` is absent or names a batch the mentor doesn't
  have** — must default to the first batch by `listBatches`' own order (already alphabetical/
  start-date order per existing code), matching the Cycles page's exact fallback rather than a new
  rule.
- **A weekend cell's accessible name when `extra` is true but the day is also `isToday`** — the
  existing ribbon's `isToday` ring is a decoration drawn over a mark; a weekend cell needs the same
  "ring is orthogonal to state" treatment tested explicitly, since weekends are a new case that
  never coexisted with `isToday` in the ribbon (which omitted weekends entirely).

---

### Task 1: ADR-0030, superseding ADR-0003

**Files:**
- Create: `docs/adr/0030-month-grid-calendar-over-cycle-ribbon.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Write the ADR**

```markdown
# ADR-0030: Month-grid calendar over the cycle ribbon for the FR-28/29 summary surface

## Status
Accepted. Supersedes [ADR-0003](0003-cycle-ribbon-as-fr-28-summary.md).

## Context
`docs/superpowers/specs/2026-09-15-cycle-calendar-design.md` (§1, §9) replaces the cycle ribbon
with a month-grid calendar at the mentor's and student's Today pages. This maps to no FR — logged
as **O-17** (`docs/interview-and-prd.md` §5) — the same escalation path O-14 (the theme switch)
used.

## Decision
Render the FR-28/29 zone as a standard 7-column week grid over the current cycle, one row per
week the cycle touches, with leading/trailing adjacent-month days shown dimmed. Weekend cells
render (unlike the ribbon's total omission) marked `extra` or blank. The mentor's view shows one
calendar for a selected batch, with chip-style batch selection, rather than one ribbon per batch.

## Rejected alternatives
1. **Keep the ribbon alongside the new calendar.** Two components doing the same job — showing a
   cycle's per-day state — is the exact duplication ADR-0003 itself warned against for a different
   pattern.
2. **One calendar stacked per batch on the mentor's home.** A month-grid is 5-6 rows tall where the
   ribbon was one row; stacking two all but guarantees an NFR-13 (no-scroll) violation at the
   1280px minimum, the width/height budget ADR-0003's own analysis was protecting.
3. **Calendar-month navigation (previous/next month), matching the ELMS reference this request was
   inspired by.** IRP's unit is the 10th-to-9th cycle, not the calendar month; introducing a
   second, month-based navigation idiom next to the app's existing cycle-based one (the Cycles
   page) is an inconsistency with no functional benefit.

## Consequences
Positive: keeps the "live assertion on the date engine" property ADR-0003 valued — a grid renders
every calendar day, so a boundary bug is visible on the landing screen. Negative: new accessibility
work (grid/row/column semantics have no ribbon precedent); weekend cells reopen ADR-0003 Amendment
1's reasoning about "extra work" visibility (deliberate, not a regression — a grid cannot omit
calendar days the way a linear strip can).

## Revisit when
O-17 comes back "no" — revert by restoring the three call sites to `CycleRibbon`, which this
design leaves in place unimported for exactly this reason.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0030-month-grid-calendar-over-cycle-ribbon.md
git commit -m "docs(adr): add ADR-0030, month-grid calendar over the cycle ribbon (O-17)"
```

---

### Task 2: Week-grid date math

**Files:**
- Create: `apps/web/lib/calendar-grid.ts`
- Test: `apps/web/test/calendar-grid.test.ts`

**Interfaces:**
- Consumes: `CivilDate`, `addDays`, `compareDates`, `dayOfWeek` from `@irp/core`; `CycleBounds`
  (`{ start: CivilDate; end: CivilDate }`) — the shape `cycleContaining` already returns.
- Produces: `type GridCell = { date: string; inCycle: boolean }` and
  `function weeksForCycle(bounds: CycleBounds): GridCell[][]` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/test/calendar-grid.test.ts
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
    const weeks = weeksForCycle({ start: civilDate("2026-07-10"), end: civilDate("2026-08-09") });
    // 2026-08-09 is a Sunday, so the cycle's own last day already ends its row --
    // assert on a cycle whose end is NOT a Sunday instead.
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @irp/web test calendar-grid -- --run`
Expected: FAIL with "Cannot find module '@/lib/calendar-grid'" (or similar — the module does not exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/lib/calendar-grid.ts
import { addDays, compareDates, dayOfWeek, type CivilDate, type CycleBounds } from "@irp/core";

/** One calendar-day cell before it is given compliance data. */
export interface GridCell {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** False for a leading/trailing adjacent-month day shown dimmed for row structure only. */
  inCycle: boolean;
}

/** Monday-first offset: dayOfWeek is 0 Sunday..6 Saturday; Monday becomes 0, Sunday becomes 6. */
function mondayFirstOffset(date: CivilDate): number {
  return (dayOfWeek(date) + 6) % 7;
}

/**
 * The full Monday-to-Sunday week grid a cycle's calendar view needs:
 * every week the cycle touches, including dimmed leading/trailing days from
 * the adjacent months so every row has exactly 7 cells (design spec §3).
 */
export function weeksForCycle(bounds: CycleBounds): GridCell[][] {
  const gridStart = addDays(bounds.start, -mondayFirstOffset(bounds.start));
  const gridEnd = addDays(bounds.end, 6 - mondayFirstOffset(bounds.end));

  const cells: GridCell[] = [];
  for (let d = gridStart; compareDates(d, gridEnd) <= 0; d = addDays(d, 1)) {
    cells.push({
      date: d,
      inCycle: compareDates(d, bounds.start) >= 0 && compareDates(d, bounds.end) <= 0,
    });
  }

  const weeks: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @irp/web test calendar-grid -- --run`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/calendar-grid.ts apps/web/test/calendar-grid.test.ts
git commit -m "feat(web): add week-grid date math for the cycle calendar (O-17)"
```

---

### Task 3: Calendar day transforms, replacing the ribbon transforms

**Files:**
- Modify: `apps/web/lib/ribbon.ts` (remove `toStudentRibbonDays`/`toBatchRibbonDays`, add the two
  functions below; `studentDayMark`/`batchDayMark` are unchanged)
- Test: `apps/web/test/ribbon.test.ts` (remove the two obsolete describe blocks; add new ones —
  same file, since it already covers `batchDayMark`/`studentDayMark`, which this task's new
  functions call)

**Interfaces:**
- Consumes: `weeksForCycle` (Task 2); `batchDayMark`/`studentDayMark` (unchanged, this file);
  `DayComplianceLike` (unchanged, this file).
- Produces: the types and functions `CycleCalendar` (Task 4) renders —

```typescript
export type WeekdayCellMark = "ok" | "partial" | "late" | "absent" | "missed" | "future";

export interface CalendarCell {
  date: string;
  isToday: boolean;
  /** False for adjacent-month padding — carries no compliance data, never interactive. */
  inCycle: boolean;
  /** Undefined for adjacent-month padding. */
  kind?: "weekday" | "weekend";
  /** Only when kind === "weekday". */
  mark?: WeekdayCellMark;
  /** Only when kind === "weekday" && mark === "partial", 0..1. */
  fill?: number;
  /** Only when kind === "weekend" — see the audit finding above on why this can't be per-day. */
  extra?: boolean;
}

export function toBatchCalendarDays(
  bounds: CycleBounds,
  days: DayComplianceLike[],
  extraAfter: string[],
  today: string,
): CalendarCell[][];

export function toStudentCalendarDays(
  bounds: CycleBounds,
  days: { date: string; status: DayStatus }[],
  today: string,
): CalendarCell[][];
```

Note the asymmetry from audit finding 3: the batch transform takes `extraAfter` (Friday-anchored)
because that is all `DayCompliance` gives it; the student transform does not need it because
`listMyDays`' per-date `status` already resolves to `"extra"`/`"none"` directly for a weekend row.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/test/ribbon.test.ts` (keep the existing `batchDayMark`/`studentDayMark` describe
blocks; replace the `toBatchRibbonDays`/`toStudentRibbonDays` ones):

```typescript
import { civilDate } from "@irp/core";
import { toBatchCalendarDays, toStudentCalendarDays } from "@/lib/ribbon";

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

  it("marks BOTH weekend days of a flagged pair as extra (audit finding 2 -- extraAfter cannot tell Saturday from Sunday)", () => {
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
    const weeks = toBatchCalendarDays(bounds, [], [], "2026-08-10");
    const padding = weeks[0]!.find((c) => !c.inCycle)!;
    expect(padding.kind).toBeUndefined();
    expect(padding.isToday).toBe(false);
  });
});

describe("toStudentCalendarDays", () => {
  const bounds = { start: civilDate("2026-08-10"), end: civilDate("2026-09-09") };

  it("marks a weekend cell extra or none independently per day (audit finding 3)", () => {
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @irp/web test ribbon -- --run`
Expected: FAIL — `toBatchCalendarDays`/`toStudentCalendarDays` are not exported yet.

- [ ] **Step 3: Remove the obsolete ribbon-day tests and implementation**

Delete the `toBatchRibbonDays`/`toStudentRibbonDays` describe blocks from
`apps/web/test/ribbon.test.ts` and their two functions from `apps/web/lib/ribbon.ts` (lines 69-86 —
`studentDayMark` and `batchDayMark` above them are untouched).

- [ ] **Step 4: Implement the new transforms**

```typescript
// apps/web/lib/ribbon.ts -- append, replacing the deleted toBatchRibbonDays/toStudentRibbonDays
import { weeksForCycle, type GridCell } from "./calendar-grid";
import type { CycleBounds } from "@irp/core";

export type WeekdayCellMark = "ok" | "partial" | "late" | "absent" | "missed" | "future";

export interface CalendarCell {
  date: string;
  isToday: boolean;
  inCycle: boolean;
  kind?: "weekday" | "weekend";
  mark?: WeekdayCellMark;
  fill?: number;
  extra?: boolean;
}

function isWeekendDate(date: string): boolean {
  // A grid cell's date is always Asia/Colombo-agnostic ISO -- this mirrors
  // isWeekday's own UTC-midnight parsing (@irp/core), not a new rule.
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function baseCell(cell: GridCell, today: string): Pick<CalendarCell, "date" | "isToday" | "inCycle"> {
  return { date: cell.date, isToday: cell.inCycle && cell.date === today, inCycle: cell.inCycle };
}

export function toBatchCalendarDays(
  bounds: CycleBounds,
  days: DayComplianceLike[],
  extraAfter: string[],
  today: string,
): CalendarCell[][] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const extraWeekends = new Set(extraAfter.map((friday) => addDays(civilDate(friday), 1)).concat(
    extraAfter.map((friday) => addDays(civilDate(friday), 2)),
  ));

  return weeksForCycle(bounds).map((week) =>
    week.map((cell): CalendarCell => {
      const base = baseCell(cell, today);
      if (!cell.inCycle) return base;
      if (isWeekendDate(cell.date)) {
        return { ...base, kind: "weekend", extra: extraWeekends.has(cell.date) };
      }
      const day = byDate.get(cell.date);
      const { mark, fill } = day === undefined ? { mark: "future" as const, fill: undefined } : batchDayMark(day);
      return { ...base, kind: "weekday", mark, ...(fill !== undefined && { fill }) };
    }),
  );
}

export function toStudentCalendarDays(
  bounds: CycleBounds,
  days: { date: string; status: DayStatus }[],
  today: string,
): CalendarCell[][] {
  const byDate = new Map(days.map((d) => [d.date, d.status]));

  return weeksForCycle(bounds).map((week) =>
    week.map((cell): CalendarCell => {
      const base = baseCell(cell, today);
      if (!cell.inCycle) return base;
      const status = byDate.get(cell.date) ?? "future";
      if (isWeekendDate(cell.date)) {
        return { ...base, kind: "weekend", extra: status === "extra" };
      }
      return { ...base, kind: "weekday", mark: studentDayMark(status) };
    }),
  );
}
```

Add `civilDate`, `addDays` to this file's existing `@irp/core` import.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @irp/web test ribbon -- --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/ribbon.ts apps/web/test/ribbon.test.ts
git commit -m "feat(web): replace ribbon-day transforms with calendar-day transforms (O-17)"
```

---

### Task 4: The `CycleCalendar` component

**Files:**
- Create: `apps/web/components/cycle-calendar/cycle-calendar.tsx`
- Test: `apps/web/test/cycle-calendar.test.tsx`

**Interfaces:**
- Consumes: `CalendarCell[][]` (Task 3), `graceDeadlineFor` from `@irp/core`.
- Produces: `CycleCalendar({ weeks, label, caption }: CycleCalendarProps)` — the component Tasks 5
  and 6 import.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/test/cycle-calendar.test.tsx
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
      week([{ date: "2026-08-10", kind: "weekday", mark: "ok" }]),
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @irp/web test cycle-calendar -- --run`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

```typescript
// apps/web/components/cycle-calendar/cycle-calendar.tsx
import { civilDate, graceDeadlineFor } from "@irp/core";
import type { CalendarCell } from "@/lib/ribbon";

// docs/design-system.md §7 (replaced by this component, Task 7): same four-
// colour ramp the ribbon used. "extra" is --ink-muted, distinguished by
// glyph, not colour, same reasoning as the ribbon's ExtraSlot.
const MARK_COLOR: Record<Exclude<CalendarCell["mark"], undefined | "future">, string> = {
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

  const heightPct = cell.mark === "partial" ? Math.round((cell.fill ?? 0) * 100) : 100;
  const background = cell.mark === "future" || cell.mark === undefined ? "transparent" : MARK_COLOR[cell.mark];

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
        {weeks.map((week, i) => (
          // eslint-disable-next-line react/no-array-index-key -- a week has no stable id of its own; index is fine, the row never reorders.
          <div key={i} role="row" className="grid grid-cols-7 gap-1">
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @irp/web test cycle-calendar -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/cycle-calendar/ apps/web/test/cycle-calendar.test.tsx
git commit -m "feat(web): add the CycleCalendar component (O-17)"
```

---

### Task 5: Wire into the student's Today page

**Files:**
- Modify: `apps/web/app/(app)/student-today.tsx`
- Modify: `apps/web/test/today-page.test.tsx`
- Modify: `apps/web/e2e/dashboard-flows.spec.ts` (selector update only — see Step 4)

**Interfaces:**
- Consumes: `CycleCalendar` (Task 4), `toStudentCalendarDays` (Task 3), `cycleContaining` from
  `@irp/core`.

- [ ] **Step 1: Widen the `listMyDays` query to the whole cycle, not just the open window**

`StudentToday` currently queries `listMyDays` over `openWindow.targetDates`' range (the
still-submittable window) — too narrow for a full-cycle grid (audit finding 3). Replace the
`openWindow`-derived `query` with the current cycle's own bounds:

```typescript
// Replace the existing `const query = ...` block with:
const currentCycle = cycleContaining(toProgrammeDate(new Date()));
const query = { from: currentCycle.start, to: currentCycle.end };
```

This makes `data` (from `listMyDays`) cover the whole cycle. The existing "Recent days" section
below still reads from `byDate`/`openWindow.targetDates` exactly as before — nothing there changes,
since `byDate` is a superset of what it held before.

Add `cycleContaining` to the existing `@irp/core` import.

- [ ] **Step 2: Replace the `CycleRibbon` import and render with `CycleCalendar`**

```typescript
// Remove:
import { CycleRibbon } from "@/components/cycle-ribbon/cycle-ribbon";
import { toStudentRibbonDays } from "@/lib/ribbon";
// Add:
import { CycleCalendar } from "@/components/cycle-calendar/cycle-calendar";
import { toStudentCalendarDays } from "@/lib/ribbon";
```

```typescript
// Replace the CycleRibbon block with:
<CycleCalendar
  weeks={toStudentCalendarDays(
    currentCycle,
    (data ?? []).map((d) => ({ date: d.date, status: d.status })),
    dashboard.today,
  )}
  label={cycleHeading(dashboard)}
/>
```

`// ASSUMPTION: O-17` — add this comment directly above the `<CycleCalendar` JSX, per Global
Constraints.

- [ ] **Step 3: Update the existing unit test**

`apps/web/test/today-page.test.tsx` asserts against `CycleRibbon`'s rendered marks (via
`data-testid="ribbon-bar"` or similar — check the current assertions before editing). Update those
assertions to query `role="gridcell"` names instead, keeping the same underlying scenarios (an
on-time day, a late day, an absent day) — do not delete coverage, retarget it.

- [ ] **Step 4: Update the e2e selectors**

`apps/web/e2e/dashboard-flows.spec.ts` targets `CycleRibbon`'s DOM for its "today's N-of-M, late/
absent counts still visible" assertions (spec §6). Read the file first to find the exact current
selectors, then retarget them to `CycleCalendar`'s `role="gridcell"` semantics — the user-facing
guarantee being tested (the figures are visible without scrolling) does not change, only the
selector does.

- [ ] **Step 5: Run typecheck, unit tests, and a real build**

Run: `pnpm --filter @irp/web typecheck && pnpm --filter @irp/web test today-page -- --run && AUTH_DEV_BYPASS=false pnpm --filter @irp/web build`
Expected: all three pass/succeed. Per the Global Constraints note, re-run `pnpm --filter @irp/web typecheck` **after** the build succeeds and confirm it is still clean (the `.next/types` vs `.next/dev/types` trap).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(app\)/student-today.tsx apps/web/test/today-page.test.tsx apps/web/e2e/dashboard-flows.spec.ts
git commit -m "feat(web): replace CycleRibbon with CycleCalendar on the student's Today page (O-17)"
```

---

### Task 6: Wire into the mentor's Today page (batch selector, D3)

**Files:**
- Modify: `apps/web/app/(app)/page.tsx` (thread `searchParams`)
- Modify: `apps/web/app/(app)/mentor-today.tsx` (restructure: one selected batch, not one-per-batch)
- Modify: `apps/web/test/mentor-today.test.tsx`
- Modify: `apps/web/e2e/dashboard-flows.spec.ts` (mentor-side selectors + a batch-switch case)

**Interfaces:**
- Consumes: `CycleCalendar` (Task 4), `toBatchCalendarDays` (Task 3), `cycleContaining` from
  `@irp/core`.
- Produces: `MentorToday` now takes an optional `batchId` prop (mirrors `CyclesPage`'s own
  `searchParams` pattern).

- [ ] **Step 1: Thread `searchParams` through the root page**

```typescript
// apps/web/app/(app)/page.tsx
import { getCurrentUserOrRedirect } from "@/lib/api-client";
import { StudentToday } from "./student-today";
import { MentorToday } from "./mentor-today";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ batchId?: string }>;
}) {
  const user = await getCurrentUserOrRedirect();
  if (user.role === "Student") {
    return <StudentToday displayName={user.displayName} role={user.role} />;
  }
  const { batchId } = await searchParams;
  return <MentorToday displayName={user.displayName} role={user.role} batchId={batchId} />;
}
```

- [ ] **Step 2: Restructure `MentorToday` to select one batch with chips**

Replace the `dashboards.map(...)` stacking with a single selected batch, following
`cycles/page.tsx`'s exact chip pattern (`Link` + `aria-current` + `className="chip"`):

```typescript
// apps/web/app/(app)/mentor-today.tsx
import { listBatches, getBatchDashboardToday, type Role } from "@irp/client";
import { cycleContaining, toProgrammeDate } from "@irp/core";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { CycleCalendar } from "@/components/cycle-calendar/cycle-calendar";
import { toBatchCalendarDays } from "@/lib/ribbon";
import { PageTitle } from "@/components/ui/page-title";
import { Panel } from "@/components/ui/panel";
import { SectionLabel } from "@/components/ui/section-label";
import { CountsRow } from "@/components/ui/counts-row";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCivilDateLabel } from "./format-civil-date";

export async function MentorToday({
  displayName,
  role,
  batchId,
}: {
  displayName: string;
  role: Role;
  batchId?: string;
}) {
  const client = await apiClient();
  const { data: batches, error: batchesError } = await listBatches({ client });

  const identity = (
    <>
      <span className="sr-only" data-testid="user-name">{displayName}</span>
      <span className="sr-only" data-testid="user-role">{role}</span>
    </>
  );

  if (batchesError !== undefined) {
    return (
      <div>
        <PageTitle>Today</PageTitle>
        {identity}
        <Panel>
          <p role="alert" style={{ color: "var(--st-missed)" }}>
            {batchesError.detail ?? batchesError.title}
          </p>
        </Panel>
      </div>
    );
  }

  if (batches === undefined || batches.length === 0) {
    return (
      <div>
        <PageTitle>Today</PageTitle>
        {identity}
        <Panel>
          <EmptyState title="No batches yet." hint="Create one from the Students page." />
        </Panel>
      </div>
    );
  }

  // Same fallback the Cycles page uses: the named batch if it exists, else
  // the first by listBatches' own order -- never an empty selection.
  const selected = batches.find((b) => b.id === batchId) ?? batches[0]!;
  const { data: d, error } = await getBatchDashboardToday({ client, path: { id: selected.id } });

  const label =
    d !== undefined && d.cycle.seq === null
      ? `${selected.name} · first evaluated cycle opens ${formatCivilDateLabel(d.cycle.startDate)}`
      : d !== undefined
        ? `${selected.name} · Cycle ${String(d.cycle.seq)} · Day ${String(d.dayNumber)} of ${String(d.cycle.requiredDayCount)}`
        : selected.name;

  return (
    <div>
      <PageTitle>Today</PageTitle>
      {identity}

      {batches.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {batches.map((b) => (
            <Link
              key={b.id}
              href={{ pathname: "/", query: { batchId: b.id } }}
              aria-current={b.id === selected.id ? "page" : undefined}
              className="chip"
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}

      {error !== undefined || d === undefined ? (
        <Panel title={selected.name}>
          <p role="alert" style={{ color: "var(--st-missed)" }}>
            {error?.detail ?? error?.title ?? "This batch's figures could not be loaded."}
          </p>
        </Panel>
      ) : (
        <section aria-label={selected.name}>
          {/* ASSUMPTION: O-17 -- the calendar replaces the ribbon; no FR asks for it. */}
          <CycleCalendar
            weeks={toBatchCalendarDays(
              cycleContaining(toProgrammeDate(new Date())),
              [...d.days],
              [...d.extraAfter],
              d.date,
            )}
            label={label}
          />

          <div className="mt-3">
            <CountsRow
              items={[
                {
                  tone: "ink",
                  strong: true,
                  text: `${String(d.counts.submitted)} of ${String(d.counts.enrolled)} submitted`,
                  testId: `submitted-count-${selected.id}`,
                },
                { tone: "late", text: `${String(d.counts.late)} late`, testId: `late-count-${selected.id}` },
                { tone: "absent", text: `${String(d.counts.absent)} absent`, testId: `absent-count-${selected.id}` },
                { tone: "missed", text: `${String(d.counts.missed)} missed`, testId: `missed-count-${selected.id}` },
                ...(d.extraCount > 0
                  ? [{ tone: "muted" as const, text: `+${String(d.extraCount)} extra this cycle` }]
                  : []),
              ]}
            />
          </div>

          <div className="mt-1" data-testid={`day-label-${selected.id}`} data-date={d.date}>
            <SectionLabel>
              {formatCivilDateLabel(d.date)}
              {d.isFallbackDay && " · the last required day, not today"}
            </SectionLabel>
          </div>
        </section>
      )}
    </div>
  );
}
```

This drops `RibbonKey` (mentor-only legend for the ribbon's states) — it described `CycleRibbon`'s
exact vocabulary and has no equivalent yet for the grid. **Do not silently drop the legend
requirement**: `CycleCalendar`'s cells already carry full text accessible names (Task 4), so the
*accessibility* floor is not regressed, but the visible on-screen key ADR-0020 introduced is gone.
Flag this explicitly in the PR description as a known, deliberate gap for Task 7's documentation
pass to either accept or ask the spec lead to design a calendar-equivalent key — do not invent one
here without design-system sign-off.

- [ ] **Step 2: Update the existing unit test**

`apps/web/test/mentor-today.test.tsx` currently exercises the multi-batch stacking (one ribbon per
batch). Rewrite its scenarios for the new shape: a single-batch mentor sees no chip row; a
multi-batch mentor sees chips and exactly one calendar, for the first batch by default; passing
`batchId` selects that batch's calendar instead.

- [ ] **Step 3: Update the e2e suite**

In `apps/web/e2e/dashboard-flows.spec.ts`, retarget the mentor-side ribbon selectors to
`CycleCalendar`'s grid semantics (same approach as Task 5 Step 4), and add one new case per spec
§6: switching the batch chip re-renders the calendar for the newly selected batch, with no cycle
carried over (there is no cycle selection on this page to carry over — assert the calendar's
`label` changes to the new batch's name instead).

- [ ] **Step 4: Run typecheck, unit tests, and a real build**

Run: `pnpm --filter @irp/web typecheck && pnpm --filter @irp/web test mentor-today -- --run && AUTH_DEV_BYPASS=false pnpm --filter @irp/web build`
Expected: all pass. Re-run typecheck after the build per the Global Constraints note.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(app\)/page.tsx apps/web/app/\(app\)/mentor-today.tsx apps/web/test/mentor-today.test.tsx apps/web/e2e/dashboard-flows.spec.ts
git commit -m "feat(web): replace CycleRibbon with a batch-selected CycleCalendar on mentor's Today (O-17, D3)"
```

---

### Task 7: Documentation and the corrected call-site record

**Files:**
- Modify: `docs/design-system.md` (§7)
- Modify: `docs/interview-and-prd.md` (§5, add O-17)
- Modify: `handoff.md` (§1, dated entry)
- Modify: `docs/superpowers/specs/2026-09-15-cycle-calendar-design.md` (§3, correct the my-month
  claim per this plan's audit finding 1)
- Modify: `docs/walkthrough.md` (mentor/student home screenshots and descriptions)

**Interfaces:** None — documentation only.

- [ ] **Step 1: Replace `docs/design-system.md` §7's ribbon description**

Rewrite the section to describe the calendar grid: cell states (weekday five-state + weekend
extra/blank), the colour-plus-text accessible-name rule (Task 4's `cellLabel`), the week-row
layout and Monday-first convention (audit finding 4), and the mentor-only legend gap Task 6 flagged
— either describe the accepted gap or the replacement key, whichever the spec lead decides.

- [ ] **Step 2: Add O-17 to `docs/interview-and-prd.md` §5**

```markdown
| O-17 | Replace the FR-28/29 ribbon with a month-grid calendar; no requirement currently asks for this | Implemented behind the assumption that the calendar is wanted (`// ASSUMPTION: O-17` at each entry point). `CycleRibbon` and its five-state vocabulary are left in place, unimported, as the revert path if this comes back "no" | Mentor sign-off outstanding |
```

- [ ] **Step 3: Correct the spec's §3 call-site list**

In `docs/superpowers/specs/2026-09-15-cycle-calendar-design.md` §3, replace the `my-month/page.tsx`
bullet with a note recording that it was dropped from this plan (audit finding 1) and why, so the
spec and the shipped code do not silently diverge — the same rule Plan 8's per-submission-review
correction followed.

- [ ] **Step 4: `handoff.md` entry**

Add a dated entry under §1 describing what shipped: the two call sites, O-17, the `extraAfter`
weekend-granularity limitation (audit finding 2), the dropped my-month call site (audit finding 1),
and the RibbonKey-equivalent gap (Task 6).

- [ ] **Step 5: `docs/walkthrough.md` update**

Update the mentor and student home screenshots/descriptions from ribbon to calendar.

- [ ] **Step 6: Commit**

```bash
git add docs/design-system.md docs/interview-and-prd.md handoff.md docs/superpowers/specs/2026-09-15-cycle-calendar-design.md docs/walkthrough.md
git commit -m "docs: record the cycle calendar's O-17 status and corrected call sites"
```

---

### Task 8: NFR-13 no-scroll verification (go/no-go gate)

**Files:** None modified — this is a manual verification task per the spec's own §7.

- [ ] **Step 1: Start the app against the seeded two-batch demo data**

Run: `pnpm dev` (or the compose stack), sign in as the mentor persona, seed a fresh database
(`pnpm --filter @irp/api run db:seed`) if the current one is stale.

- [ ] **Step 2: Resize the browser to exactly 1280px wide**

Verify at 1280×800 (the NFR-13 floor) that the mentor's home renders the batch selector, one
`CycleCalendar`, and the FR-28 inline figures (N of M, late, absent) with **no scrolling**.

- [ ] **Step 3: Record the result**

If it fits: note the measurement (e.g. total content height vs. viewport) in this plan's own
progress ledger and in the `handoff.md` entry from Task 7.

If it does not fit: **stop.** Per the spec's §7/§10, this is not a CSS tweak to paper over — it
means the design needs to return to brainstorming. Do not merge Tasks 5-6 past this gate on the
assumption a later pass will shrink it in.

- [ ] **Step 4: Commit the verification note (if not already folded into Task 7's commit)**

```bash
git add handoff.md
git commit -m "docs: record NFR-13 verification for the cycle calendar (O-17)"
```

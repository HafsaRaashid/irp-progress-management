# Cycle Calendar — Replacing the Ribbon with a Month-Grid View — Design

**Date:** 2026-09-15
**Author:** Mohaideen Abdullah (spec lead, with Claude Code)
**Status:** Draft — pending review by Danella De Cruz before Hafsa Raashid begins implementation
**Feeds:** a new plan, one branch and one PR, in `HafsaRaashid/irp-progress-management`
**FRs:** FR-28, FR-29 (the surfaces this replaces) — see §2 for why this itself maps to no FR
**Governs / closes:** reopens and supersedes [ADR-0003](../../adr/0003-cycle-ribbon-as-fr-28-summary.md)
**ADRs owed by this slice:** one — see §9

---

## 1. Scope and decision record

Decisions taken during brainstorming, all by the spec lead with the requesting stakeholder:

| # | Decision | Choice |
|---|---|---|
| D1 | Original request vs. what this ships | The request (inspired by an ELMS/LMS screenshot set) was an admin-settable "deadline" that both roles see on a calendar. **Rejected outright**: admin-set, student-facing deadlines are task assignment — an explicit non-goal ("the system records work, never assigns it," `CLAUDE.md`). What ships instead is **read-only**: a calendar rendering of dates the cycle engine already computes. No new admin write path, no new stored concept. |
| D2 | Relationship to the existing cycle ribbon | **Replace it.** `CycleRibbon` (ADR-0003) is retired; a new `CycleCalendar` component takes over its three call sites (`mentor-today.tsx`, `student-today.tsx`, `my-month/page.tsx`). Rejected: keeping both (two components doing the same job — showing this cycle's per-day state — is exactly the duplication ADR-0003 itself warns against for a different pattern). |
| D3 | Multi-batch mentor layout | **One shared calendar with a batch selector** (chips, matching the existing Cycles-page pattern), not one calendar stacked per batch. Rejected: a calendar per batch, stacked — a month-grid is 5-6 rows tall where the ribbon was one row; stacking two of them almost certainly breaks FR-28's no-scroll requirement (NFR-13) at the 1280px minimum, which is exactly the width/height budget ADR-0003's own analysis was protecting. |
| D4 | What each day cell shows | **Compliance state (the same five marks the ribbon used: on-time/late/absent/missed/future) plus, for weekdays, the grace-window cutoff** from `graceDeadlineFor` (`packages/core/src/submission-window.ts`). Rejected: compliance state only — it would keep parity with the ribbon but drop the one genuinely new thing this view adds over the ribbon it replaces. |
| D5 | Navigation model | **Cycle-based** (previous/next *cycle*, chip-style, matching the existing Cycles page), not calendar-month arrows. Rejected: calendar-month navigation (the ELMS reference's own pattern) — IRP's unit is the 10th-to-9th cycle, not the calendar month, and introducing a second, month-based navigation idiom alongside the app's existing cycle-based one would be an inconsistency with no functional benefit. |

**Out of scope.** Any admin-settable deadline, assignment, or task concept — rejected in D1 and
not reopened here. No new API endpoint — the dashboard aggregate ADR-0003 introduced already
returns full-cycle per-day data; this is a rendering change, not a contract change. No change to
the Cycles page (`apps/web/app/(app)/cycles/page.tsx`) itself, which already does per-cycle
browsing for a different purpose (the mentor's detailed per-cycle roster, not the FR-28/29 home
summary). No mobile layout (NFR-13, desktop-only, unchanged).

## 2. The FR problem, stated rather than buried

**This maps to no FR.** FR-28 and FR-29 specify a performance summary and a personal history
respectively; ADR-0003 chose the ribbon as *one* way to satisfy them, and that choice — not the
underlying FRs — is what changes here. Per `CLAUDE.md`, "a change that maps to no FR does not
belong in this repo" without going through the same escalation the Settings/theme-switch spec
used for its own no-FR change (ADR-0002 closure, logged as **O-14**).

**Action:** logged as a new open point, **O-17**, for mentor sign-off — "replace the FR-28/29
ribbon with a month-grid calendar; no requirement currently asks for this." Implement behind the
stated assumption that the calendar is wanted, and mark the new component's entry point
`// ASSUMPTION: O-17`. Do not silently claim FR-28/29 coverage as though this were requested.

If O-17 comes back "no," §11 covers the revert path.

## 3. Architecture

A new `CycleCalendar` component (`apps/web/components/cycle-calendar/cycle-calendar.tsx`),
replacing `CycleRibbon` at all three existing call sites:

- `apps/web/app/(app)/mentor-today.tsx` — one shared calendar per mentor's view, with a batch
  selector when the mentor has more than one batch (D3)
- `apps/web/app/(app)/student-today.tsx` — a single calendar, no selector (a student has one
  active enrolment)
- `apps/web/app/(app)/my-month/page.tsx` — same component, viewing a past cycle via the existing
  cycle-picker query param, exactly as the ribbon did

**Data.** No new endpoint. `CycleCalendar` consumes the same shape `CycleRibbon` does today —
`toBatchRibbonDays`/`toStudentRibbonDays` in `apps/web/lib/ribbon.ts` — renamed in place to
`toBatchCalendarDays`/`toStudentCalendarDays` (same logic, same `DayComplianceLike` input, same
five-state `DayMark` output) since the underlying per-day classification (`batchDayMark`,
`studentDayMark`) does not change — only the rendering shape does.

**Grace-cutoff data.** `graceDeadlineFor` already exists in `@irp/core` and is a pure function of
a `CivilDate` — no API round-trip needed; the calendar computes each weekday cell's cutoff
client-side (well, server-side in the Server Component, same trust boundary as the rest of
`apps/web`) from the date it is already rendering.

**Layout.** A standard 7-column week grid, one row per week the cycle touches (a 10th-to-9th
cycle always spans parts of two calendar months, so the grid shows leading/trailing days from
the adjacent months dimmed and non-interactive — display only, matching the familiar
month-calendar convention, but they carry no compliance mark since they fall outside the cycle
being viewed). Weekend cells render present but visually de-emphasised, consistent with FR-12/
FR-33 (optional, only "extra" marks apply) — this differs from the ribbon, which omitted weekends
entirely (ADR-0003 Amendment 1); a grid layout cannot skip calendar days the way a linear strip
could without breaking the week-row structure, so weekends are shown, not omitted, and marked
`extra` or left blank per the existing five-state vocabulary.

**Batch selector (D3).** Chips above the calendar, one per the mentor's batches, following the
existing pattern in `apps/web/app/(app)/cycles/page.tsx` (`aria-current` on the selected chip,
switching batch does not carry the selected cycle forward — same reasoning as that page's
existing comment on why batch and cycle are independent selections).

## 4. Accessibility

Per `docs/design-system.md` §12, colour is never the sole carrier. Each day cell exposes an
accessible name combining the date, the compliance state as text (not just as a fill colour), and
— for a weekday — its grace-cutoff time. This is a strict superset of what `CycleRibbon` already
exposed per day, so no accessibility regression from the shape change alone; the grid layout's own
semantics (a table/grid role with row/column headers for weeks and weekdays) are new work the
ribbon's linear-strip semantics didn't need.

## 5. Edge cases (carried over from the ribbon, revalidated for the grid)

- **Cycle day 1** — only that day is inside the cycle; the rest of its week's row shows
  adjacent-month dimmed cells, same treatment as any other cycle boundary mid-week.
- **A batch admitted mid-cycle** — cells before the batch's start date render as dimmed/inactive
  even though they fall inside the 10th-9th range, same rule the ribbon already applied via
  `cycleWorkingDays`/enrolment filtering.
- **A cycle viewed after it has closed** (via `my-month`'s cycle picker) — all cells render as
  resolved states (no `future`/outline marks remain), unchanged from the ribbon's behaviour.
- **Multi-batch mentor, no batch yet selected** — defaults to the first batch by name, matching
  the existing Cycles-page default-selection behaviour.

## 6. Testing

| Level | Case |
|---|---|
| Unit | `CycleCalendar` renders one cell per calendar day in the weeks the cycle spans, including dimmed adjacent-month cells |
| Unit | Each weekday cell exposes both a compliance mark and a grace-cutoff accessible label; weekend cells expose no cutoff |
| Unit | `toBatchCalendarDays`/`toStudentCalendarDays` produce the same five-state classification as the prior ribbon helpers (regression parity) |
| Unit | Mentor view with 2+ batches renders one calendar plus a batch selector, not one calendar per batch |
| Unit | Student view renders no batch selector |
| Unit | A batch admitted mid-cycle dims pre-enrolment cells |
| Unit | A closed cycle (via `my-month`) renders no `future`-marked cells |
| E2E | `dashboard-flows.spec.ts` updated: assertions that previously targeted `CycleRibbon`'s DOM now target `CycleCalendar`'s equivalent semantics — same user-facing guarantees (today's N-of-M, late/absent counts still visible without scrolling), new selectors |
| E2E | Mentor with 2 batches: switching the batch selector re-renders the calendar for the newly selected batch, cycle selection does not carry over (matches D3/existing Cycles-page behaviour) |

## 7. NFR-13 verification (the no-scroll requirement)

This is the load-bearing constraint D3 exists to protect. Before merge, the implementer must
verify — with the seeded two-batch demo data, at exactly the 1280px minimum width — that the
mentor's home renders the batch selector plus one calendar plus the FR-28 inline figures (N of M,
late, absent) with **no scrolling**. If it does not fit, this is a stop-the-plan finding, not a
CSS tweak to paper over: it means D3's mitigation was insufficient and the design needs to return
to brainstorming, not ship over-budget.

## 8. Documentation to update

- `docs/design-system.md` §7 — replace the ribbon's visual spec with the calendar grid's (cell
  states, colour-plus-text rule, week-row layout)
- `docs/interview-and-prd.md` §5 — add **O-17** (calendar replaces the ribbon; maps to no FR)
- `handoff.md` §1 — a dated entry for this slice
- `docs/walkthrough.md` — mentor/student home screenshots and descriptions update from ribbon to
  calendar

## 9. ADRs owed

Per `CLAUDE.md`, a decision with a plausible rejected alternative needs an ADR naming at least
two, written **before** implementation. One qualifies here, and it formally supersedes ADR-0003
rather than merely amending it — ADR-0003's own decision (ribbon over stat-cards, ribbon over a
full data-viz dashboard) is being replaced outright, not extended:

**ADR — Month-grid calendar over the cycle ribbon for the FR-28/29 summary surface.** Supersedes
ADR-0003. Rejected: keeping the ribbon (D2's reasoning — two components for one job); a calendar
stacked per batch on the mentor's home (D3's reasoning — near-certain NFR-13 violation); a
calendar-month navigation model matching the ELMS reference literally (D5's reasoning — a second,
inconsistent navigation idiom next to the app's existing cycle-based one).

## 10. Risks

| Risk | Handling |
|---|---|
| A month-grid genuinely cannot fit FR-28's no-scroll budget even with D3's mitigation | §7 makes this an explicit go/no-go gate, not a discovered-late problem. If it fails, the finding goes back to brainstorming — do not ship a scrolling dashboard to satisfy a no-scroll requirement. |
| O-17 comes back "no" | `CycleRibbon` and its helpers are renamed, not deleted, in this design (`toBatch/StudentCalendarDays` wrap the same underlying classification functions) — reverting is restoring the three call sites to the old component, not rebuilding ribbon logic from scratch. Keep this in its own commit range for a clean revert. |
| Weekend cells showing (unlike the ribbon's total omission) reopens ADR-0003 Amendment 1's reasoning about "extra work" visibility | Deliberate, and stated in §3 — a grid cannot omit calendar days the way a linear strip can. Flagged here so it isn't mistaken for an accidental regression during review. |
| The grid's accessibility semantics (week/weekday roles) are new work with no ribbon precedent to copy | Scoped explicitly in §4 rather than assumed to be "the same as before" — budget real design-system review time for this, not just a port of the ribbon's existing per-day labels. |

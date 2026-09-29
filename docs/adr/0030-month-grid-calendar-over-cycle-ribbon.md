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
   page) is an inconsistency with no functional benefit. Moot for the shipped scope in any case —
   see the implementation plan's audit finding 1: the only call site that would have needed
   cycle navigation (`my-month`) was dropped, since it never carried a ribbon or a cycle-picker to
   begin with.

## Consequences
Positive: keeps the "live assertion on the date engine" property ADR-0003 valued — a grid renders
every calendar day, so a boundary bug is visible on the landing screen. Negative: new accessibility
work (grid/row/column semantics have no ribbon precedent); weekend cells reopen ADR-0003 Amendment
1's reasoning about "extra work" visibility (deliberate, not a regression — a grid cannot omit
calendar days the way a linear strip can). The batch-level `extraAfter` field cannot distinguish
which weekend day was worked, so both cells of a flagged weekend render identically — a documented
scope limit, not a defect (see the implementation plan's audit finding 2).

## Revisit when
O-17 comes back "no" — revert by restoring the three call sites to `CycleRibbon`, which this
design leaves in place unimported for exactly this reason.

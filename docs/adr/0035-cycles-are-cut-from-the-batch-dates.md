# ADR-0035 — Cycles are cut from the batch's own start and end dates

- **Status:** Accepted — **pending stakeholder sign-off.** Cycle boundaries are on the PRD's
  "requires stakeholder sign-off" list (§4.3). This was decided by the product owner during the
  mentor UI/UX pass; the IRP Mentor has not yet confirmed it.
- **Date:** 2026-10-21
- **Deciders:** HafsaRaashid (with Claude Code)
- **Requirements:** FR-9, FR-27, FR-29, FR-6
- **Supersedes:** the "fixed 10th-to-9th windows" reading of FR-9 in `packages/core/src/cycle.ts`;
  amends [ADR-0019](0019-dashboard-cycles-addressed-by-engine-sequence.md)

---

## Context

FR-9 reads: "Evaluation cycles run from the 10th of one month to the 9th of the next … anchored
to the batch's admission date." The engine implemented the first half literally: every cycle was
a fixed calendar window, 10th to 9th, whatever the batch's dates were. The batch's start date
only decided which cycle was *numbered* 1. A batch starting on 15 June therefore got a cycle 1 of
10 June – 9 July that began five days before the batch existed, and its first real cycle was the
one after.

That disagrees with the second half of FR-9 and with how a mentor thinks about a batch: a
cycle's start should be the batch's start, and the programme should end when the batch ends.

## Decision

Cycles are cut from the batch's own `startDate` and `endDate`.

- **Cycle 1 starts on the batch's start date.** Cycle *k* starts on the same day of the month
  *k − 1* months later, and runs to the day before cycle *k + 1* starts.
- **The last cycle is cut at the batch's end date**, so it can be short. No cycle starts after
  the batch ends. The batch's end date therefore decides how many cycles it has.
- **Every start is shifted from the batch's start date, never from the previous cycle.** The
  day is clamped to the month's length, so a batch starting on the 31st has cycles starting
  31 Jan, 28 Feb, 31 Mar. Stepping from the previous start would drag every later cycle to the
  28th.
- **A student follows the calendar of the batch they are in today.** After a transfer their
  cycle dates and "Month N" are the new batch's. With no enrolment (a mentor) there is no
  student cycle.
- **FR-27 is unchanged.** A student who joins mid-cycle is not evaluated for it; their first
  evaluated cycle is the next one and "Month N" counts from there.
- **Before the batch starts** there is no current cycle (`seq` is null, bounds name cycle 1).
  **After it ends** the last cycle is the current one.

The engine API is now batch-anchored (`cycleAt`, `cycleBounds`, `cycleCount`, `batchPhase`,
`firstEvaluatedCycle`, plus `addMonths` on civil dates); the fixed-window functions
(`cycleContaining`, `shiftCycle`, `cycleFor`, `firstEvaluatedCycleStart`) are removed, so no
caller can reach for a calendar that no longer exists.

## Rejected alternatives

**Keep the fixed 10th-to-9th windows (the status quo).** Rejected: a batch's first cycle began
before the batch did, mid-month batches lost their first month to FR-27's "not evaluated for a
partial cycle", and two concurrent batches with different start dates shared one calendar that
matched neither. The only argument for it — one global boundary — is not a requirement anyone
stated.

**Fixed six one-month cycles from the batch start, ignoring the end date.** Rejected: it lets
the programme run past the batch's own end date, or stop short of it, whenever the two disagree.
Cutting at the end date makes the batch's two dates the single source of truth for its length;
`PROGRAMME_MONTHS` (6) remains only as the "of 6" display figure.

**A student follows the calendar of their first batch.** Rejected for transfers: it would keep
"a transfer never resets Month N" but leave the student's cycle dates matching a batch they no
longer belong to, so their Cycles figures would disagree with the mentor's for the batch they
are actually in.

## Consequences

- **A transfer now moves a student onto the new batch's calendar and numbering.** The walkthrough
  and the spec previously said "Month N of 6" survives a transfer; it no longer does.
- **`Cycle` table rows are derived from the batch dates** (`ensureCycles`), so a batch whose
  start or end date is edited after cycles were materialised would leave stale rows. Batch dates
  are not editable anywhere today; if that changes, this needs a re-materialisation step.
- **The cycle picker still lists six chips** (`PROGRAMME_MONTHS`). A batch with a different
  number of cycles shows the extra chips dimmed or too few; deriving the chip count from the
  batch is a follow-up.
- **O-12-style sign-off is outstanding.** If the mentor wants the 10th-to-9th calendar back, this
  ADR is superseded and the engine reverts; the data model is unchanged either way.
- **Test and seed data are unaffected in shape**: the demo batches still start on a 10th, so
  they read like the old windows, but they are no longer required to.

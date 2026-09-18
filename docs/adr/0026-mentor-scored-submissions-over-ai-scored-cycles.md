# ADR-0026: Mentor-scored submissions over AI-scored cycles

## Status
Accepted (2026-09-15). Implements O-18, per the
`2026-09-15-per-submission-review-design.md` spec §9.

## Context
FR-22 ("AI generates a summary"), FR-23 ("AI scores the cycle, producing a
performance index"), and half of FR-24 ("the AI-produced score is the score
of record; an override stores the new score, the original AI score...")
describe a pipeline that depends on O-5 — the AI provider decision, still
open, and gated on a leadership escalation because student submissions are
personal data. There is no resolution date for O-5, and it blocks all of
tasks 1-4, 6, and 7 of the irp-consolidation-task-list.xlsx sequence
indefinitely if this pipeline stays as designed.

## Decision
Mentors score each submission (`Entry`) directly — a 0-100 integer score,
free-text feedback, and an explicit `countsTowardEvaluation` flag — as part
of the existing per-day review flow. A deterministic monthly calculation
(task 7, its own spec and ADR) aggregates those scores plus attendance into
the performance index. No AI call is made anywhere in this path. `Override`'s
"stores the new score, the original AI score" shape no longer applies, since
there is no AI score to override; what replaces it is task 7's concern.

This is a **replacement** of FR-22/23/24's mechanism, not an additive
feature — it needs the same explicit sign-off O-11 required when it revised
FR-12/added FR-33 (`docs/interview-and-prd.md` §4.2). Logged as **O-18**:
"replace AI-scored cycles (FR-22-24) with mentor-scored submissions
aggregated by a deterministic calculation; no AI call is made." Implemented
behind this stated assumption, marked `// ASSUMPTION: O-18` at the schema and
route level, pending the mentor confirmation the spec's own risk table (§10)
calls for before this ships to students.

## Rejected alternatives
1. **Keep FR-22-24 as designed and wait on O-5.** Blocks tasks 1-4, 6, and 7
   with no resolution date, and leaves the entire evaluation slice
   unbuildable behind a decision that also needs a personal-data-handling
   leadership sign-off, not just a technical pick.
2. **Build both in parallel** (an AI score plus a mentor per-submission
   score, reconciled later). Rejected as speculative complexity: there is no
   consumer for two scores and no reconciliation rule defined, so this would
   ship a second scoring pipeline nobody reads from until a rule exists to
   pick between them — exactly the kind of dual-implementation CLAUDE.md's
   house rules warn against building for a hypothetical future need.

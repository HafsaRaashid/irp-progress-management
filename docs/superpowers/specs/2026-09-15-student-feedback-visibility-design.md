# Student Feedback Visibility — Design

**Date:** 2026-09-15
**Author:** Mohaideen Abdullah (spec lead, with Claude Code)
**Status:** Draft — pending review by Danella De Cruz before Hafsa Raashid begins implementation
**Feeds:** a new plan, one branch and one PR, in `HafsaRaashid/irp-progress-management`. Third of
a four-spec sequence (task 5); **depends on** the per-submission-review spec
(`2026-09-15-per-submission-review-design.md`, tasks 1–4) merging first — this spec builds on its
`mentorFeedback` field and its `StudentEntry`/`Entry` schema split
**FRs:** Surfaces data already stored under FR-19's mentor-record authority; adds no new write
**Governs / closes:** none
**ADRs owed by this slice:** none — this is additive within an already-designed split

---

## 1. Scope and decision record

| # | Decision | Choice |
|---|---|---|
| D1 | Where feedback appears | **`My month`** (`apps/web/app/(app)/my-month/page.tsx`), inline under each entry it refers to — not the student's home (`student-today.tsx`). Rejected: the home page — it deliberately shows only the open submission window (today/yesterday), and feedback is only meaningful once a mentor has reviewed a *past* entry, which is what `My month`'s day-by-day history already exists to show. |
| D2 | What's shown, given the tasks-1–4 spec's `score`/`countsTowardEvaluation` split | **Feedback text only.** Neither `score` nor `countsTowardEvaluation` is surfaced to students — both stay mentor-only per the non-goal "no student-visible score" and the prior spec's `StudentEntry` schema, which already omits them. This spec adds exactly one field to that schema: `mentorFeedback`. |
| D3 | Feedback on an unreviewed entry | **Render nothing** for an entry with no feedback yet (`mentorFeedback: null`) — no placeholder text like "not yet reviewed," which would imply a promise of review timing this system doesn't make. Rejected: an explicit "awaiting feedback" placeholder — invents a expectation (a review SLA) nothing in the FRs establishes. |

**Out of scope.** Any student action on feedback (acknowledge, reply, dispute) — none requested,
and a reply channel would edge toward the non-goal "no student-to-student... messaging" territory
by introducing two-way communication this system doesn't otherwise have. No notification when
feedback is added — that's Plan 8's domain (FR-21 already covers "on submission and state
change"; a review write is neither, and extending Plan 8's scope is not this spec's call to make).

## 2. Data model

No schema change. This spec surfaces `Entry.mentorFeedback`, added by the per-submission-review
spec — it does not introduce a new column.

## 3. API surface

One field added to the `StudentEntry` schema that spec introduced: `mentorFeedback: string | null`.
`toApiEntryForStudent` (that spec's student-safe mapping function) gains one line — `mentorFeedback:
e.mentorFeedback` — alongside the fields it already carries, still omitting `score` and
`countsTowardEvaluation`. No other endpoint changes: `GET /api/v1/me/days` already returns
`StudentEntry` per entry; this spec only widens what that shape contains.

## 4. Web surface

`apps/web/app/(app)/my-month/page.tsx`'s existing per-entry render (`day.entries.map(...)`, lines
142–151) gains one conditional block directly under each entry's body:

```tsx
{entry.mentorFeedback !== null && (
  <p data-testid="entry-feedback" className="prose" style={{ color: "var(--ink-muted)" }}>
    <strong>Mentor feedback:</strong> {entry.mentorFeedback}
  </p>
)}
```

Muted ink (`--ink-muted`), matching the existing treatment of `day.absenceReason` just above it in
the same file — feedback is contextual, secondary text under the entry it explains, not a
call-to-action. No new component: this is a small addition to an existing render loop, not a
distinct panel or section.

## 5. Non-goal check

**"No student-visible score, rank, or leaderboard."** Still holds — this spec is deliberately
narrow to feedback text alone, and D2 states explicitly why `score`/`countsTowardEvaluation` are
excluded even though they live on the same underlying row.

**"No student-to-student... messaging."** Not implicated — feedback is mentor-to-student, one
direction, already the FR-19 authority relationship; this spec adds no reply path (D1's out-of-scope
note).

## 6. Testing

| Level | Case |
|---|---|
| Unit | `toApiEntryForStudent` includes `mentorFeedback`, still excludes `score` and `countsTowardEvaluation` |
| Unit | An entry with `mentorFeedback: null` renders no feedback block on `My month` |
| Unit | An entry with feedback renders it under the entry body, in muted ink |
| Integration | `GET /me/days` for a reviewed entry returns non-null `mentorFeedback` and no `score` key at all in the JSON body (not just `score: undefined` — an actual absent key, matching the prior spec's "absent, not merely null" test) |
| E2E | Student signs in, opens `My month`, sees mentor feedback on a previously reviewed entry (seed data needs at least one scored/feedback-bearing entry for this to be observable — flagged in §8) |

## 7. Documentation to update

- `docs/walkthrough.md` — `My month` walkthrough gains a line noting feedback appears under
  reviewed entries
- `handoff.md` §1 — dated entry noting this closes the loop the schema comment on
  `MentorDayRecord.note` implicitly flagged ("saved but never shown") — though note that comment
  was about `MentorDayRecord.note` (day-level), not `Entry.mentorFeedback` (per-entry); this spec
  addresses the per-entry field the prior spec introduced, not the pre-existing day-level note,
  which remains mentor-only and untouched

## 8. Risks

| Risk | Handling |
|---|---|
| Seed data has no scored/feedback-bearing entries, making the E2E case unobservable without a seed change | Flagged here rather than discovered mid-implementation — the seed script (`apps/api/prisma/seed.ts`) needs at least one entry with `score`/`mentorFeedback` set for at least one persona, which is really the prior (tasks 1–4) spec's seed responsibility since it's the one adding the columns; note the dependency here so it isn't dropped between the two plans. |
| This spec ships before the tasks 1–4 spec merges | Explicitly sequenced as a dependency in the header — do not start this plan's implementation until `mentorFeedback`/the `StudentEntry` split exist. |

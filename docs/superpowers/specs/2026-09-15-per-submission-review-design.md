# Per-Submission Review — Scoring, Feedback, and Evaluation Inclusion — Design

**Date:** 2026-09-15
**Author:** Mohaideen Abdullah (spec lead, with Claude Code)
**Status:** Draft — pending review by Danella De Cruz before Hafsa Raashid begins implementation
**Feeds:** a new plan, one branch and one PR, in `HafsaRaashid/irp-progress-management`. First of a
four-spec sequence covering the irp-consolidation-task-list.xlsx feature gaps (this spec: tasks
1–4; task 5 next; tasks 6/7 after; task 8 independent)
**FRs:** Extends FR-10, FR-11, FR-18, FR-19, FR-20. **Supersedes FR-22, FR-23, FR-24** — see §2
**Governs / closes:** none yet. Opens **O-18** (§2) and owes one ADR (§9)

---

## 1. Scope and decision record

Decisions taken during brainstorming, all by the spec lead with the requesting stakeholder:

| # | Decision | Choice |
|---|---|---|
| D1 | Entry vs. a new Submission concept | **`Entry` becomes the submission** — extended in place with a score, mentor feedback, and an evaluation-inclusion flag. Rejected: a separate parallel `Submission` model — it would leave two similar student-authored per-day records (`Entry` and `Submission`) for a mentor to reconcile, for no benefit `Entry` extension doesn't already give. |
| D2 | Approve vs. score as separate actions | **Scoring is approving** — one mentor action (set a score) is both the review and the approval signal. There is no separate "approved" boolean distinct from having a score. Rejected: two-state approve/score — adds a state with no behaviour of its own once scoring already implies review happened. |
| D3 | Score scale | **0–100 integer** per submission. Rejected: 0–10 — coarser, and averages less cleanly into the monthly "task score" figure task 7 will compute. |
| D4 | Locking | **Locked with the day.** Once a `DailyReport` reaches `EVALUATED` (FR-20), its entries' scores/feedback/flag are frozen exactly like the entry body already is — same `LockedDayError` mechanism `entry-repo.ts` already enforces. Rejected: leaving scores editable post-Evaluated — a new carve-out FR-20 doesn't have today, and inconsistent with every other per-day mentor write. |
| D5 | Relationship to the AI evaluation model (FR-22–24) | **This pivot supersedes the AI-scores-the-student design**, not just adds to it. FR-22/23 (AI generates a summary and scores the cycle) and the "AI score, mentor may override" structure of FR-24 are replaced by: the mentor scores individual submissions directly as they're created, and a deterministic monthly calculation (spec for task 7, next in this sequence) aggregates those scores plus attendance into the performance index. There is no AI score to override, so **`Override`'s "original AI score" concept no longer applies** — see §2 for the open point this raises, and §9 for the schema consequence. |

**Out of scope.** The monthly calculation itself (task 7 — a separate spec, since it also touches
`Cycle`/`Evaluation` and needs its own design). Surfacing feedback to students (task 5 — separate
spec, next in sequence, depends on this one's schema). Any change to `MentorDayRecord`
(attendance/tasks-completed, FR-19) — untouched; this spec only extends `Entry`. The AI provider
question (O-5) itself is not resolved here — this spec removes the *need* for it in the scoring
path, but does not retroactively decide O-5 for any other still-hypothetical AI use.

## 2. The FR problem, stated directly

This is not a no-FR addition (unlike the cycle-calendar spec's O-17) — it's a **replacement** of
three existing FRs' mechanism. FR-22 ("AI generates a summary"), FR-23 ("AI scores... producing a
performance index"), and half of FR-24 ("the AI-produced score is the score of record... an
override stores the new score, the original AI score...") describe a pipeline this spec does not
build and instead replaces with a mentor-driven one.

**This needs the same explicit sign-off O-11 required** when it revised FR-12/added FR-33 — a
requirement-level change reserved to the decision owner (`docs/interview-and-prd.md` §4.2), not
something a spec silently reinterprets.

**Action:** logged as **O-18** — "replace AI-scored cycles (FR-22–24) with mentor-scored
submissions aggregated by a deterministic calculation; no AI call is made." Implemented behind
the stated assumption that this is the intended direction (per the task list this spec responds
to), marked `// ASSUMPTION: O-18` at the schema and route level. **This is the one open point in
this entire task-list sequence that most needs mentor confirmation before Hafsa builds against
it** — everything in tasks 1–4, 6, and 7 is built on this premise holding.

If O-18 comes back "keep the AI model instead," this spec's `Entry` fields (score, feedback,
countsTowardEvaluation) can still stand as **input evidence** for a future AI evaluation rather
than the score of record itself — but that reconciliation is not designed here and would need its
own revision once O-5 clears.

## 3. Data model

Extend `Entry` (`apps/api/prisma/schema.prisma`) with three new columns:

```prisma
model Entry {
  // ...existing fields unchanged...
  score                  Int?     // 0-100. Null until a mentor reviews it (D2/D3).
  mentorFeedback         String?  // Free text, mentor-authored. Null until reviewed.
  countsTowardEvaluation Boolean  @default(false) // D2: true only once scored AND explicitly ticked.
}
```

`score` and `mentorFeedback` are set together, in one write, matching the existing
`DayRecordUpsert` pattern (`MentorDayRecord`'s PUT fully replaces attendance+tasks+note in one
call) rather than three separate PATCHes. `countsTowardEvaluation` defaults `false` — nothing
counts until the mentor explicitly ticks it, per task 4's own wording ("nothing counts unless the
mentor both approves it and ticks it," which D2 resolves to "unless the mentor scores it **and**
ticks it").

No migration touches `Evaluation`, `Override`, or `Award` in this spec — those are task 7's
concern, once the monthly calculation is designed. This spec only prepares the per-submission
data those tables will eventually read from.

## 4. API surface

One new endpoint, admin-only, following the existing `reviews.ts` pattern:

```
PUT /api/v1/entries/{id}/review
Body: { score: number (0-100), feedback: string, countsTowardEvaluation: boolean }
```

- 400 if `score` is outside 0–100, or `feedback` exceeds a length cap (matching the existing
  500-char cap pattern on `DayRecordUpsert.note`).
- Reuses the existing lock check: resolve the entry's parent `DailyReport` by `(studentId,
  entryDate)`, and if its status is `EVALUATED`, throw the existing `LockedDayError` — identical to
  how `entry-repo.ts`'s `addEntry` and `absence-repo.ts` already guard writes against a locked day.
- `PUT`, not `PATCH`: consistent with `DayRecordUpsert`'s full-replace convention, and avoids the
  exact "unprefilled reopen silently reverts a field" bug that page's own doc-comment warns about
  — the web form must prefill all three fields from the entry's current values before resubmitting.

`GET /api/v1/students/{id}/days` (already returns entries via `toApiEntry`) gains the three new
fields on its existing `Entry` schema — no new read endpoint, since mentors already receive
entries through this response on the review page.

## 5. Web surface

`apps/web/app/(app)/review/[studentId]/page.tsx` already lists each day's entries (via
`listStudentDays`) for the mentor to read. This spec adds, per entry, a review control (score
input 0–100, a feedback textarea, and the counts-toward-evaluation checkbox) — following the
existing `DayRecordForm`/`review-actions.ts` pattern (a Server Action posting to the new PUT
endpoint) rather than inventing a new form-handling approach.

No change to the student-facing pages in this spec — `student-today.tsx`/`my-month` do not yet
surface `mentorFeedback` (that's task 5, next in sequence) or `score` (never shown to students per
the existing non-goal "no student-visible score" — see §6).

## 6. Non-goal check

**"No student-visible score, rank, or leaderboard"** (`CLAUDE.md` hard boundaries) still holds:
this spec adds a score field mentors write, but nothing here exposes it to a student. Task 5
(next spec) surfaces **feedback** to students, explicitly not score — that boundary is carried
forward, not reopened, and will be stated again in that spec.

## 7. Testing

| Level | Case |
|---|---|
| Unit | `PUT /entries/:id/review` accepts a valid 0–100 score and sets `countsTowardEvaluation` |
| Unit | Rejects a score outside 0–100 with 400 |
| Unit | Rejects a review write on an entry whose day is `EVALUATED` with the existing `LockedDayError`/409 |
| Unit | `countsTowardEvaluation` defaults `false` on entry creation and stays `false` until explicitly set `true` in a review write |
| Unit | Re-reviewing an entry (calling PUT again before Evaluated) fully replaces score/feedback/flag, not merges |
| Unit | `GET /students/:id/days` returns the three new fields on each entry |
| Integration | Full flow: student submits entry → mentor transitions day to InReview → mentor reviews (scores) the entry → mentor transitions day to Evaluated → a further review attempt 409s |
| E2E | Mentor review page: score/feedback/checkbox controls appear per entry, submit, and persist on reload |

## 8. Documentation to update

- `docs/interview-and-prd.md` §5 — add **O-18**, flagged as needing mentor confirmation before
  the dependent specs (task 7, task 6) proceed
- `docs/interview-and-prd.md` §3 (FR table) — annotate FR-22/23/24 as superseded pending O-18,
  rather than silently deleting them
- `handoff.md` §1 — a dated entry noting the AI-evaluation pivot and its dependency chain
- `docs/walkthrough.md` — the review page walkthrough gains the per-entry score/feedback controls

## 9. ADRs owed

Per `CLAUDE.md`, a decision with a plausible rejected alternative needs an ADR naming at least
two, written **before** implementation:

**ADR — Mentor-scored submissions over AI-scored cycles.** Rejected: keep FR-22–24 as designed
and wait on O-5 (blocks tasks 1–4, 6, 7 indefinitely with no resolution date); build both in
parallel (AI score plus mentor per-submission score, reconciled later) — rejected as
speculative complexity with no consumer for two scores until a reconciliation rule exists, which
this spec does not define. This ADR should also record what happens to `Override` (`schema.prisma`
model `Override`, currently "stores the new score, the original AI score, and the mentor's
reason") once there is no AI score to override — likely retired or repurposed once task 7's spec
defines what a correction to the deterministic calculation looks like; flagged here rather than
decided, since it's task 7's schema to own.

## 10. Risks

| Risk | Handling |
|---|---|
| O-18 is not confirmed before Hafsa starts building | This is the spec's central risk, called out explicitly in §2. Recommend not starting implementation until this specific open point gets a yes — unlike O-14/O-15/O-17, which shipped behind an assumption because reverting them is cheap, reverting a shipped scoring-model pivot after students/mentors have used it is not. |
| `Override`'s meaning becomes unclear once there's no AI score | Flagged in §9 as owed to task 7's ADR, not silently resolved here. |
| A mentor scores an entry, then edits the entry's own body (if that's ever allowed) | Not currently possible — students, not mentors, write `body`, and FR-20's lock already prevents any entry mutation post-Evaluated. No new risk introduced. |
| Task 7's monthly calculation design turns out to need different per-entry data than `score`/`countsTowardEvaluation` capture | This spec's fields are a reasonable, minimal starting guess, not treated as final — task 7's own spec is where the aggregation rule (and whatever it actually needs from `Entry`) gets designed, and may ask for a schema adjustment here. |

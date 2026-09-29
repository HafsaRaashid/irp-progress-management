# ADR-0027: The stakeholder interview governs over the consolidation task list

## Status
Accepted (2026-09-25). Supersedes
[ADR-0026](0026-mentor-scored-submissions-over-ai-scored-cycles.md). Records
**O-18** (`docs/interview-and-prd.md` §5) as an unresolved conflict between two
sources rather than a decision this repo is entitled to take.

## Context
ADR-0026 replaced the AI-scored-cycle pipeline (FR-22/23/24) with mentors
scoring each `Entry` directly — a 0–100 score, free-text feedback, and a
`countsTowardEvaluation` flag. It was implemented in full on
`feat/plan-9-per-submission-review`: three `Entry` columns and a migration,
`PUT /api/v1/entries/{id}/review`, a mentor/student mapping split to keep the
score away from `/me/days`, and a per-entry review control on the Review page.

ADR-0026 reasoned entirely from the FR table. It never consulted
`docs/stakeholder-interview.md` — which `CLAUDE.md` names as *"the primary
record"* — and neither did the spec or the plan beneath it. The interview
answers this question directly, three times, in §4.4 and §4.6:

| | Question | Answer |
|---|---|---|
| **Q15** | *"Can the admin approve an item but tick 'does NOT count' — and should the student see why it didn't count?"* | **No.** |
| **Q16** | *"Approval granularity — per item (each meeting, each task) or per daily report as a whole?"* | *"The mentor tracks attendance and tasks themselves; the student can also include them in their daily report."* |
| **Q25** | *"What scale do you score on day-to-day (1–5, 1–10, percentage)?"* | *"Day-to-day scoring is unnecessary."* |

Q15 describes `countsTowardEvaluation` almost word for word and declines it.
Q16 places the mentor's unit of work at the daily report, not the submission.
Q25 is the answer FR-26 was written from.

**Q25 alone would be arguable.** It was asked inside the AI design — a few
answers earlier the stakeholder had said the AI *"sets the score completely;
the mentor can override it if they disagree"* — so *"unnecessary"* could mean
*"unnecessary, because the AI does it monthly,"* in which case removing the AI
reopens the question rather than settling it. **Q15 is not arguable**: it is
about mentor approval granularity, mentions no AI, and was answered no.

Against that stands `irp-consolidation-task-list.xlsx`, which the spec quotes
as asking for exactly this behaviour (*"nothing counts unless the mentor both
approves it and ticks it"*). That file is **not in this repository** and cannot
be checked here. So the branch overrode a "no" that is verifiable, three times
over, on the strength of a "yes" that is not.

## Decision
**The stakeholder interview governs.** The per-submission scoring surface is
withdrawn in full: the three `Entry` columns and their migration, the review
endpoint and its `EntryReview` schema, the `StudentEntry`/`StudentDaySummary`
mapping split, the per-entry review control, and the seeded review. FR-22/23/24
and FR-26 stand as written. O-5 blocks the evaluation slice again, as it did
before ADR-0026.

`mentorFeedback` is withdrawn with the rest. The interview never declined it —
it was never asked about — but Q16 puts mentor annotation at the daily-report
level and `MentorDayRecord.note` already provides it there. A per-entry
feedback box alone would be a half-feature at the granularity Q16 steered away
from, mapping to no FR.

This ADR does **not** decide that per-submission review is wrong. It decides
that **this repository is not the place the conflict gets resolved.**
`docs/interview-and-prd.md` §4.2 reserves requirement-level changes to the
decision owner, and two sources disagreeing at requirement level is exactly
that. O-18 now records the conflict and what each side says, so the question
put to the stakeholder is the real one.

Four changes from the withdrawn branch are **kept**, because none of them
touch scoring and none conflicts with any interview answer: rejecting a
`MentorDayRecord` write for a future date (`FutureDayRecordError`, 400);
defaulting a day range's `to` to today rather than the cycle's end; grouping
the Review page into "Needs review" and "Evaluated"; and dropping the sidebar's
"Review" entry, which pointed at a landing page with no student directory.

## Rejected alternatives
1. **Merge as built, with O-18 still outstanding.** Ships the specific
   behaviour the stakeholder was asked about and declined, on an unverifiable
   newer source, into a scoring model the spec's own §10 says is expensive to
   reverse once mentors have scored real student work. The asymmetry decides
   it: shipping and being wrong costs real scored submissions, waiting and
   being wrong costs a rebuild of a branch that is preserved in history.
2. **Keep the schema columns, remove only the UI.** Leaves three columns and a
   migration in `main` carrying a scoring model nothing writes to and no FR
   describes — the dormant-feature shape `CLAUDE.md` rejects for the dev auth
   bypass, and dead weight for whoever designs the real aggregation later.
3. **Keep `mentorFeedback`, drop only `score` and the tick-box.** Tempting,
   since the interview never declined feedback and the planned student-feedback
   work depends on it. Rejected: it maps to no FR, sits at the granularity Q16
   steered away from, and duplicates `MentorDayRecord.note`. If per-entry
   feedback is genuinely wanted it should arrive with the stakeholder's answer
   to O-18, not ahead of it.
4. **Ask the stakeholder first and leave the branch unmerged meanwhile.**
   Procedurally the most cautious, and it preserves the work in the working
   tree rather than in history. Rejected because it leaves `main` unable to
   take the four unrelated fixes without dragging the scoring model along, and
   because an unmerged branch decays against a moving `main`. The work is
   recoverable from git either way; O-18 is what carries the question forward.

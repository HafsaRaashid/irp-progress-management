# ADR-0028: A daily report is born In Review

## Status
Accepted (2026-09-25). Records **O-19** (`docs/interview-and-prd.md` §5), which
FR-18's text depends on.

## Context
FR-18 reads: *"A day's submission moves through **Submitted → In Review →
Evaluated**."* The mentor's Review page implemented that literally — a
"Start review" button moved a day from Submitted to In Review, and only then
did "Mark evaluated" appear.

The stakeholder interview, §4.4, names two states, not three:

> **Q14** — *"Can the admin reject an item… What states does an entry go
> through?"*
> — *"No reject step — entries go from 'in review' to 'evaluated'."*

Nothing in the interview asks for a state before "in review", and nothing asks
a mentor to announce that they have started. In practice "Start review" was a
click that changed no permission and unlocked no capability — the day was
equally editable either side of it. It recorded an intention, not a fact.

It was also the only place `inReviewAt` was set, which made that column mean
"when a mentor happened to click" rather than "when this became reviewable" —
so for any day nobody clicked, it was simply null.

This ADR is the mirror image of [ADR-0027](0027-stakeholder-interview-governs-over-consolidation-task-list.md):
there, the derived FR table permitted something the interview declined, and the
interview won. Here the derived FR table requires something the interview never
described, and the interview wins again. The principle is the same one either
way — the primary record outranks the document derived from it — but it is
worth saying plainly that consistency, not convenience, is why this change goes
the direction it does.

## Decision
A `DailyReport` is created with status `IN_REVIEW`, with `inReviewAt` stamped
at the student's submission instant. `SUBMITTED` is removed from the
`DailyReportStatus` enum entirely; existing rows are migrated, and `inReviewAt`
is backfilled from `createdAt` for rows that never got a click. The one
remaining transition is `IN_REVIEW → EVALUATED`, and `TransitionRequest.to`
admits `Evaluated` alone — so `{ to: "InReview" }` is now a **400 at the
contract**, not a 409 from a handler. Forward-only is enforced by the shape of
the request rather than by a runtime status comparison.

`ReviewProgress` loses its `submitted` counter, which would otherwise be
permanently 0. The Cycles page reads *"N evaluated · N to review"*.

**FR-18's text no longer describes the system**, and §4.2 reserves FR wording
to the decision owner. Logged as **O-19** rather than rewritten here, and
marked `// ASSUMPTION: O-19` at the schema, repo, and transition-control level.
Unlike O-18, the evidence points the same way as the implementation — but it is
still the stakeholder's sentence to change, and the point of ADR-0027 is that
this project does not quietly edit the requirement to match the code.

## Rejected alternatives
1. **Keep `SUBMITTED` in the enum, just never create it.** A one-line default
   change instead of a Postgres type swap. Rejected: it leaves a value in the
   schema that nothing can produce and nothing can reach, which the next
   person has to read the repo to discover is dead. The generated Prisma
   client, the OpenAPI `ReportStatus` enum and every exhaustive `switch` would
   all keep a branch for a state that cannot occur — the dormant-code shape
   `CLAUDE.md` already rejects for the dev auth bypass.
2. **Keep the three states and auto-advance on submission.** Create the report
   `SUBMITTED`, then immediately transition it. Rejected as ceremony with a
   race: two entries on the same day would both attempt the advance, and the
   loser's `updateMany` would find nothing — recoverable, but only because the
   result is discarded, which is exactly the kind of "harmless" swallowed
   failure that stops being harmless when someone later reads the count.
3. **Keep "Start review" as an explicit mentor acknowledgement.** Defensible if
   the mentor's own sense of "I have picked this up" mattered to anyone —
   a second mentor seeing a colleague already on it, say. Rejected because
   Admins share access across all batches with no assignment model (v1
   non-goal: no task assignment), so there is no second mentor to signal to,
   and the interview describes no such need.
4. **Drop `inReviewAt` along with the state.** It is no longer a distinct
   event from creation. Rejected: it is the natural place a future "how long
   did review take" measure reads from, and keeping a column whose meaning is
   now uniform across every row costs nothing, where re-adding it later would
   cost a backfill nobody has the data for.

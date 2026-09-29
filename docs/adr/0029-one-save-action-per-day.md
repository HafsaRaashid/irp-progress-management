# ADR-0029: One save action per day on the Review page

## Status
Accepted (2026-09-25). Builds on
[ADR-0028](0028-a-report-is-born-in-review.md). Records **O-20**
(`docs/interview-and-prd.md` §5), which FR-18/FR-20's wording depends on.

## Context
ADR-0028 removed the "Start review" step, leaving a day with one explicit
mentor control, "Mark evaluated", alongside the attendance/tasks form. Two
problems remained.

**The word.** Mentors no longer score anything — per-submission scoring was
withdrawn in [ADR-0027](0027-stakeholder-interview-governs-over-consolidation-task-list.md),
and "evaluation" now means only the monthly performance index (FR-23), which
nothing produces because O-5 is unresolved. A button reading "Mark evaluated"
therefore described a thing the mentor was not doing. What it actually did was
lock the day (FR-20) — which the interview does ask for, at **Q17**
(*"approval decisions won't change later"*).

**The second click.** Finishing a day was a separate action from recording it,
but there is no case where a mentor records attendance and then does *not*
want the day finished — except one, below, which is a safety case rather than
a workflow choice.

The page had also accumulated 15 near-identical ~300px panels: a section
label, a helper sentence and a full attendance form repeated per row, roughly
4,500px of scroll for one student's cycle.

## Decision
**One action per day: "Save record".** It writes the `MentorDayRecord`
(FR-19) and, when the day is already closed to the student, also transitions
the report to `EVALUATED` (FR-18/FR-20). The word "Evaluated" no longer
appears on the mentor's screen; the pill and the filter both say **"Saved"**.

**A day inside the student's submission window is never finished.**
`canSubmitFor` (`packages/core/src/submission-window.ts`) decides this
server-side, per row. Finishing locks the day against further entries, and
the lock is irreversible (FR-20) — so a mentor recording today's attendance
in the morning would otherwise take the rest of the student's day away from
them. Today and the previous weekday are consequently saved without being
finished, and stay in the outstanding pile until their window closes, which
is correct rather than a limitation.

**The two writes are two calls, ordered so failure is safe.**
`upsertDayRecord` then `transitionDailyReport`, from the web Server Action.
If the transition fails the record is still saved and the day stays *open* —
a day wrongly left open can be finished again, where a day wrongly locked
cannot be reopened.

**Empty weekend days are not rendered.** A Saturday or Sunday with no entry
carries no obligation (FR-12) and never enters a denominator (FR-33), so
"No entry recorded." on one invented work that does not exist. A weekend that
*does* hold an Extra entry still shows.

**Density.** The per-row section label and helper sentence are said once,
above the list; day titles became real `<h2>`s (the page previously had a
single heading, so a screen-reader user could not skim it); and the duplicate
per-entry "On time" pill now renders only when it says something the day's own
pill does not — i.e. only for Late or Extra.

FR-18 and FR-20 describe a transition a mentor performs explicitly. They now
describe something folded into another action. Logged as **O-20** rather than
rewritten, per §4.2.

## Rejected alternatives
1. **Two button labels — "Save record" and "Save & finish day".** Built and
   reverted the same day. It described the mechanism honestly, but put two
   different buttons in one column, so the mentor had to read each row's
   button before trusting it. The action is the same every time; what differs
   is whether the day was still open, which the confirmation line and the
   row's own pill both report afterwards.
2. **Finish the day on save unconditionally.** One rule, no conditions, and
   what was first asked for. Rejected on the concrete case visible on the
   page: the top row is today, and locking it would end the student's
   submission window mid-day with no way back.
3. **Keep a separate finish action, just renamed.** Preserves the one-action-
   one-effect property and avoids a button with a conditional side effect.
   Rejected because no workflow reaches "recorded but deliberately unfinished"
   — the only reason to leave a day open is the submission window, which the
   system can determine itself and does.
4. **Two columns (outstanding beside finished) instead of a filter.** At the
   1280px floor that is ~495px per column for prose plus a form, and the two
   sides are never balanced — all-left early in a cycle, all-right late. A
   filter keeps full width and reduces the common case to no scrolling rather
   than less.
5. **Counts inside the filter chips.** "In review 11" ran the label and the
   figure together with nothing between them. Moved to one line below, where
   every figure stays readable whichever chip is active.

## Consequence worth knowing
A **weekend day holding an Extra entry can never be finished**: it has a
report, so it counts as outstanding, but weekends carry no `MentorDayRecord`
(the API 400s — "there is nothing to attend"), so the only action that
finishes a day is not available on one. Those rows accumulate in the "In
review" filter. Left deliberately, because the alternatives — a weekend-only
finish control, or excluding weekends from the filter — both need the O-11
question answered first (whether weekend entries should exist at all; the
interview's **Q9** says *"weekdays only"*).

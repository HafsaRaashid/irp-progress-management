# ADR-0033: Meeting minutes as a supplementary, optional Entry field

## Status
Accepted (2026-10-06). Implements an extension of FR-17. Relates to
[O-18](../interview-and-prd.md) and its two governing ADRs,
[0026](0026-mentor-scored-submissions-over-ai-scored-cycles.md) (withdrawn) and
[0027](0027-stakeholder-interview-governs-over-consolidation-task-list.md).

## Context
A student asked to add "time spent in meetings" to the daily update. Nothing in the system records
that today. The closest existing requirement is **FR-17**: *"A student may optionally include
attendance and task notes in their daily update. This is supplementary — the mentor's own record is
authoritative (FR-19)."* FR-17 names **notes** — qualitative, free text — not a structured, numeric
field, so a literal "minutes in meetings" number is a narrower, more specific instance of what FR-17
already licenses, not something it states outright.

This matters because the project has a direct cautionary precedent for exactly this kind of
addition. **O-18** records that a per-submission scoring model was built in full, under ADR-0026,
and then withdrawn before merge — ADR-0027 superseding it — because the stakeholder interview
explicitly declines day-to-day, per-entry metrics: Q25 asks directly "what scale do you score on
day-to-day?" and the answer is "day-to-day scoring is unnecessary." A numeric field on `Entry` is a
different thing from a score, but it is the same *shape* of change — structured, per-entry,
quantitative data the stakeholder never asked for — and the lesson O-18 leaves behind is to be
explicit about what a new field is *for* before building it, rather than let a reasonable-sounding
addition quietly become a metric nobody asked for.

## Decision
**`meetingMinutes` is added to `Entry` and `EntryCreate`: an optional integer, 0–480 (8 hours),
nullable in the stored and returned shape, never required.**

It is scoped identically to FR-17's attendance/task notes:

- **Supplementary context, shown to mentors, never used in evaluation.** It travels through the same
  `Entry` schema the mentor's review page already reads (`toApiEntry`, shared by
  `GET /me/days` and the review listing — no second type, no second mapping), so it is visible
  wherever an entry is visible, with no separate plumbing. It is not read by `dashboard-service.ts`,
  not part of `CycleCounts`, and not a factor in `complianceRate` or any evaluation output — the same
  boundary O-18 drew around scoring applies here.
- **Null, not zero, when unreported.** A student who never touched the field reported nothing; a
  student who explicitly entered 0 said something different and true. Collapsing the two to the same
  value would make "I had no meetings today" indistinguishable from "I didn't answer", which is
  exactly the `mentorNote`-null-vs-empty-string distinction this codebase already relies on elsewhere
  (`day-service.ts`'s `mentorNote` mapping) for the identical reason.
- **Capped at 480 minutes (8 hours).** A sane ceiling for one day's meetings, validated both
  client-side (the composer's `min`/`max`) and server-side (the AJV body schema and the OpenAPI
  `maximum`), so a typo cannot silently become a number nothing downstream was designed to hold.

The spec change is additive only: `EntryCreate.meetingMinutes` is optional, and `Entry.meetingMinutes`
is required-but-nullable, matching the house pattern for "this field always travels, its value may be
absent" (the same shape `mentorNote` and `reportStatus` already use). No existing caller of either
schema needs to change for the addition to be backward-compatible in practice, though every existing
example in the spec was updated to include it, since `additionalProperties: false` and a joined
`required` array mean a partial document cannot lint clean (`CLAUDE.md`'s "a partial OpenAPI document
cannot lint clean" rule).

## Consequences
- A new, reversible Prisma migration (`add_meeting_minutes_to_entry`) adds a nullable `Int` column.
  Nothing reads or writes it until a value is explicitly supplied.
- `packages/types` and `packages/client` regenerate from the spec change, as always — no hand-editing
  either.
- The field is genuinely optional end-to-end: a student who never sees or uses it experiences no
  change in behaviour, no new required step, and no new failure mode. The composer's test suite
  asserts this directly (`"not required to submit"`).
- If evaluation ever needs quantitative meeting data, that is a **new decision**, not an extension of
  this one — this ADR's scope is deliberately bounded to "supplementary, shown, never scored," and
  widening it needs its own ADR naming why the O-18 boundary no longer holds.

## Rejected alternatives
1. **Ask the student to mention it in the existing free-text body.** Zero schema change, ships
   immediately, carries no risk of ever being mistaken for a metric. Rejected because it was not what
   was asked for — a sentence buried in prose is not a field a mentor can scan, and the student
   specifically wanted something addable in the submission form, not a style note about how to phrase
   the update.
2. **A field that exists on `Entry` but is never surfaced to mentors — purely personal, cosmetic
   record-keeping.** Would sidestep any question of it becoming an implicit metric, since nobody but
   the student who wrote it would ever see it. Rejected because the student's own stated intent was
   for it to be visible alongside the entry, and a field that round-trips through the API but is
   deliberately hidden from the one other audience the system has is a strange, hard-to-justify
   shape for a feature — "stored but shown to no one" is usually a sign the field belongs in a
   personal notes app, not this one.
3. **A separate `Meeting` entity — one row per meeting, with its own duration, rather than one total
   on the day's entry.** More expressive (multiple meetings, each timed separately) and more honest
   to how a day might actually be structured. Rejected as disproportionate: FR-17's own framing is a
   single supplementary note per day, not a sub-resource, and a new entity would need its own CRUD
   surface, its own spec section, and its own review-page rendering for a feature whose entire
   justification is "optional context, never scored." A single integer answers the question that was
   actually asked.

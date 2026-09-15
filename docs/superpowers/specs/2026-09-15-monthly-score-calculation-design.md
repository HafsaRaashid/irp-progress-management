# Monthly Score Calculation — Design

**Date:** 2026-09-15
**Author:** Mohaideen Abdullah (spec lead, with Claude Code)
**Status:** Draft — pending review by Danella De Cruz before Hafsa Raashid begins implementation
**Feeds:** a new plan, one branch and one PR, in `HafsaRaashid/irp-progress-management`. Fourth of
the task-list sequence (task 7). **Depends on** the per-submission-review spec
(`2026-09-15-per-submission-review-design.md`, tasks 1–4) merging first — this spec's `taskScore`
figure is computed from `Entry.score`/`countsTowardEvaluation`. Task 6 (reports + PDF) depends on
this spec in turn.
**FRs:** Replaces FR-22, FR-23; revises FR-24 (no AI score to override — see §2); FR-31/32 (winner
computation) continue to read from `Evaluation`, now populated differently
**Governs / closes:** none. Opens **O-19** (§2) and finalises the ADR the per-submission-review
spec already flagged as owed regarding `Override`'s fate (§9)
**ADRs owed by this slice:** one — see §9, extending the one the prior spec named

---

## 1. Scope and decision record

| # | Decision | Choice |
|---|---|---|
| D1 | `Evaluation` schema shape | **Replace the 5-column rubric with 3 figures**: `attendance` (Decimal, % of required days attended per `MentorDayRecord.attended`), `taskScore` (Decimal, mean `Entry.score` across entries in the cycle where `countsTowardEvaluation = true`), `completion` (Decimal, % of required days with `MentorDayRecord.tasksCompleted = true`). Drop `contributionInitiative`, `effortTime` (no data source without AI), `summary`, `modelVersion` (no AI to attribute either to). Rejected: keeping all 5 columns and filling the two orphaned ones with a placeholder — a graded rubric column with a fabricated value is worse than one honestly absent. |
| D2 | Combining weights | **Equal thirds** — attendance 33%, taskScore 34%, completion 33% (summing to 100 with the extra point on taskScore, arbitrarily, since three-way even division doesn't divide evenly). Logged as **O-19**, a stated assumption pending mentor confirmation — no source specifies weights for these three figures; FR-23's 20/25/25/10/20 was for five different criteria. |
| D3 | A cycle with zero counted entries | **`taskScore` is `null`**, not zero. A month where nothing was marked as counting toward evaluation is "no task score recorded," not "scored zero" — treating it as 0 would tank `performanceIndex` for a case that might simply mean the mentor hadn't finished reviewing yet. `performanceIndex` itself becomes `null` too when any of the three inputs is `null` — a partial evaluation is not silently averaged into a number that looks complete. |
| D4 | When the calculation runs | **On demand, computed at read time** (a dashboard-service-style aggregate query), not a batch job that writes `Evaluation` rows at cycle close. Rejected: a scheduled job — this system has no job scheduler today (Container Apps + Fastify, no cron infra), and a read-time calculation is always current even if a mentor scores an entry after the cycle nominally closed (there is no hard cutoff on scoring in this design — FR-20 only locks the *day*, not retroactive whole-cycle recomputation). |
| D5 | Storing the computed result | **Not stored as a persistent `Evaluation` row per cycle** — computed fresh each time it's requested, from `Entry`/`MentorDayRecord` data that already exists. Rejected: writing an `Evaluation` row at some trigger point — there is no natural trigger without a job scheduler (D4), and a stored row that can drift from the underlying entries (e.g. a mentor rescoring after the row was written) is a staleness bug waiting to happen. The `Evaluation` table's *shape* still changes (D1); what changes here is that nothing writes to it automatically — `Override` (§9) is the only thing that still writes a real row. |

**Out of scope.** The PDF report itself (task 6, next spec, consumes this one's output). Winner
computation (FR-31/32, Plan 10, not started) — this spec makes `performanceIndex` computable, it
does not build the "highest score wins" logic that reads it, though §9 notes what that logic
inherits from D3's `null` handling.

## 2. The FR problem, stated directly

This spec **replaces** FR-22 ("AI generates a summary") and FR-23 ("AI scores... producing a
performance index") outright — there is no summary, and the performance index is now a
deterministic average, not an AI output. It **revises** FR-24: "the AI-produced score is the
score of record; an override stores the new score, the original AI score, and reason" no longer
holds a meaningful "original AI score," since there is no AI score (see §9 for what `Override`
becomes).

This is the direct continuation of **O-18** (the per-submission-review spec's open point,
"replace AI-scored cycles with mentor-scored submissions"). That spec logged O-18 for the
*principle*; this spec adds **O-19** for the *specific weighting formula* (D2) it implements,
since O-18 established the pivot but did not specify numbers.

**Action:** implement behind the stated assumption that equal-thirds weighting (D2) is acceptable
pending confirmation, marked `// ASSUMPTION: O-19` at the calculation's entry point. This spec
does not proceed without O-18 already having been accepted by whoever owns that sign-off — it is
built entirely on that premise.

## 3. Calculation

A new function in `packages/core` (matching the existing precedent that cycle/date arithmetic
lives there, not in a service) or `apps/api/src/services/evaluation-service.ts` (a new service,
following the `dashboard-service.ts`/`day-service.ts` pattern) — the calculation itself is pure
domain arithmetic, but it needs `MentorRecordRepo`/`EntryRepo` reads to gather its inputs, which
places it at the service layer, not `packages/core`:

```ts
interface MonthlyScore {
  attendance: number | null;      // 0-100
  taskScore: number | null;       // 0-100
  completion: number | null;      // 0-100
  performanceIndex: number | null; // weighted per D2, null if any input is null (D3)
}

function computeMonthlyScore(cycle: CycleBounds, records: MentorDayRecordShape[], entries: EntryRecord[]): MonthlyScore
```

- **`attendance`** = `(records.filter(r => r.attended).length / cycleWorkingDays(cycle).length) *
  100`, using the same `requiredDays` denominator `dashboard-service.ts`'s `CycleCounts` already
  computes for compliance rate — same pattern, different numerator.
- **`completion`** = identical shape, numerator `tasksCompleted` instead of `attended`.
- **`taskScore`** = mean of `entries.filter(e => e.countsTowardEvaluation).map(e => e.score)`; `null`
  if that filtered list is empty (D3).
- **`performanceIndex`** = `attendance * 0.33 + taskScore * 0.34 + completion * 0.33`, or `null` if
  any of the three is `null` (D3) — never a partial weighted sum treated as complete.

A day with `MentorDayRecord` missing entirely (mentor never recorded that day) is excluded from
both the attendance and completion numerator **and** denominator consistently — this is the same
edge case `dashboard-service.ts` already has to handle for compliance rate, so the implementation
should reuse that file's existing per-day iteration helper rather than write a second version.

## 4. API surface

New endpoint, following the existing dashboard-endpoint pattern:

```
GET /api/v1/students/{id}/monthly-score?cycle={n}
```

Admin-only (mentor reviewing a student) — student-facing exposure of this figure is explicitly
**not** requested by task 7 ("display attendance, task score and completion for each month" reads
in context as the mentor-facing reports surface task 6 builds); if a student-facing version is
wanted later, that's its own spec decision given the standing "no student-visible score" non-goal,
not something to fold in here by default.

Returns `MonthlyScore` (§3) plus the cycle bounds, matching the existing `CycleView`/`CycleCounts`
response shape conventions in `dashboard-service.ts`.

## 5. Prisma migration

```prisma
model Evaluation {
  id               String   @id @default(uuid())
  cycleId          String
  studentId        String
  attendance       Decimal  @db.Decimal(5, 2)
  taskScore        Decimal? @db.Decimal(5, 2)
  completion       Decimal  @db.Decimal(5, 2)
  performanceIndex Decimal? @db.Decimal(5, 2)
  createdAt        DateTime @default(now()) @db.Timestamptz(3)

  cycle    Cycle     @relation(fields: [cycleId], references: [id])
  student  User      @relation(fields: [studentId], references: [id])
  override Override?
  awards   Award[]

  @@unique([cycleId, studentId])
}
```

Since D5 means nothing writes this table automatically, **this migration changes the shape but the
table stays empty in practice** until either an override is recorded (§9) or a future plan adds a
"snapshot this cycle's evaluation" action — out of scope here, flagged so it isn't assumed to
happen implicitly.

## 6. Non-goal check

**"No student-visible score, rank, or leaderboard."** Holds — §4 scopes the read endpoint to
mentor-only. If this figure is ever wanted on `My month`, that decision revisits this non-goal
explicitly in its own spec, the same way the per-submission-review spec revisited it for `score`.

## 7. Testing

| Level | Case |
|---|---|
| Unit | `computeMonthlyScore` with full attendance/completion and 2+ counted entries produces the expected weighted `performanceIndex` |
| Unit | Zero counted entries → `taskScore: null`, `performanceIndex: null` |
| Unit | A day with no `MentorDayRecord` at all is excluded from both numerator and denominator |
| Unit | An entry with `countsTowardEvaluation: false` is excluded from the `taskScore` mean even if scored |
| Unit | `attendance`/`completion` match the existing `dashboard-service.ts` compliance-rate denominator for the same cycle (regression parity between the two calculations) |
| Integration | `GET /students/:id/monthly-score` returns 401/403 for a non-admin caller |
| Integration | `GET /students/:id/monthly-score?cycle=` for a cycle with no data at all returns all-`null` fields, not a 500 |

## 8. Documentation to update

- `docs/interview-and-prd.md` §3 — annotate FR-22/23 as replaced, FR-24 as revised (pending O-18's
  confirmation, per the prior spec)
- `docs/interview-and-prd.md` §5 — add **O-19** (equal-thirds weighting, pending confirmation)
- `handoff.md` §1 — dated entry; note Plan 9 (T-17, "AI monthly evaluation... blocked on O-5") is
  effectively retired by this pivot, not merely unblocked — flag this explicitly since `handoff.md`
  currently lists it as "Blocked," not "Superseded"

## 9. ADRs owed, and `Override`'s fate

Per `CLAUDE.md`, a decision with a plausible rejected alternative needs an ADR naming at least
two, written **before** implementation. This extends the ADR the per-submission-review spec
already flagged as owed (§9 there) rather than opening a second one — same underlying decision
(mentor-scored over AI-scored), this spec just supplies the concrete replacement shape:

**ADR — Deterministic 3-figure evaluation over the 5-criterion AI rubric**, covering both specs'
worth of decisions. Rejected alternatives: keep the 5-column schema with placeholders for the
orphaned two (D1's reasoning); a stored/batch-computed `Evaluation` row instead of read-time
calculation (D4/D5's reasoning — no scheduler exists, and a stored row risks staleness against
live entry rescoring).

**`Override`'s fate, decided here:** `Override` keeps its shape (`newScore`, `originalScore`,
`reason`) but `originalScore` now means "the computed `performanceIndex` at the time of override,"
not "the AI's score" — the field is repurposed, not retired, since a mentor may still want to
correct a computed monthly figure (e.g. a `MentorDayRecord` entered wrong after the fact) with a
reason on record. This is the one place D5's "nothing writes `Evaluation` automatically" meets a
real write: recording an override is what actually populates a row in the table, snapshotting the
computed figures at that moment rather than leaving them to keep changing underneath a stored
correction.

## 10. Risks

| Risk | Handling |
|---|---|
| O-19's weights are rejected in favor of different ones | Cheap to change — one arithmetic line in `computeMonthlyScore`, no schema impact, since weights aren't stored anywhere. |
| A future plan needs a stored snapshot per cycle (e.g. for historical reporting after a student's data changes) | D5 explicitly defers this. `Override`'s write path (§9) is the closest thing to a snapshot today; if broader snapshotting is needed later, it's a new spec's decision, not assumed here. |
| Task 6's PDF report needs a different shape than `MonthlyScore` provides | Flagged as a dependency risk — task 6's spec should confirm `MonthlyScore` is sufficient before design, not discover a gap mid-implementation. |
| Plan 9 (T-17) in `handoff.md` still reads "Blocked on O-5," misleading a future reader into thinking it just needs O-5 resolved to proceed | §8 calls out updating this to "Superseded," not just leaving it as blocked. |

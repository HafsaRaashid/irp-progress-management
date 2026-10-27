# ADR-0019 — Dashboard cycles are addressed by engine-computed sequence

**Status:** Accepted · **Date:** 2026-08-03 · **Plan:** 7, Task 2

## Context

Two dashboard endpoints have to name a cycle: `GET /batches/{id}/dashboard/summary`
takes `?cycle=`, and both responses report which cycle they describe. Three
addressing schemes were available, and the `Cycle` table already exists
(materialised by `CycleRepo.ensureCycles`, so `Evaluation` has a stable FK).

## Decision

A cycle is addressed by its **1-based sequence within the batch**, computed by
`@irp/core` (`cycleAt(batch, date).index`; bounds from `cycleBounds`). The
dashboards never read or write the `Cycle` table.

> **Amended by [ADR-0035](0035-cycles-are-cut-from-the-batch-dates.md):** cycles are
> now cut from the batch's own start and end dates, not fixed 10th-to-9th
> windows. This ADR originally named `cycleFor`/`firstEvaluatedCycleStart`/
> `cycleContaining`/`shiftCycle`, which no longer exist.

`seq` is nullable in every response: a batch that has not started yet has no
sequence for today, and FR-27 says a student who joins partway through a cycle
is not evaluated for it. `null` is the honest answer, and the UI renders a
"starts on …" state rather than a fabricated "Cycle 0".

## Rejected alternatives

**`?cycleId=<uuid>` against the materialised `Cycle` row.** Referentially tidy,
and it is what `Evaluation` will use. Rejected because the rows are a *cache* of
the engine's output (spec §3), populated by `ensureCycles` — so a `GET` would
either 404 on a batch nobody had seeded yet, or have to materialise rows as a
side effect. A read endpoint that writes is a worse trade than a derived integer.

**`?from=&to=` date range.** Reuses the shape `/me/days` already has. Rejected
because it lets a caller invent a window that is not a cycle, and every figure
downstream — "Month N of 6", cycle compliance, the ribbon's day count — is only
meaningful on a real 10th-to-9th boundary. Accepting arbitrary ranges would make
a wrong denominator a caller error instead of an impossibility.

## Consequences

Dashboards and evaluations will address cycles differently — sequence here, row
id in Plan 9. That is deliberate: the sequence is a coordinate, the row is a
foreign key, and `(batchId, seq)` is unique, so the two are convertible in one
lookup whenever Plan 9 needs it.

# Plan 9 — Per-Submission Review Implementation Plan

**Goal:** Let a mentor score an individual `Entry` (0-100), leave feedback, and flag whether it
counts toward the monthly evaluation — replacing the AI-scored-cycle pipeline (FR-22-24) that O-5
(undecided AI provider) has blocked indefinitely. This is tasks 1-4 of the
irp-consolidation-task-list.xlsx sequence; task 5 (student feedback visibility) depends on this
plan merging first.

**Architecture:** `Entry` gains three columns (`score`, `mentorFeedback`, `countsTowardEvaluation`)
— no new model, per the spec's D1 (`Entry` becomes the submission, not a parallel `Submission`
model). One new admin-only endpoint, `PUT /api/v1/entries/{id}/review`, follows the existing
full-replace-PUT convention (`upsertDayRecord`) and reuses the existing `LockedDayError`/409 lock
check every other per-day mentor write already has (ADR-0016's advisory lock). The existing shared
`toApiEntry`/`toApiDay` mapping (used by both the mentor's `/students/{id}/days` and the student's
own `/me/days`) is split in two so a score never reaches a student response — this is the spec's
one correctness-critical move (§4), caught in the spec's own review pass.

**Tech Stack:** Fastify + TypeScript, Prisma 7 (existing), OpenAPI 3.1 (existing), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-per-submission-review-design.md` — all sections.
**ADR:** `docs/adr/0026-mentor-scored-submissions-over-ai-scored-cycles.md` — written and accepted
before this plan's first task, per the spec's §9.
**Open point:** **O-18** (`docs/interview-and-prd.md` §5) — mentor sign-off outstanding. Every task
below marks its O-18-dependent code `// ASSUMPTION: O-18`, per CLAUDE.md's open-points policy.

**Branch:** `feat/plan-9-per-submission-review`. One branch, one PR.

**FRs:** Extends FR-10, FR-11, FR-18, FR-19, FR-20. Supersedes FR-22, FR-23, FR-24. Puts FR-26 in
direct conflict (flagged, not silently rewritten — see the FR table annotation).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Students never receive `score` or `countsTowardEvaluation`, in any form.** Not `null`, not
  `undefined` — an absent key. This is the spec's central risk (§10) and its own non-goal check
  (§6, §5's D2). A test asserting the JSON body has no `score` key at all (not just a falsy one)
  is required wherever `/me/days` is touched.
- **`score` and `mentorFeedback` are set together, in one `PUT`, never three separate `PATCH`es**
  (spec §3) — matching `DayRecordUpsert`'s existing full-replace convention.
- **Locked days are immutable.** Once a `DailyReport` is `EVALUATED`, a review write throws the
  existing `LockedDayError` (409) — the same mechanism `entry-repo.ts`'s `addEntry` and
  `absence-repo.ts` already use. Do not invent a second lock-check pattern.
- **`countsTowardEvaluation` defaults `false`** and only becomes `true` via an explicit mentor
  tick in the same write that sets the score (spec D2/§3) — never inferred from "a score exists."
- **The spec change and the operation using it land in the same task** (CLAUDE.md's house rule —
  `no-unused-components` flags an unreferenced schema, and a partial OpenAPI document cannot lint
  clean). Task 2 below is deliberately one task for this reason: spec, generation, handler, and
  mapping split all together.
- **`// ASSUMPTION: O-18`** on the `Entry.countsTowardEvaluation`/`score`/`mentorFeedback` columns
  in `schema.prisma`, on the new route handler, and on the `EntryReview`/`Entry` schema block in
  `spec/openapi.yaml` — this whole slice rests on O-18, which is explicitly *not* mentor-confirmed
  yet (spec §10).
- **Conventional commits, one per task.**

### Environment

```powershell
$env:IRP_DB_PORT = "5433"
docker compose -f apps/api/docker-compose.yml up -d
$env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"

pnpm install
pnpm generate
pnpm --filter @irp/core build
pnpm --filter @irp/client build
pnpm --filter @irp/api exec prisma generate

pnpm --filter @irp/api run db:seed   # only needed before manual/browser verification

cd apps/api; pnpm test
cd ../web; pnpm --filter @irp/web build   # required — this plan touches apps/web
```

This plan touches both `apps/api` and `apps/web`. `pnpm --filter @irp/web build` (not just
`typecheck`) is part of the required verification set, per the Plan 3 hard-won facts in
CLAUDE.md.

### File structure

| File | Responsibility | Task |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Modify — `Entry` gains `score Int?`, `mentorFeedback String?`, `countsTowardEvaluation Boolean @default(false)` | 1 |
| `apps/api/prisma/migrations/<ts>_entry_review_fields/` | Create — via `prisma migrate dev` | 1 |
| `apps/api/src/seed/run-seed.ts` | Modify — at least one already-seeded entry gets a review write for one persona, so task 5's E2E case has something to observe | 1 |
| `spec/openapi.yaml` | Modify — `Entry` schema gains 3 fields; new `StudentEntry` schema (existing 6 fields only); new `StudentDaySummary` schema (`entries: StudentEntry[]`); `/api/v1/me/days` response ref moves to `StudentDaySummary`; new `EntryReview` request schema; new `PUT /api/v1/entries/{id}/review` operation (200/400/401/403/404/409/500) | 2 |
| `apps/api/src/routes/schemas.ts` | Modify — new `ENTRY_REVIEW_BODY` JSON Schema constant, mirroring `DAY_RECORD_BODY` | 2 |
| `apps/api/src/db/entry-repo.ts` | Modify — `EntryRecord` gains the 3 fields; `mapEntry` maps them; new `EntryRepo.reviewEntry(id, { score, mentorFeedback, countsTowardEvaluation })` method, same transaction/lock shape as `addEntry` | 2 |
| `apps/api/src/routes/entries.ts` | Modify — new `PUT /api/v1/entries/:id/review` handler (`requireAdmin`), reusing `entry-repo.ts`'s lock check; `toApiEntry` (student-safe) stays as-is; new `toApiEntryForMentor` added here alongside it | 2 |
| `apps/api/src/routes/me-days.ts` | Modify — `toApiDay` takes an entry-mapper parameter (default `toApiEntry`); `meDaysRoutes` calls it with the student mapper explicitly and returns `StudentDaySummary` | 2 |
| `apps/api/src/routes/reviews.ts` | Modify — `/students/{id}/days` calls `toApiDay(v, toApiEntryForMentor)` | 2 |
| `apps/api/src/server.ts` | No change expected — `reviewEntry` reuses the existing `entryRepo` dependency already in `ServerDeps` | 2 |
| `apps/api/test/entries-endpoint.test.ts` | Modify — `PUT /entries/:id/review` unit + integration cases (spec §7) | 2 |
| `apps/api/test/reviews-endpoint.test.ts` | Modify — `/students/:id/days` returns the 3 new fields | 2 |
| `apps/api/test/me-days-endpoint.test.ts` (or wherever `/me/days` is tested today) | Modify — response has no `score`/`countsTowardEvaluation` key at all | 2 |
| `apps/web/app/(app)/review/[studentId]/entry-review-form.tsx` | Create — score input, feedback textarea, counts-toward-evaluation checkbox; modelled on `day-record-form.tsx` | 3 |
| `apps/web/app/(app)/review/[studentId]/review-actions.ts` | Modify — new `reviewEntry` Server Action, modelled on `saveDayRecord` | 3 |
| `apps/web/app/(app)/review/[studentId]/page.tsx` | Modify — renders `EntryReviewForm` per entry, prefilled from the entry's current `score`/`mentorFeedback`/`countsTowardEvaluation` | 3 |
| `apps/web/e2e/*.spec.ts` (extend the existing mentor-flows spec) | Modify — review page: score/feedback/checkbox appear per entry, submit, persist on reload | 3 |
| `docs/walkthrough.md` | Modify — review page walkthrough gains the per-entry score/feedback controls | 4 |
| `handoff.md` | Modify — §1 dated entry on the AI-evaluation pivot; §2a Plan 9 row | 4 |

---

## Task 1 — Schema migration and seed data

**Do:**
1. `schema.prisma`: add to `Entry` —
   ```prisma
   model Entry {
     // ...existing fields unchanged...
     score                  Int?     // 0-100. Null until reviewed. ASSUMPTION: O-18.
     mentorFeedback         String?  // Free text. Null until reviewed. ASSUMPTION: O-18.
     countsTowardEvaluation Boolean  @default(false) // True only once scored AND explicitly ticked. ASSUMPTION: O-18.
   }
   ```
2. `pnpm --filter @irp/api exec prisma migrate dev --name entry_review_fields` against the local
   dev database (port 5433) to generate the migration, then `pnpm --filter @irp/api exec prisma
   generate`.
3. `apps/api/src/seed/run-seed.ts`: after the existing per-persona entry-seeding loop, add one
   review write (via a direct `prisma.entry.update` or a temporary local call shape — Task 2 adds
   the real `entryRepo.reviewEntry` this can switch to once it lands) for at least one already-late
   or on-time entry, for at least one student persona, with a non-null `score`, `mentorFeedback`,
   and `countsTowardEvaluation: true`. This is flagged as this plan's responsibility in both this
   spec's own risk table and the student-feedback-visibility spec's §8 — do not drop it.

**Test:**
- `pnpm --filter @irp/api exec prisma validate` passes.
- `pnpm --filter @irp/api run db:seed` completes without error and leaves at least one entry with
  a non-null `score` (manual check via `psql` or a one-off script is acceptable here — this is
  seed data, not application logic).

**Done when:** the migration applies cleanly to a fresh database (`prisma migrate reset` +
`db:seed`), and `pnpm --filter @irp/api exec tsc --noEmit` is clean.

## Task 2 — API contract, repo, route, and the mapping split

This is the plan's largest task, deliberately kept as one unit: the schema change and the
operation using it must land together (CLAUDE.md's house rule), and the mapping-function split is
what keeps `score` off `/me/days` — splitting it across commits risks a moment where one side is
wired and the other isn't.

**Do:**
1. `spec/openapi.yaml`:
   - `Entry` schema (`#/components/schemas/Entry`, currently ~line 1466): add `score` (nullable
     integer, 0-100), `mentorFeedback` (nullable string), `countsTowardEvaluation` (boolean) to
     `properties` and `required`. Examples on each, per CLAUDE.md's contract rules.
   - New `StudentEntry` schema: exactly the current (pre-this-plan) `Entry` shape — `id, entryDate,
     body, submittedAt, isLate, isExtra` — `additionalProperties: false`.
   - New `StudentDaySummary` schema: identical to `DaySummary` except `entries: StudentEntry[]`.
   - `/api/v1/me/days`'s `GET` response schema moves from `$ref: DaySummary` to
     `$ref: StudentDaySummary` (array items). `/api/v1/students/{id}/days` keeps `DaySummary`
     (mentor-facing, now carrying the 3 new `Entry` fields).
   - New `EntryReview` request schema: `required: [score, feedback, countsTowardEvaluation]`,
     `additionalProperties: false`, `score` (integer, minimum 0, maximum 100), `feedback` (string,
     maxLength 500 — matching `DayRecordUpsert.note`'s cap), `countsTowardEvaluation` (boolean).
     Examples on every field.
   - New operation `PUT /api/v1/entries/{id}/review`, `operationId: reviewEntry`, tag `Reviews`,
     path param `id` (uuid), request body `EntryReview`, responses `200` (`Entry`, the mentor
     schema) / `400` / `401` / `403` / `404` / `409` (use `transitionDailyReport`'s response block
     as the 409 template — `upsertDayRecord` has no 409 today) / `500`.
   - `pnpm spec:lint` must pass with zero warnings before continuing.
2. `pnpm generate` (regenerates `packages/types`, `packages/client`); `pnpm --filter @irp/client
   build`.
3. `apps/api/src/routes/schemas.ts`: `ENTRY_REVIEW_BODY`, mirroring `DAY_RECORD_BODY`'s shape —
   `required: ["score", "feedback", "countsTowardEvaluation"]`, `additionalProperties: false`,
   `score: { type: "integer", minimum: 0, maximum: 100 }`, `feedback: { type: "string", maxLength:
   500 }`, `countsTowardEvaluation: { type: "boolean" }`.
4. `apps/api/src/db/entry-repo.ts`:
   - `EntryRecord` gains `score: number | null`, `mentorFeedback: string | null`,
     `countsTowardEvaluation: boolean`.
   - `mapEntry` maps the 3 new columns.
   - `EntryRepo` interface gains `reviewEntry(id: string, input: { score: number; mentorFeedback:
     string; countsTowardEvaluation: boolean }): Promise<EntryRecord>`.
   - Implementation: same shape as `addEntry` — `prisma.$transaction(async (tx) => { look up the
     entry by id (404 via a new or existing `EntryNotFoundError` if missing); await
     lockStudentDay(tx, entry.studentId, entry.entryDate); look up the DailyReport by
     (studentId, entryDate); if status === "EVALUATED" throw LockedDayError(entryDate); else
     tx.entry.update({ where: { id }, data: { score, mentorFeedback, countsTowardEvaluation } }); })`.
5. `apps/api/src/routes/entries.ts`:
   - Add `toApiEntryForMentor(e: EntryRecord): ApiEntry` alongside the existing `toApiEntry` —
     identical, plus `score: e.score, mentorFeedback: e.mentorFeedback, countsTowardEvaluation:
     e.countsTowardEvaluation`.
   - New handler: `app.put<{ Params: {id: string}; Body: components["schemas"]["EntryReview"] }>(
     "/api/v1/entries/:id/review", { schema: { params: UUID_PARAM, body: ENTRY_REVIEW_BODY },
     preHandler: [app.authenticate] }, async (req) => { requireAdmin(req); const entry = await
     opts.entryRepo.reviewEntry(req.params.id, req.body); return toApiEntryForMentor(entry); })`.
6. `apps/api/src/routes/me-days.ts`:
   - `toApiDay(v: DayView, entryMapper: (e: EntryRecord) => ApiEntry = toApiEntry): ApiDaySummary`
     — default keeps every existing caller compiling unchanged; the return type becomes generic
     enough to serve both `DaySummary` and `StudentDaySummary` shapes (a `StudentEntry` is a subset
     of `Entry`'s TS type, so the student mapper's output is assignable either way — confirm this
     against the generated types once Step 2 regenerates them, and adjust the mapper's return
     annotation if not).
   - `meDaysRoutes`'s handler calls `toApiDay(v)` (student default) unchanged, but the route's
     declared return type in the OpenAPI schema is now `StudentDaySummary` — Fastify's response
     serialization is what actually strips extra keys if the mapper's TS type were ever wider than
     the response schema, so do not rely on that alone: `toApiEntry`'s return type must genuinely
     have no `score`/`countsTowardEvaluation` fields, not merely omit them at the object-literal
     call site.
7. `apps/api/src/routes/reviews.ts`: the `/students/{id}/days` handler's `toApiDay` call becomes
   `toApiDay(v, toApiEntryForMentor)` (import `toApiEntryForMentor` from `./entries.js`).

**Test** (spec §7, plus the split-specific case):
- `PUT /entries/:id/review` accepts a valid 0-100 score and sets `countsTowardEvaluation`.
- Rejects a score outside 0-100 with 400.
- Rejects a review write on an entry whose day is `EVALUATED` with `LockedDayError`/409.
- `countsTowardEvaluation` defaults `false` on entry creation, stays `false` until explicitly set
  `true` in a review write.
- Re-reviewing an entry (PUT again before Evaluated) fully replaces score/feedback/flag, not merges.
- `GET /students/:id/days` (mentor) returns the three new fields on each entry.
- `GET /me/days` (student) response has `score` and `countsTowardEvaluation` **absent as keys**,
  not merely `null` — assert on `Object.keys(...)` or the raw JSON string, not just a truthy check.
- Integration: student submits entry → mentor transitions day to InReview → mentor reviews (scores)
  the entry → mentor transitions day to Evaluated → a further review attempt 409s.

**Done when:** `pnpm --filter @irp/api test` passes in full; `pnpm spec:lint` is zero
errors/zero warnings; `pnpm --filter @irp/api exec tsc --noEmit` is clean; `pnpm --filter @irp/web
exec tsc --noEmit` is clean against the regenerated `packages/types`/`packages/client` (no `apps/web`
source changes yet, but its build depends on the client package this task rebuilds).

## Task 3 — Web surface: mentor review controls

**Do:**
1. `apps/web/app/(app)/review/[studentId]/entry-review-form.tsx` (new, client component): score
   input (0-100), feedback textarea, counts-toward-evaluation checkbox — `useActionState`-driven,
   modelled on `day-record-form.tsx`. Prefills all three fields from the entry's current
   `score`/`mentorFeedback`/`countsTowardEvaluation` (not just blank defaults) — the spec's own
   precedent (`saveDayRecord`'s doc comment) warns against an unprefilled reopen silently reverting
   a field on a full-replace PUT.
2. `apps/web/app/(app)/review/[studentId]/review-actions.ts`: new `reviewEntry` Server Action,
   modelled on `saveDayRecord` — reads `entryId`/`score`/`feedback`/`countsTowardEvaluation` from
   `FormData`, calls the generated `reviewEntry` SDK function (`{ client, path: { id: entryId },
   body: { score, feedback, countsTowardEvaluation } }`), checks `error !== undefined` →
   `problemMessage(error, "The review was not saved.")`, else `revalidatePath` +
   `{ ok: true }`.
3. `apps/web/app/(app)/review/[studentId]/page.tsx`: render `<EntryReviewForm>` per entry inside
   the existing `day.entries.map(...)` loop (lines ~166-177), alongside the existing body/timestamp/
   status-pill render — not replacing it.

**Test:**
- Component test: form prefills from a given entry's current values; submitting calls the action
  with the right `FormData` shape.
- E2E (extend the existing mentor-flows Playwright spec): review page shows score/feedback/checkbox
  controls per entry; submitting one persists on reload; a locked (`Evaluated`) day's entries do
  not offer the control (or the control is disabled/hidden — pick one and assert it).

**Done when:** `pnpm --filter @irp/web build` succeeds (with `AUTH_DEV_BYPASS=false` locally, per
CLAUDE.md's Plan 3 hard-won fact); `pnpm --filter @irp/web test` passes; the Playwright suite
(`pnpm --filter @irp/web exec playwright test`) passes locally with `workers: 1`.

## Task 4 — Documentation

**Do:**
1. `docs/walkthrough.md`: the review page walkthrough gains a paragraph on the per-entry
   score/feedback/checkbox controls.
2. `handoff.md` §1: a dated entry noting the AI-evaluation pivot (O-18) and that this plan replaces
   FR-22-24's mechanism, with the dependency chain to task 5 (student feedback visibility, blocked
   until this merges).
3. `handoff.md` §2a: Plan 9 row — "Not started" → "Merged, PR #TBD" (fill in the real PR number as
   a one-line follow-up commit once merged, per the established pattern).
4. Confirm `docs/interview-and-prd.md`'s O-18 entry and the FR-22/23/24/26 annotations (added
   ahead of this task, in this branch's second commit) still read correctly against what actually
   shipped — adjust wording only if implementation diverged from the spec's design.

**Done when:** all four docs reviewed for accuracy against the actual shipped schema/endpoint
names, not the spec's proposed names if anything changed during implementation.

---

## Note on the PR-number line in `handoff.md`

Task 4's `handoff.md` edit cannot know its own PR number ahead of time. Write the row as "Merged,
PR #TBD" in this branch, and fill in the real number as a one-line follow-up commit once the PR is
actually merged — the same pattern used for Plan 8.

## Note on O-18

This entire plan ships behind an explicitly-unconfirmed open point. Per the spec's own §10 risk
table, this is not the same footing as O-14/O-15/O-16 (cosmetic, cheaply reversible) — reverting a
shipped scoring-model pivot after mentors have scored real submissions is not cheap. If mentor
sign-off on O-18 comes back negative after this merges, the rollback shape is: stop writing new
`score`/`mentorFeedback` values (feature-flag the route, not delete it), and treat what was written
as input evidence for whatever pipeline replaces it — per the spec's own §2 fallback note. Do not
delete the columns speculatively; that decision belongs to whoever resolves O-18.

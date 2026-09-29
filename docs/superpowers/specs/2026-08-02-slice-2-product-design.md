# Slice 2 — The Product: Data Model, Flows, Dashboards — Design

**Date:** 2026-08-02
**Author:** Damian De Cruz (with Claude Code)
**Status:** Approved by the Impl Lead section-by-section on 2026-08-02
**Feeds:** Plan 5 (full data model + seed), Plan 6 (submission + review flows), Plan 7 (dashboards)
**Covers:** T-05 (full), T-07, T-08 (full), T-12, T-13, T-14, T-15
**FRs:** FR-3, FR-5, FR-6, FR-8–FR-20, FR-28–FR-30, FR-33 · **NFRs:** NFR-7–NFR-10, NFR-13

One design document for the whole slice, three plans out of it — the Slice 1 precedent
(`2026-07-28-slice-1-integration-skeleton-design.md`). The domain objects (`Entry`,
`DailyReport`, day classification) are shared by every flow and both dashboards; designing
them three times in three specs is how the pieces end up disagreeing.

---

## 1. Scope and decision record

Decisions taken in the 2026-08-02 brainstorm, all by the Impl Lead:

| # | Decision | Choice |
|---|---|---|
| D1 | Execution shape | Proper plans 5 → 6 → 7, one branch/PR each, merged in order. No demo shortcut. |
| D2 | AI evaluation UI | **Skipped.** O-5 blocks any AI provider call. Schema for `Evaluation`/`Override`/`Award` lands in Plan 5; no UI, no scoring code, until O-5 clears. |
| D3 | Notifications (FR-21) | **Skipped.** Stays Plan 8; no stub, no dev outbox. Nothing fake in the demo. |
| D4 | Seed shape | 2 batches × 5 students (10 total), matching T-07 and the brief. |
| D5 | Seed edge cases | All of: late + missed + absent days, weekend Extra, mid-cycle joiner, transfer, archived student. |
| D6 | Strengths-and-weaknesses panel (FR-29) | Designed honest empty state until evaluations exist. |
| D7 | Sign-out | A visible sign-out control in the app shell (currently only the raw Auth.js route exists). |
| D8 | Typography | One shared component vocabulary across every page; no page-local font/size/colour styling survives. |

**Out of scope for this slice** (unchanged from `handoff.md` §2a): notifications (Plan 8),
AI evaluation (Plan 9, blocked on O-5), winner + PDF (Plan 10), load testing (Plan 11).
Non-goals in `docs/interview-and-prd.md` §3.3 all stand — in particular no reject state,
no configurable rubric, no student-visible scores, no back-dating.

## 2. O-6 resolved: the rubric criteria

Extracted from the brief PDF (`docs/IRP_Progress_Management_System_Brief.pdf`, §5, page 5)
on 2026-08-02 via pdfjs text extraction, matching the confirmed 20/25/25/10/20 weights.
The stakeholder interview (Q23) confirmed the brief's table as fixed.

| # | Criterion | What it measures | Source | Weight |
|---|---|---|---|---|
| 1 | Attendance | Meetings and sessions actually attended | Mentor | 20% |
| 2 | Task completion | Work submitted and approved as done | Both | 25% |
| 3 | Contribution & initiative | Value added to the team and program | Both | 25% |
| 4 | Effort / time | Consistent daily hours logged | Student | 10% |
| 5 | Mentor evaluation | Overall judgement of the mentor | Mentor | 20% |

Column names in the `Evaluation` table: `attendance`, `taskCompletion`,
`contributionInitiative`, `effortTime`, `mentorEvaluation`. Mentor confirmation of the
wording remains listed under O-6 in the PRD, but the schema no longer waits on it — the
names now come from the brief itself, not from an assumption.

Noted and not reopened: the brief says cycles run "10th to the 10th"; FR-9 (the PRD, the
source of truth) says 10th → 9th, and `packages/core` is built and tested to 10th → 9th.

## 3. Data model (Plan 5)

`User` exists (Plan 2B) with `deletedAt` for FR-5 archival. Eight tables join it.

**Date/time conventions.** Civil dates (an entry's target date, batch boundaries, absence
dates) are Postgres `DATE`, mapped to/from `packages/core`'s `CivilDate` strings by a
single repository-layer conversion; they are calendar days in Asia/Colombo, not instants.
Instants (`submittedAt`, `reviewedAt`, audit timestamps) are `timestamptz` in UTC. No
column ever holds a Colombo-local instant.

| Table | Purpose | Shape |
|---|---|---|
| `Batch` | FR-6 | `id`, `name` (unique), `startDate`, `endDate`. `startDate` is the admission date anchoring the batch's cycle calendar (FR-9, `firstEvaluatedCycleStart`). No cap on concurrent batches. |
| `Enrolment` | FR-8 | `id`, `studentId → User`, `batchId → Batch`, `startDate`, `endDate?`. Transfer = set `endDate` on the old row, insert the new one. At most one open enrolment per student (partial unique index on `endDate IS NULL`). History follows the student; the 6-month programme clock runs from the student's **first** enrolment start. |
| `Entry` | FR-10/11/13/33 | `id`, `studentId`, `entryDate DATE`, `body TEXT`, `submittedAt`, `isLate`, `isExtra`. Both flags computed **at submission time** by `packages/core` (`canSubmitFor`, `isWeekday`, grace logic) and stored — history is never re-derived, so a later rule change cannot silently reclassify old rows. |
| `DailyReport` | FR-18/20 | `id`, `studentId`, `reportDate DATE`, `status` enum `IN_REVIEW → EVALUATED` (no Rejected — FR-18; **`SUBMITTED` removed 2026-09-25**, [ADR-0028](../../adr/0028-a-report-is-born-in-review.md) — a report is created IN_REVIEW at the student's submission instant, per interview Q14), `reviewedById?`, `inReviewAt?`, `evaluatedAt?`. Unique (`studentId`, `reportDate`). Created on the first entry for a date. `EVALUATED` locks the day for the student (FR-20): no further entries, no absence changes. |
| `MentorDayRecord` | FR-19 | `id`, `studentId`, `date DATE`, `attended BOOLEAN`, `tasksCompleted BOOLEAN`, `note?`, `recordedById`, timestamps. Unique (`studentId`, `date`). **Deliberately separate from `DailyReport`:** FR-19 says the mentor records independently of what the student wrote, and attendance must be recordable for a day with no entries at all (attended but never submitted). The one addition to T-05's table list — additive, and T-05 is traceability, not schema. |
| `AbsenceRecord` | FR-16 | `id`, `studentId`, `date DATE` (weekday only, service-enforced), `reason TEXT`, timestamps. Unique (`studentId`, `date`). Weekends have nothing to be absent from. |
| `Cycle` | FR-9 | `id`, `batchId`, `seq` (1-based), `startDate`, `endDate`. Materialised from the engine (`cycleFor`) per batch so `Evaluation` has a stable FK. Unique (`batchId`, `seq`). The engine remains the source of the arithmetic; rows are a cache of its output. |
| `Evaluation` | FR-22–23, NFR-15 | `id`, `cycleId`, `studentId`, five criterion columns (§2), `performanceIndex`, `summary TEXT`, `modelVersion`, `createdAt`. Unique (`cycleId`, `studentId`). Schema only in this slice (D2). |
| `Override` | FR-24 | `id`, `evaluationId` (unique), `mentorId`, `newScore`, `originalScore`, `reason TEXT`, `createdAt`. |
| `Award` | FR-31/32 | `id`, `cycleId` (unique), `evaluationId`, `justification TEXT`, `createdAt`. |

**Computed, never stored:** `Missed`. A weekday with no entry and no absence past grace is
classified by `classifyDay` at read time from calendar + entries + absences. Storing it
would strand stale rows if the grace rule ever moved (O-10 is still only mentor-assumed).
The same applies to compliance rates and "N of M" counts — always derived.

## 4. API contract (spec-first, `/api/v1`)

House rules apply to every endpoint: 200/400/401/500 documented (the custom Redocly
assertion), 403 additionally on role-gated endpoints, RFC 7807 bodies,
`additionalProperties: false`, examples on every schema, descriptions on every parameter.
Each spec change lands in the same task as the operation using it (`no-unused-components`).
Auth: bearer JWT via the existing `jose` path; role from the `User` row, never the token.
**Archived users:** an archived (`deletedAt` set) user still authenticates at the identity
provider, but every `/api/v1` endpoint treats them as unregistered — `GET /me` returns 403
and the web app lands them on the existing `/not-registered` terminal page. Archival
revokes access without deleting identity or history.

**Student endpoints (Plan 6):**

| Endpoint | Behaviour |
|---|---|
| `POST /entries` | `{ entryDate, body }`. Server validates the window by construction (FR-15: today or the previous weekday, per `submissionWindow`), computes `isLate`/`isExtra`, creates the day's `DailyReport` on first entry. 400 outside the window; 409 on an `EVALUATED` (locked) day; 409 if the date is marked absent. |
| `GET /me/days?from&to` | Own rolled-up history: per day — entries, report status, and the server-computed classification (`ok/late/absent/missed/extra/pending`). Defaults to the current cycle. |
| `POST /absences` | `{ date, reason }`. Weekday only (400 otherwise), not past-final (400), not locked (409), not already holding entries (409 — absent and submitted are contradictory). |
| `DELETE /absences/{date}` | Allowed only while the day is not final and not locked. |

**Mentor endpoints (Plan 6 unless noted).** All 403 for `STUDENT` role:

| Endpoint | Behaviour |
|---|---|
| `GET /batches` · `POST /batches` | List/create batches (FR-6). Create validates `startDate < endDate`. |
| `GET /batches/{id}/roster?date=` | Every enrolled student's status for that date: report status + classification + late/extra flags + mentor-record presence. The review working view. |
| `GET /students/{id}/days?cycle=` | One student's month — same day shape as `/me/days`, mentor's view. |
| `POST /daily-reports/{id}/transition` | `{ to: IN_REVIEW \| EVALUATED }`. Forward-only (409 backwards or repeated), no Rejected. Sets `reviewedById` and timestamps. |
| `PUT /students/{id}/day-records/{date}` | Upsert the mentor's attendance/tasks record (FR-19). Independent of entries — valid for entry-less days. |
| `POST /users` | Register a mentor, or a student + initial enrolment `{ batchId, startDate }` (FR-3). 409 on duplicate email/externalId. |
| `GET /users?role=&archived=` | Active by default; `archived=true` is the FR-5 archive view. |
| `POST /students/{id}/transfer` | `{ toBatchId, effectiveDate }` — closes the open enrolment, opens the new one (FR-8). Effective-date ownership: the NEW batch owns the effective date; the old enrolment closes the day before (ADR-0017). 400 if the effective date is on/before the open enrolment's start. |
| `DELETE /users/{id}` | Soft archive: sets `deletedAt`. Archived students leave active rosters, keep all history. 409 on self-archive. |

**Dashboard endpoints (Plan 7):**

| Endpoint | Behaviour |
|---|---|
| `GET /batches/{id}/dashboard/today` | "N of M submitted" for the batch's current required day, late count, absent count (FR-28). Weekends report the last required day, labelled as such. |
| `GET /batches/{id}/dashboard/summary?cycle=` | Per-student cycle summary: compliance rate, late/missed/absent/extra counts, review progress. No scores (none exist yet). |
| `GET /me/dashboard` | "Month N of 6" (from first enrolment), current-cycle compliance summary, latest strengths-and-weaknesses (`null` until an evaluation exists — the UI renders the designed empty state). |

**No pagination in v1** — rosters are ≤10 students, cycles ≤23 working days. Stated here
so it is a decision, not an oversight; revisit if batch sizes grow.

## 5. Pages and UX (Plans 6 + 7)

**Shell (both roles).** Header gains a **Sign out** button (D7) posting the Auth.js
sign-out action. Nav is role-gated: students see `Today · My month`; mentors see
`Today · Roster · Review · Cycles · Students`. Gating is cosmetic in the shell and
enforced at the API (FR-30) — hiding a link is not access control.

**Typography and component vocabulary (D8).** `apps/web/components/ui/` gains shared
primitives — `PageTitle`, `SectionLabel`, `StatusPill`, `Button`, `Panel`, `EmptyState` —
implementing `docs/design-system.md` §4 (Jakarta, fixed 14px scale, tabular figures,
heading tracking −0.03em), §9 (all seven interactive states; the hover/press/focus
treatment committed alongside this spec becomes `Button`), and §10 (150ms ease-out-quart). Every
page including the existing three migrates onto them; page-local `style={{...}}`
typography does not survive review. `StatusPill` maps day classifications onto the
existing `--st-*` tokens.

**Mentor pages:**

| Page | Content |
|---|---|
| Today (FR-28, SC-4, must-ship) | Per batch: "N of M submitted today", late count, absent count — all visible without scrolling at 1280×800. Plus a per-batch performance summary strip (compliance this cycle). |
| Roster | Batch picker + date picker (defaulting to today/last required day). A row per enrolled student: status pill, entry count, late/extra badges, mentor-record indicator. Rows link to Review. |
| Review | One student × one cycle: day-by-day rolled-up entries (newest first — brief R5), absence reasons, the mentor's attendance/tasks form (FR-19), and the day-finishing action (FR-18). **Superseded 2026-09-25:** there is no transition control — the mentor's single "Save record" both records attendance and, for a day the student can no longer submit to, finishes it ([ADR-0028](../../adr/0028-a-report-is-born-in-review.md)). Finished days render locked with a lock affordance (FR-20) and read "Saved", not "Evaluated". |
| Cycles | Per batch: cycle list with boundaries; per student per cycle: compliance summary. Evaluation column shows the designed "awaiting evaluation" state (D2/D6). |
| Students | Register mentor/student (with batch + start date), create batch, transfer student, archive; archive view lists archived students read-only (FR-5). |

**Student pages:**

| Page | Content |
|---|---|
| Today | Compose box (text only), legal target dates only (today / previous weekday, disabled otherwise — FR-15 by construction in the UI too), existing entries for the day, absence toggle with reason. Under-2-minutes path: land → type → submit (NFR-9). |
| My month | Day grid for the current cycle with status pills, "Month N of 6", entry history, strengths-and-weaknesses panel — designed empty state until evaluations exist (D6): "No evaluation yet — your first summary appears after your cycle closes." |

**Students never see:** scores, ranks, other students' names or data (FR-30). The student
dashboard endpoint returns only the caller's rows; there is no student-reachable endpoint
that accepts another student's id.

**Dev identity picker** grows to cover the seeded personas, grouped: Mentors (2),
Batch A students (5), Batch B students (5), plus the archived student (expect the
archived experience) and the unregistered case (expect 403). Identities live in
`lib/dev-identities.ts` and the seed derives from the same constant, so the picker and
the database cannot drift.

## 6. Seed data (Plan 5, T-07)

`pnpm --filter @irp/api db:seed` — a `tsx` script.

- **Refuses `NODE_ENV=production`** with a startup throw, same posture as the bypass guard.
- **Idempotent:** deletes exactly the users named in `@irp/fixtures`'
  `SEED_EXTERNAL_IDS` and the two fixture batches (`Batch Aurora`/`Batch Basalt` —
  `SEED_BATCH_NAMES`), then re-creates. An explicit allowlist, not a prefix match —
  safer, since a prefix match would also catch anything an operator happened to name
  the same way. Never touches non-seed rows.
- **Relative dates:** everything is computed backwards from the run date via
  `packages/core`, so the demo is always current. Batch A admitted two cycles before the
  current one (month 3 of 6, on its 3rd cycle); Batch B at the current cycle's start
  (cycle 1). Cycle *boundaries* are fixed calendar months (10th → 9th) for everyone —
  what admission anchors is which cycle is a batch's first and how they are numbered
  (`firstEvaluatedCycleStart`), and the two batches differ visibly in exactly that way
  (FR-6/9). *(Corrected 2026-08-02: an earlier draft wrongly claimed different admission
  dates give different cycle boundaries.)*
- **Integrity rule:** the seed never hand-sets a flag. `isLate`, `isExtra`, and every
  achievable state go through the same `packages/core` functions production code uses
  (`submissionWindow`, `graceDeadlineFor`, `isWeekday`, `cycleFor`). A state the engine
  cannot produce does not enter the database.
- **Personas (10 students, names and content are fixed prose, no lorem ipsum):** 2 fully
  compliant; 1 habitually late (submits inside grace); 1 with missed weekdays; 1 with
  absences + reasons; 1 weekend worker (Extra); 1 mid-cycle joiner (FR-27 — joined after
  the current cycle opened); 1 transferred A→B mid-programme (FR-8); 1 archived (FR-5);
  1 ordinary mixed record. Daily reports spread across `IN_REVIEW / EVALUATED`
  so every review state is on screen from day one; `MentorDayRecord`s partially filled so
  the Review page shows both recorded and unrecorded days.
- **No `Evaluation`/`Override`/`Award` rows** — the empty states are part of the demo (D2, D6).
- The dev picker's student identities map 1:1 to seeded students: the first compliant
  student keeps the historical `dev-student-1` id, and the other eight use the
  `seed-student-*` prefix (`seed-student-a2` …); likewise the first mentor keeps
  `dev-admin-1` and the second is `seed-mentor-2`. `apps/web/e2e/README.md`'s manual
  INSERT block is superseded by the seed script and gets updated to say so.

## 7. Testing and verification

| Layer | What |
|---|---|
| Domain unit tests | Roll-up, forward-only transitions, lock-on-Evaluated, window enforcement, absence/entry mutual exclusion. In `apps/api`, rows created in-file (the suites `TRUNCATE`; Vitest order is not stable). |
| API integration | Per endpoint: happy path, RFC 7807 validation rejection, role gating (student token → 403 on mentor endpoints), by-construction impossibilities (illegal date 400, backwards transition 409, locked-day write 409). |
| Contract | Existing gates: `spec:lint` zero-warnings, four-response assertion, generation staleness, generated-output checks. |
| Playwright e2e | Grows from 5 tests: submit on-time / late / weekend / absence; locked-day refusal; roster → review → record attendance → transition → lock; mentor Today shows seeded "N of M"; student My month shows pills + empty S&W state; student blocked from mentor pages; archive flow; sign-out from the shell. Runs against `next dev` + seeded DB (the bypass constraint stands). |
| Manual walkthrough | `docs/walkthrough.md`: persona-by-persona script — what to click, exactly what you should see (which students show late badges, what "N of M" reads, where empty states are). Doubles as the SC-3 legibility check. |
| Per plan | The full house loop: spec first, SDD with fresh per-task subagents + independent review, `pnpm lint`/`typecheck`/tests/`spec:lint`/real `next build`, one branch, one PR, merged before the next plan starts. `.superpowers/sdd/` archived between plans. |

Load/NFR proof stays Plan 11. Nothing in this slice claims NFR-1..6 numbers.

## 8. Plan decomposition

| Plan | Contents | Branch |
|---|---|---|
| **5 — Full data model + seed** | Prisma schema (§3) + migration; repository layer with the `CivilDate` boundary; cycle materialisation; seed script (§6); dev-identity constant expansion. The API surface does not change in this plan — seed correctness is proven by unit tests over the repositories, not by endpoints. | `feat/plan-5-data-model-and-seed` |
| **6 — Submission + review flows** | OpenAPI for student + mentor endpoints (§4), handlers, services; shared UI primitives (§5, D8); shell sign-out (D7); student Today; mentor Roster + Review + Students pages; picker expansion; e2e for the flows. | `feat/plan-6-submission-and-review` |
| **7 — Dashboards** | Dashboard endpoints; mentor Today (FR-28) + Cycles; student My month (FR-29); walkthrough doc; remaining e2e; typography migration audit of every page. | `feat/plan-7-dashboards` |

**Plan 7: delivered on the branch above, not yet merged.** All three dashboard endpoints, both
new pages (mentor Cycles, student My month), the mentor Today rebuild, `docs/walkthrough.md`,
`dashboard-flows.spec.ts` (7 tests), and the D8 typography migration audit are complete as of
Task 12 (this documentation sweep). Task 3's review also found and fixed a real scoring defect —
`countCycle` was clipping a student's obligation against their whole cross-batch history rather
than this batch's enrolment interval(s); see `handoff.md` §1 and the docstring in
`apps/api/src/services/dashboard-service.ts` for the measured before/after. A related gap —
weekend `extra` is not batch-clipped — ships deliberately, documented at the same site.

**Two contract additions Plan 7 made to §4, beyond what that section originally specified:**

- **`today` was added to `StudentDashboard`.** §4 specified "Month N of 6" and the current-cycle
  compliance summary for `GET /me/dashboard`; the shipped schema also carries `today`, the
  student's own classification for the batch's current required day, so the page can render
  today's status without a second round trip.
- **`StudentCycleSummary` carries no evaluation field.** §4's `GET
  /batches/{id}/dashboard/summary` entry says "No scores (none exist yet)" but did not say
  whether the schema should reserve a field for one. It does not: with D2 keeping all scoring
  behind O-5, an evaluation field would be permanently `null` in every response this slice can
  ever produce — dead contract, not a forward-compatible one. Plan 9 adds the field with Plan 9's
  own operation, per the house rule that a schema and the operation using it land together.

Slice rule (handoff §2a) satisfied: Slice 1 is merged; features land on the proven
pipeline. Each plan updates `handoff.md` §2a status on merge.

## 9. Open points touched

| Point | Effect of this design |
|---|---|
| O-5 | Untouched and respected — no AI call, no provider decision. Evaluation schema only. |
| O-6 | Wording resolved from the brief (§2); mentor confirmation still listed in the PRD but no longer blocks schema. |
| O-7 | Unexercised — no scoring in this slice. |
| O-10 | The engine's existing assumption stands (grace to end of next weekday); seed and tests exercise it. |
| O-2 / O-3 | Untouched — Plans 8/10 concerns. |

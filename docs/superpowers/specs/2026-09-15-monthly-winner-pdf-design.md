# Monthly Winner Report — Computation and PDF — Design

**Date:** 2026-09-15
**Author:** Mohaideen Abdullah (spec lead, with Claude Code)
**Status:** Draft — pending review by Danella De Cruz before Hafsa Raashid begins implementation
**Feeds:** a new plan, one branch and one PR, in `HafsaRaashid/irp-progress-management`. Fifth and
last of the task-list sequence (task 6, scoped strictly to FR-31/32 per this spec's own
brainstorming — not a general per-student report page). **Depends on** the monthly-score
-calculation spec (`2026-09-15-monthly-score-calculation-design.md`, task 7) merging first — this
spec's winner computation calls that spec's `computeMonthlyScore`.
**FRs:** FR-31 (winner computation, tie-break per O-3), FR-32 (downloadable PDF) — **the
"AI-generated justification" half of FR-32 is revised**, since O-18 removed the AI (see §2)
**Governs / closes:** finalises O-3 (tie-break rule, previously only assumed in prose)
**ADRs owed by this slice:** one — see §9

---

## 1. Scope and decision record

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | **Winner-only**, matching FR-31/32 literally — not a general per-student report page. One winner per batch per cycle, downloadable as a PDF. Rejected: a broader reports page listing every student's monthly figures — bigger scope than the FRs ask for; revisit as its own spec if wanted later. |
| D2 | When the winner is computed | **An explicit mentor action** (`POST .../award`), not automatic at cycle close — there is no scheduler in this stack (same reasoning task 7's D4 already established), and "the system computes the monthly winner" (FR-31) is satisfied by a deterministic function the mentor triggers, not a background job. Rejected: automatic computation at some cycle-boundary trigger — no infrastructure to fire it, and no defined trigger event since T-16 (notifications) doesn't cover cycle boundaries. |
| D3 | Award is a one-time, locked record | **Awarding a cycle is final** — a second `POST` for an already-awarded cycle returns 409, matching this system's broader "no reopening a settled decision" pattern (FR-20's day lock, FR-18's no-Rejected-state). Rejected: allowing re-award/overwrite — invites the same "corrections happen at evaluation, not by re-doing the thing" problem FR-20 already solved once. |
| D4 | Eligibility | **Only students with a non-null `performanceIndex`** (task 7's D3 — null means no counted entries that cycle) are eligible. A cycle where every enrolled student has a null index has **no winner**, and awarding it returns 422 with a Problem Details body naming the reason, not a silently-arbitrary pick. |
| D5 | Justification text, replacing the AI half of FR-32 | **A deterministic, templated justification**: the winner's three figures (attendance/taskScore/completion), the performance index, and — if the tie-break rule (O-3) was actually invoked — a line stating which tie-break stage decided it. No free-text generation of any kind; this is data substitution into a fixed template, consistent with O-18's whole premise that nothing in this system calls an AI provider. |
| D6 | PDF generation approach | **`pdfkit`** — programmatic PDF construction, pure Node, no headless browser. Rejected: Puppeteer/Playwright print-to-pdf (a headless Chromium dependency materially worsens the Container Apps scale-from-zero cold start ADR-0009 D5 already flags as a stated NFR-1 risk, for a one-page fixed-layout document that doesn't need HTML/CSS reuse); `@react-pdf/renderer` (a React rendering abstraction over the same underlying PDF primitives `pdfkit` exposes directly — unnecessary layering for a fixed, non-componentised one-page document). |

**Out of scope.** Any per-student (non-winner) report or PDF — D1. Any AI call of any kind — D5,
consistent with O-18. Re-computation or editing of a past award — D3. Emailing the PDF — O-2
already settled this as download-only for v1.

## 2. The FR problem, and what O-18 forces here

FR-32 says the PDF "contains an AI-generated justification for the award." O-18 (the
per-submission-review spec) already established there is no AI anywhere in this system's scoring
path. This spec is where that consequence actually lands on FR-32's text specifically: **the
justification is deterministic, not AI-generated** (D5). This is not a new open point — it is the
direct, already-decided consequence of O-18, stated here because this is the first spec where
FR-32's literal wording is actually implemented against.

**O-3 (tie-break rule) is finalised, not just assumed**, by this spec: `docs/interview-and-prd.md`
currently carries it as a prose assumption ("weighted score → submission compliance → earliest
average submission time") with "mentor to confirm or replace" outstanding. §3 below is where that
assumption becomes actual code for the first time — flagged so review attention lands there.

## 3. Winner computation

New function, `computeCycleWinner`, in a new `apps/api/src/services/award-service.ts` (a new
service, following the `dashboard-service.ts`/the task-7 spec's `evaluation-service.ts` pattern):

```ts
interface WinnerResult {
  studentId: string;
  score: MonthlyScore;       // from the task-7 spec
  complianceRate: number;    // from dashboard-service's CycleCounts
  avgSubmissionTime: number; // minutes since midnight Asia/Colombo, mean across the cycle's entries
  tieBreakStage: "score" | "compliance" | "submissionTime"; // which stage actually decided it
}

function computeCycleWinner(students: StudentCandidate[]): WinnerResult | null
```

Algorithm, per O-3: sort candidates by `performanceIndex` descending (D4 excludes `null`); if the
top score is shared by more than one student, break the tie by `complianceRate` descending (same
metric `dashboard-service.ts` already computes for the cycle ribbon/calendar); if still tied,
break by `avgSubmissionTime` ascending (earliest wins). `tieBreakStage` records which comparison
actually separated the winner from the runner-up, purely for the justification text (D5) — "won on
performance index alone" reads differently from "won on tie-break: earliest average submission
time," and the PDF should say which one happened, not overstate a clean win that was actually a
tie-break.

`avgSubmissionTime` is a new calculation this spec introduces: mean of each entry's `submittedAt`,
converted to Asia/Colombo minutes-since-midnight, across all the student's entries in the cycle.

## 4. Data model

No new tables. `Award` (`schema.prisma`) already has the right shape (`cycleId` unique,
`evaluationId`, `justification`). What changes:

- **Awarding a cycle now writes an `Evaluation` row** for the winner (only the winner — not every
  student, per D1's winner-only scope) via task 7's `computeMonthlyScore`, snapshotting that
  student's figures at award time. This is the concrete case task 7's own risk note (§10 there)
  anticipated: "a future plan needs a stored snapshot... `Override`'s write path is the closest
  thing to a snapshot today; if broader snapshotting is needed later, it's a new spec's decision."
  This is that spec, and the decision is: award time is the snapshot trigger, scoped to the winner
  only.
- `Award.justification` stores the rendered template text (D5), not a structured object — the PDF
  regenerates its layout from `Award` + the linked `Evaluation` at download time, so the stored
  text is the source of truth for what the PDF says even if `Entry`/`MentorDayRecord` data changes
  afterward (the whole point of a locked, one-time award, D3).

## 5. API surface

```
POST /api/v1/batches/{id}/cycles/{seq}/award
```
Admin-only. Computes the winner (§3), snapshots their `Evaluation` (§4), creates the `Award` row.
409 if this cycle already has an award (D3). 422 if no student is eligible (D4). Returns the
created `Award` (existing schema shape, no change needed there).

```
GET /api/v1/awards/{cycleId}/pdf
```
Admin-only. 404 if no award exists for the cycle yet (award it first via the endpoint above).
Response: `content-type: application/pdf`, generated on the fly from the stored `Award` +
`Evaluation` row (not cached/stored as a file — regenerating a one-page PDF from already-fetched
rows on every download is cheap enough that storing the binary would be premature).

Both endpoints carry the full 200/400/401/500 set per the repo's API contract rules; the PDF
endpoint's "200" is the binary response, its 400/401/404/500 all Problem Details as usual.

## 6. Web surface

Extends the existing Cycles page (`apps/web/app/(app)/cycles/page.tsx`) rather than adding a new
nav destination — that page already lets a mentor browse a batch's cycles one at a time, which is
exactly the unit an award belongs to. Adds, per cycle viewed: if awarded, the winner's name and a
"Download PDF" link; if not yet awarded and the cycle has closed, an "Award this cycle" action
(the `POST`, via a Server Action following the existing `review-actions.ts` pattern). A cycle still
in progress shows neither — awarding an open cycle doesn't make sense given D2's "explicit action"
model and FR-31's "monthly" framing.

## 7. Non-goal check

**No AI call anywhere** — D5, direct continuation of O-18. **"No student-visible score, rank, or
leaderboard"** — the winner's *name* being visible is FR-31/32's entire point (a winner is
announced), but nothing here exposes the losing students' scores or rank to anyone but the mentor;
students never see this page or endpoint at all in this spec.

## 8. Testing

| Level | Case |
|---|---|
| Unit | `computeCycleWinner` picks the highest `performanceIndex` when no tie exists |
| Unit | A tie on `performanceIndex` resolves by `complianceRate` |
| Unit | A tie on both resolves by earliest `avgSubmissionTime` |
| Unit | A student with `performanceIndex: null` is excluded from candidates entirely |
| Unit | All-null candidates → `computeCycleWinner` returns `null` |
| Unit | `tieBreakStage` correctly reports which stage actually decided a tie case, and reports the top-level stage when there was no tie |
| Integration | `POST .../award` twice on the same cycle: second call 409s, first award's `Evaluation`/`Award` rows unchanged |
| Integration | `POST .../award` on a cycle with no eligible students: 422 |
| Integration | `GET /awards/:cycleId/pdf` before awarding: 404 |
| Integration | `GET /awards/:cycleId/pdf` after awarding: `content-type: application/pdf`, non-empty body |
| E2E | Mentor views a closed cycle on the Cycles page, awards it, downloads the PDF |

## 9. ADRs owed

Per `CLAUDE.md`, a decision with a plausible rejected alternative needs an ADR naming at least
two, written **before** implementation:

**ADR — `pdfkit` over a headless-browser PDF renderer.** Rejected: Puppeteer/Playwright
print-to-pdf (cold-start cost against ADR-0009 D5's already-flagged scale-from-zero concern, for a
one-page document with no need for HTML/CSS reuse); `@react-pdf/renderer` (an unneeded rendering
abstraction over the same primitives for a fixed, non-componentised layout).

## 10. Risks

| Risk | Handling |
|---|---|
| O-3's tie-break rule, now actually implemented, turns out to disagree with what the mentor intended when they only reviewed it in prose | This is exactly why §2 calls out that this spec is where O-3 stops being an assumption — flag it for explicit review, since a code implementation is a stronger commitment than a PRD sentence. |
| A mentor awards a cycle, then a `MentorDayRecord`/`Entry` correction changes what the figures "should" have been | D3's lock is deliberate — the stored `Evaluation`/`Award` snapshot does not silently update. A correction after the fact needs its own explicit re-award path if ever wanted, which this spec does not build (consistent with "no reject/reopen" elsewhere in the system). |
| `pdfkit`'s layout code (coordinate-based, not HTML/CSS) is unfamiliar relative to the rest of `apps/web`'s Tailwind-based styling | Contained entirely to `apps/api` (the PDF is generated server-side, §5) — this doesn't touch `apps/web`'s styling approach at all, so the unfamiliarity is scoped to one small file, not spread across the design system. |

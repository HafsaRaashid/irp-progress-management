# AI Monthly Evaluation — Design

**Date:** 2026-10-06
**Author:** Mohaideen Abdullah (spec lead, with Claude Code)
**Status:** Accepted by the spec lead, proceeding ahead of O-5's own required process — see §0
**Feeds:** a new plan, one branch and one PR, in `HafsaRaashid/irp-progress-management`
**FRs:** FR-22, FR-23, FR-24, FR-25, FR-26, FR-27, NFR-15
**Governs / closes:** none. Does not touch FR-31/32 (winner computation + PDF, "Plan 10") — that
depends on this slice's scores and is explicitly out of scope here (see §2)
**ADRs owed:** two — see §9

---

## 0. The O-5 override — read this first

`CLAUDE.md` states: *"AI provider is undecided... Needs an ADR and leadership escalation before
any AI call is implemented. Do not wire a third-party model API without it."* `docs/interview-and-prd.md`
still lists O-5 as **Undecided** as of this spec's date, and the `Evaluation` model's own comment
in `schema.prisma` reads *"Schema only in Slice 2 — no UI, no scoring code (O-5)."* This is not a
minor open point: `ADR-0026`/`ADR-0027` already document one full build-then-revert cycle caused
by exactly this kind of process shortcut (a different one — proceeding on an unverified consolidation
document rather than the stakeholder interview — but the same underlying failure mode: shipping
ahead of the sign-off the project's own rules require).

**This spec proceeds anyway, on the spec lead's explicit instruction, who accepts the risk.**
Recorded here rather than silently: the provider (Azure OpenAI, §3) and the decision to proceed
without the leadership escalation are both logged as `// ASSUMPTION: O-5` at every call site, in
the new ADR this spec owes (§9), and in `docs/interview-and-prd.md`'s O-5 row. If leadership's
eventual answer is "no AI provider" or "a different one," the blast radius is contained to the
files this spec lists in §3 — the data-assembly and rubric-maths code underneath has no provider
dependency and survives a provider swap untouched.

**The quarterly evaluation is explicitly out of scope, and is plausibly what "halfway through the
program, and at the end" actually means.** The brief itself (§6.2, not just the interview's Q33)
describes a *separate* "Quarterly (3-Month) Major Evaluation" — explicitly **not** derived from
the monthly winners, "a fresh, independent evaluation over the whole quarter." A 6-month programme
has exactly two quarters, landing on month 3 ("halfway") and month 6 ("the end") — a closer match
to the originating request's wording than "the ordinary monthly mechanism happening to run on
those two months," which is the reading this spec proceeds on. `CLAUDE.md` lists the quarterly
evaluation under "Deferred to v2." This spec builds **only** the monthly mechanism (FR-22–27,
unambiguously in scope and needed regardless of how the quarterly question resolves); if the
requester confirms quarterly evaluation is genuinely wanted, that is a second scope reopening on
top of this one's O-5 override, and its own follow-on spec — it needs its own schema (no quarterly
table exists, and "not based on monthly winners" means it cannot simply read this slice's output).

## 1. Scope and decision record

| # | Decision | Choice |
|---|---|---|
| D1 | Trigger mechanism | **Mentor-initiated, on-demand**, not a scheduled job. This repo has no background-job infrastructure (Azure Container Apps, scale-to-zero, `ADR-0009`) and `ADR-0019` already establishes that a GET must never materialise rows — a cron that writes `Evaluation` rows unattended would be the first exception to that principle. An explicit mentor action keeps every write attributable and matches how every other write in this app already works (the Review page's "Save record", FR-20). |
| D2 | Trigger granularity | **Per student, per cycle** — matches the `Evaluation` table's own grain (one row per `cycleId`+`studentId`). Evaluating a whole batch at once is additional complexity (N concurrent AI calls, partial-failure handling) with no stated urgency; a batch-wide convenience action is a plausible v2 addition, not v1 scope. |
| D3 | Provider | **Azure OpenAI**, called via hand-written `fetch` against its REST chat-completions endpoint — not the `openai` npm SDK. Matches this repo's established pattern for external services: `ADR-0024` (Teams webhook over Graph API) and `ADR-0025` (SMTP over a vendor SDK) both chose the raw HTTP call over an SDK dependency. Azure OpenAI also keeps student submission text inside the Azure tenant this project already deploys to, which is the specific concern O-5's own wording raises about a third-party API. |
| D4 | Rubric scale | Each of the five criteria is scored **0–100 by the AI**; `performanceIndex` is computed in this codebase (never by the AI) as the fixed weighted sum (20/25/25/10/20), so the one number FR-31's winner computation will later read is never something the AI produces unchecked. |
| D5 | Determinism (NFR-15) | `temperature: 0` on every call. NFR-15's "±2 points across runs" is **not** a CI-testable assertion — this repo's existing tests never make a real external network call (`build-test-server.ts` hard-codes a local JWKS; the Teams/SMTP senders are tested against fakes, never the real webhook/SMTP server). The AI client is tested the same way: a fake implementing its interface in unit tests, and the determinism property itself is a manual verification step before the first real evaluation runs in production — recorded as this plan's own go/no-go gate, the same shape Task 8 used for the cycle calendar's NFR-13 check. |
| D6 | Malformed or out-of-range AI output | **One retry on a transient failure** (network error, 5xx, invalid JSON, a criterion outside 0–100), then a `502 Bad Gateway` Problem Details response. Never persist a fabricated or clamped score — a wrong number silently written against a real student's record is worse than a visible failure the mentor can retry. |
| D7 | What feeds the prompt | Every `Entry` in the cycle (body, date, `isLate`, `isExtra`), every `MentorDayRecord` in the cycle (`attended`, `tasksCompleted`, `note`), every `AbsenceRecord` in the cycle (`reason`). Matches FR-22's own wording ("all their submissions plus the mentor's attendance and task records") and `CLAUDE.md`'s "Extra... fed to the AI summary as positive context." |

**Out of scope.** FR-31/32 (winner computation, PDF) — a separate spec once this slice ships real
scores to read. Batch-wide evaluation. Any change to the AI summary after generation (FR-25
forbids it structurally — there is no edit endpoint). The quarterly evaluation (see §0).

## 2. Why this maps to real FRs, unlike O-17's calendar

Unlike the cycle calendar (O-17, no FR), this entire slice implements FR-22 through FR-27 as
written. The thing requiring sign-off is not *whether* to build it — the brief and the
stakeholder interview both ask for it — but *which provider* processes personal data to do so,
which is exactly what O-5 asks and exactly what §0 overrides on the spec lead's authority alone.

## 3. Architecture

```
Mentor clicks "Evaluate" on /cycles (a closed, unevaluated cycle row)
  -> Server Action -> POST /api/v1/students/{id}/evaluations?cycle={seq}
       -> EvaluationService.generateForCycle(studentId, batchId, seq)
            1. Resolve the cycle's bounds for this batch+seq (reuse dashboard-service.ts's
               existing batch-cycle resolution — it already does this for getBatchDashboardSummary)
            2. 409 if the cycle hasn't closed yet (endDate >= today, Asia/Colombo) or already has
               an Evaluation row
            3. Gather Entry/MentorDayRecord/AbsenceRecord rows for studentId within those bounds
            4. Build the prompt (template, §4); call AzureOpenAiEvaluator.evaluate(prompt)
            5. Validate the response shape and each criterion's range; retry once on failure (D6)
            6. Compute performanceIndex from the fixed weights
            7. Upsert the Cycle row (lazy materialisation, same principle as ADR-0019); insert
               the Evaluation row with modelVersion from config
       <- 201 Evaluation (the new row's API shape)
```

**New files:**
- `apps/api/src/services/evaluation-ai-client.ts` — the Azure OpenAI `fetch` wrapper. Exports an
  interface (`EvaluationAiClient`, one method: `evaluate(prompt: EvaluationPrompt): Promise<EvaluationAiResult>`)
  and `createAzureOpenAiEvaluator(config: AzureOpenAiConfig | undefined, logger)`, mirroring
  `notification-senders.ts`'s shape — except, per D6, a missing config throws at call time
  (`AiProviderUnavailableError`, mapped to 503) rather than silently no-opping, since this is not
  a fire-and-forget side effect.
- `apps/api/src/services/evaluation-service.ts` — `generateForCycle`, the prompt builder, response
  validation, and the weighted-sum calculation.
- `apps/api/src/db/evaluation-repo.ts` — Prisma access for `Evaluation`/`Override`/`Cycle` (upsert).
- `apps/api/src/routes/evaluations.ts` — the three endpoints (§5).
- `apps/web/app/(app)/cycles/evaluate-action.ts` — the Server Action backing the "Evaluate" button.

## 4. The prompt contract

Azure OpenAI is called with `response_format: { type: "json_schema", ... }` (structured outputs)
requiring exactly:

```json
{
  "attendance": 0,
  "taskCompletion": 0,
  "contributionInitiative": 0,
  "effortTime": 0,
  "mentorEvaluation": 0,
  "summary": "string"
}
```

Each criterion is an integer 0–100. The system prompt states the five criteria's definitions (from
the brief's rubric table, already confirmed per O-6), instructs the model to weigh `Entry.isExtra`
entries as positive context only (never penalising their absence, matching FR-33/CLAUDE.md), to
treat `AbsenceRecord` as excused and not penalise it (O-7's current assumption), and to write
`summary` as the exact text that will appear in the report with no further editing (FR-25) —
second person, addressed to the student, factual, no invented specifics the input data doesn't
support.

## 5. API additions

Three new operations in `spec/openapi.yaml`, each with the full `200`/`400`/`401`/`500` set
`CLAUDE.md` requires (plus `403`/`404`/`409` where applicable), `additionalProperties: false`, and
examples on every schema per the house rules:

- `POST /api/v1/students/{id}/evaluations` — query param `cycle` (integer, required). Mentor-only.
  `409` if the cycle is still open or already evaluated. `503` if the AI provider is unavailable
  (D3/D6). Returns the new `Evaluation`.
- `GET /api/v1/students/{id}/evaluations/{cycle}` — the evaluation for one student's cycle, or
  `404` if none exists yet (the Cycles page's existing "awaiting evaluation" state is what renders
  on that 404, not a new UI state).
- `PUT /api/v1/evaluations/{id}/override` — body `{ newScore: number, reason: string }`. Mentor-only.
  Stores `Override` (new score, the evaluation's original `performanceIndex`, the reason). FR-24.

`StudentCycleSummary` (the Cycles page's per-student row, currently always "awaiting evaluation")
gains an optional `evaluation` field carrying `performanceIndex` (or the override's `newScore` if
one exists) and whether an override was applied — so the page's existing placeholder becomes real
without a new page.

`StudentDashboard.strengthsAndWeaknesses` (already nullable, already wired into `student-today.tsx`'s
empty state) populates with the latest evaluation's `summary` once one exists for the student's
current-or-most-recent cycle — no change needed on the `apps/web` side beyond removing the
always-null assumption from that field's own usage; the empty state remains for a student with no
evaluation yet.

## 6. Error handling

| Condition | Response |
|---|---|
| Cycle not yet closed | `409`, Problem Details naming the cycle's actual end date |
| Already evaluated | `409`, Problem Details pointing at the existing evaluation's id |
| AI provider unreachable / misconfigured | `503` after one retry |
| AI response fails validation (bad JSON, criterion out of 0–100, empty summary) | `502` after one retry — this is a provider-contract failure, not a client error |
| Student not enrolled in the named batch during that cycle | `404` (matches `resolveStudent`'s existing "no such student" shape elsewhere in this codebase) |

## 7. Testing

| Level | Case |
|---|---|
| Unit | `evaluation-ai-client.ts` against a fake `fetch` — success, malformed JSON, out-of-range criterion, timeout/network error, the one-retry behaviour |
| Unit | `evaluation-service.ts`'s weighted-sum maths against hand-computed expected values for several score combinations |
| Unit | `evaluation-service.ts` rejects (409) a cycle whose `endDate` is in the future, and a cycle that already has an `Evaluation` row |
| Integration | `POST .../evaluations` end-to-end against a fake AI client and real Postgres — the `Evaluation` row persists with the correct `performanceIndex` and `modelVersion` |
| Integration | `PUT .../override` persists `Override` with both the new and original scores |
| Integration | `GET .../evaluations/{cycle}` 404s before evaluation, 200s after |
| Manual (NFR-15 gate) | Run the same real month of input against the real Azure OpenAI deployment several times; confirm the score varies by at most ±2 points. This is the plan's own go/no-go gate, run once before the first real mentor-facing use — not a CI assertion (see D5) |

## 8. Edge cases

- **A student who joined or left partway through the cycle (FR-27)** — not evaluated for that
  cycle at all. `generateForCycle` 409s if the student's enrolment doesn't cover the cycle's full
  bounds, reusing the enrolment-interval check `countCycle` (dashboard-service.ts) already has for
  exactly this question.
- **A cycle with zero entries** (a student who missed every day) — still evaluated; the AI sees an
  empty submission record and a mentor's attendance/task record, and scores accordingly. Not an
  error — FR-26 does not exempt a quiet month from evaluation.
- **Re-running after an override exists** — generation is not re-run once an `Evaluation` row
  exists (409, §6); an override does not delete or replace the original AI row, by design (FR-24
  requires keeping both).

## 9. ADRs owed

Two, both written before implementation starts:

1. **O-5 override and Azure OpenAI as the provider** — supersedes nothing, but is the first ADR to
   actually resolve O-5's technical half (the leadership/data-processing half remains open and is
   not what this ADR claims to close). Names rejected alternatives: OpenAI direct API and
   Anthropic's API (both move student data to a separate third-party tenant, the exact risk O-5
   raises), and waiting for the escalation before building anything (rejected by the spec lead's
   explicit instruction, recorded with the cost: if leadership says no, this slice is rebuilt
   against a different provider, not thrown away — see §0).
2. **Hand-written Azure OpenAI client over the `openai` SDK** — names the SDK as the rejected
   alternative, with `ADR-0024`/`ADR-0025` as precedent for the same choice made twice already in
   this codebase.

## 10. Risks

| Risk | Handling |
|---|---|
| Leadership's eventual O-5 answer rejects Azure OpenAI entirely | Contained: the `EvaluationAiClient` interface is the only provider-specific surface (§3); a swap touches one file and its tests, not the data-assembly or rubric maths |
| An AI-written summary says something false about a student (hallucination) | FR-25 forbids editing, so there is no in-app fix once generated. Mitigated, not solved: the prompt (§4) restricts the model to the supplied data and forbids inventing specifics. A materially wrong summary is a mentor-reported incident, not something this spec can prevent structurally |
| Cost / rate limits at real scale | Out of scope for this spec — this is an MVP for one cohort; a production cost/quota review belongs with the leadership escalation this spec is proceeding ahead of (§0), not invented here |

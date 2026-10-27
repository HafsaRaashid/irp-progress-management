# Slice 1 — Deployed Integration Skeleton

**Date:** 2026-07-28
**Author:** Damian De Cruz (solo — all three BMAD roles)
**Status:** Approved, ready for implementation planning
**Covers:** FR-1 (partial), FR-2 (partial), FR-9, FR-12, FR-13, FR-14, FR-15, NFR-5, NFR-6, NFR-7, NFR-8, NFR-12, NFR-14
**Feeds deliverables:** D2 (spec + generated types), D3 (deploy + observability)

> **Update 2026-10-21:** the cycle engine described below (`cycleContaining`, `cycleFor`, fixed
> 10th → 9th windows) was replaced by batch-anchored cycles — see
> [ADR-0035](../../adr/0035-cycles-are-cut-from-the-batch-dates.md). The text below records the
> original slice-1 design.

---

## 1. Why this slice exists

The Month 2 grade is four deliverables at 25 points each. D1 is complete. D2, D3 and D4 are
API contract quality, deployment with observability, and load testing — **none of which
require the AI evaluation slice, the winner PDF, notifications, or most of the feature
surface.** D4 cannot start at all until something is deployed.

`handoff.md` originally sequenced deploy at Phase 5, behind eight Phase-4 feature tasks, one
of which (T-17) is blocked on O-5. That parked 25 points behind a blocked task.

This slice inverts that: prove **every integration boundary** end-to-end on Azure first, with
a deliberately trivial feature payload. Features then land on a pipeline already known to
work.

There are two distinct kinds of risk here and they are deliberately separated:

| Risk | Nature | How it's proven |
|---|---|---|
| **Integration** — deploy, auth, DB, tracing | Only provable by deploying | This slice |
| **Logic** — the cycle/date engine | Pure functions, no I/O | Unit tests, in parallel, no deploy dependency |

Neither waits on the other.

## 2. Decisions already taken

| Decision | Where |
|---|---|
| Tailwind + shadcn/ui, retuned token-first | [ADR-0001](../../adr/0001-tailwind-and-shadcn-for-web-ui.md) |
| Next.js 16 in place of the pinned 15 — **sign-off pending (O-12)** | [ADR-0004](../../adr/0004-nextjs-16-over-pinned-15.md) |
| TypeScript 6.0.3, not 7.0.2 — typescript-eslint is ESLint's TS parser and caps at `<6.1.0` | [ADR-0005](../../adr/0005-typescript-6-for-eslint-compatibility.md) |
| Light default, dark supported, both contrast-verified | [ADR-0002](../../adr/0002-light-default-with-dark-support.md) |
| Cycle ribbon as the FR-28 surface | [ADR-0003](../../adr/0003-cycle-ribbon-as-fr-28-summary.md) |
| Visual system, tokens, typography, motion, copy voice | [`docs/design-system.md`](../../design-system.md) |
| Deploy to Azure Container Apps on a personal Azure free account | §7 below |
| App-level OIDC with bearer JWTs | §6 below |

**No stack constraint is waived.** Cloudflare was investigated and rejected: Cloudflare
Containers requires the Workers Paid plan with no free tier, and Cloudflare Workers cannot
run Fastify at all. A personal Azure free account gives Container Apps, PostgreSQL Flexible
Server B1ms (free for 12 months), App Insights and Entra ID at no cost for the sprint.

## 3. Scope

### In

- pnpm workspace monorepo scaffold, TypeScript strict throughout, ESLint with type-aware rules
- `packages/core` — the cycle/date engine, pure and exhaustively tested
- `spec/openapi.yaml` covering exactly two endpoints, lint-clean at zero warnings
- Generated `packages/types` and `packages/client`, with CI failing on staleness
- Fastify API with JWT validation, Prisma, and one authenticated endpoint
- Next.js web app running the OIDC flow, with design tokens configured
- `infra/main.bicep` provisioning the full environment
- Two GitHub Actions workflows: PR checks, and deploy on merge
- OpenTelemetry → Application Insights on every request
- k6 scripts committed (run and reported at D4)

### Out

The dashboard UI, the cycle ribbon, submissions, absence marking, the review flow, AI
evaluation, the winner PDF, notifications, the full Prisma schema, and **all shadcn component
building**.

"Design tokens are configured" means specifically: the Tailwind config and the CSS custom
properties from [`docs/design-system.md`](../../design-system.md) §3–§5 exist and are wired
into `apps/web`, with both light and dark value sets. No shadcn component is added in this
slice. This ordering is deliberate — ADR-0001 requires tokens to exist *before* the first
component, never after, because retro-fitting the retune is how the result ends up reading as
stock shadcn.

## 4. Repository layout

```
irp-progress-management/
├── spec/openapi.yaml            hand-written, source of truth
├── apps/
│   ├── web/                     Next.js 16 (ADR-0004)
│   └── api/                     Fastify
├── packages/
│   ├── types/                   GENERATED — never hand-edited
│   ├── client/                  GENERATED — never hand-edited
│   └── core/                    NEW — pure domain logic
├── infra/main.bicep
├── tests/load/
├── docs/
└── .github/workflows/
```

`packages/core` is additive to the layout prescribed in the challenge brief. **Justification:**
the date engine must be unit-testable with no database and no HTTP, and is consumed by both
apps. Placing it in `apps/api` would make it untestable in isolation and unusable from `web`.
The challenge's listed structure is a minimum, not an exhaustive whitelist.

## 5. The cycle/date engine (`packages/core`)

The subtlest logic in the system, and the reason it is built in parallel rather than after
deployment. Every downstream feature depends on it being right.

### Rules it encodes

| Rule | Source |
|---|---|
| All timestamps stored in UTC | NFR-12 |
| All boundaries evaluated in Asia/Colombo (UTC+05:30, no DST) | NFR-12, FR-9 |
| Weekdays are required; weekends are optional and may hold **Extra** entries. A weekend is never missed, never late, never in a denominator | FR-12, FR-33 |
| Cycles run the 10th → the 9th of the following month | FR-9 |
| Deadline for a weekday is 23:59:59 Asia/Colombo on that date | FR-13 |
| Entries for the immediately preceding weekday are accepted one further day, flagged Late | FR-13 |
| After the grace window closes, the day is final | FR-14 |
| An entry may only target the current or immediately preceding weekday | FR-15 |

### Surface

All calendar arithmetic runs on **civil dates** — branded `YYYY-MM-DD` strings — never on
`Date` objects. Only two functions in the engine are timezone-aware. Everything else is pure
string and integer arithmetic with zero timezone surface, which is what makes the engine
deterministic under any server timezone.

```
type CivilDate = string & { readonly __brand: "CivilDate" }

// the only two timezone-aware functions in the engine
toProgrammeDate(instant: Date): CivilDate
endOfProgrammeDay(date: CivilDate): Date

isWeekday(date: CivilDate): boolean
previousWeekday(date: CivilDate): CivilDate     // Monday → the preceding Friday
nextWeekday(date: CivilDate): CivilDate
workingDaysBetween(start, end): CivilDate[]
cycleContaining(date: CivilDate): { start, end }
cycleFor(date, admission): { start, end, index } | null
cycleWorkingDays(bounds): CivilDate[]
submissionWindow(now: Date): { targetDates: CivilDate[], graceClosesAt: Date }
graceDeadlineFor(target: CivilDate): Date
canSubmitFor(target: CivilDate, now: Date): boolean
classifyDay(date, facts, now):
  // required days (weekdays)
  'submitted' | 'late' | 'absent' | 'missed' | 'pending'
  // optional days (weekends)
  | 'extra' | 'none'
  // either
  | 'future'
```

**One uniform grace rule covers both kinds of day:** grace for any date runs to the end of the
next *weekday*. Friday, Saturday and Sunday therefore all stay open until Monday 23:59:59
Colombo, and `graceDeadlineFor` needs no weekend special-casing.

### Cycle anchoring — resolved, not assumed

FR-9 says cycles run the 10th → 9th "anchored to the batch's admission date," which reads
ambiguously for a batch admitted mid-cycle. **FR-27 resolves it:** a student who joins
partway through a cycle is not evaluated for that cycle. So a batch admitted 22 August is not
evaluated for 10 Aug – 9 Sep; its first evaluated cycle is 10 Sep – 9 Oct. This is derived
from the requirements, not assumed — no `// ASSUMPTION` marker needed.

### Testing

TDD, written before implementation. Exhaustive on:

- Monday's previous weekday is the preceding Friday
- Cycle boundaries exactly on the 10th and the 9th
- Short months (10 Feb → 9 Mar)
- Year boundaries (10 Dec → 9 Jan)
- Grace window opening and closing at the exact second
- Mid-cycle admission per FR-27
- A property-style test asserting the engine can **never** return a weekend

**CI runs the date tests under a deliberately wrong system timezone** (e.g. `TZ=America/New_York`)
to catch any reliance on server local time. This is the single most likely silent failure in
the project and the deploy region is not Sri Lanka.

**No date library.** The civil-date design above reduces the timezone-aware surface to two
functions, and `Intl.DateTimeFormat` with Node's full ICU covers both. Adding `date-fns` and
`@date-fns/tz` would introduce API surface without removing any of the logic. The zone offset
is *derived* via `Intl`, never hardcoded as `+05:30` — Sri Lanka has observed no DST since
2006, but a future zone change must not silently corrupt every deadline in the system.

## 6. Authentication

App-level OIDC with bearer tokens. Chosen over Container Apps Easy Auth and over a hybrid.

### Why not the platform-level option

Easy Auth needs almost no code and would satisfy NFR-14 immediately, but it couples auth to
Container Apps, and it makes D4's auth-gated load scenario awkward. **NFR-3 and D4 require
"10 RPS for 5 minutes, zero token failures" — k6 has to obtain real tokens.** Any design that
only supports interactive browser login makes a graded scenario impossible to run. That
requirement is what settled this, and it is a slice-1 decision, not a week-4 one.

### Shape

Two Entra app registrations, following the standard pattern:

| Registration | Purpose |
|---|---|
| **IRP API** | Exposes scope `access_as_user`; defines app roles `Admin` and `Student` |
| **IRP Web** | Client; redirect URIs for local and staging; requests the API scope |

Plus a **service principal for k6**, using the client-credentials flow with an app role
assigned, so load tests authenticate without a browser.

Flow: browser → Next.js runs the OIDC flow against Entra → session held server-side
(Auth.js v5 with the Microsoft Entra provider is the expected library; final choice is the
Impl Lead's per §4.2 of the PRD) → Next.js calls the API with a bearer token → Fastify
validates the JWT against Entra's JWKS (`jose`, with key caching), verifying issuer, audience
and expiry → roles read from the token's app-role claim.

Roles map directly to FR-2 (Admin/Student), FR-4 (Admins share access across batches) and
FR-30 (students see only their own data).

### Known gap

A personal Entra tenant is **not** the Bistec training tenant that FR-1 names. Auth is
generic OIDC, so this is an issuer and app-registration swap later, not a rewrite. **FR-1 is
partially satisfied only** until Bistec tenant access is granted. Worth an ongoing Teams ask;
no longer blocking.

## 7. Infrastructure

All in `infra/main.bicep`. Deployed to a personal Azure free account.

| Resource | Notes |
|---|---|
| Container Apps Environment | |
| Container App: `web` | Public ingress |
| Container App: `api` | **Public ingress** — k6 must reach it directly for D4, and NFR-14 requires a public URL behind AD auth |
| PostgreSQL Flexible Server B1ms | Free for 12 months: 750 h/month, 32 GB storage, 32 GB backup |
| Log Analytics workspace | |
| Application Insights | |

**Container registry: GHCR, not ACR.** ACR Basic is roughly $5/month and this environment
stays free. A one-line swap if fully-Azure-native is preferred later.

### The Bicep exception, stated honestly

> **SUPERSEDED, 2026-07-29.** The decision below — a committed, documented,
> idempotent `az ad app` bootstrap script — was replaced by the **Microsoft
> Graph Bicep extension** (`Microsoft.Graph/applications@v1.0`), which is GA and
> sufficient. See **ADR-0011**. The file lands in **Plan 4**, not Plan 3,
> because the dev bypass (ADR-0012) removed Plan 3's dependency on the
> registrations. The paragraph is kept for the reasoning it records.

**Entra app registrations are not ARM resources** — they are Microsoft Graph objects, and
Bicep cannot create them natively. Options are the Microsoft Graph Bicep extension (preview)
or a committed bootstrap script.

Decision: a **committed, documented, idempotent `az ad app` bootstrap script**, invoked once
and recorded in the deploy runbook. `CLAUDE.md` bans hand-run `az` for anything that *should
be* Bicep; this genuinely cannot be. A committed script is re-runnable and reviewable, so it
still satisfies D3's "infrastructure as code, no portal drift." Everything else is real Bicep.
Portal clicks remain banned.

## 8. API surface

Two endpoints, both fully specified in `spec/openapi.yaml` **before** any handler is written.

| Endpoint | Auth | Proves |
|---|---|---|
| `GET /health` | none | Liveness for Container Apps probes. No DB touch. |
| `GET /api/v1/me` | bearer | JWT validation, JWKS, role claims, Prisma, Postgres, tracing — the whole chain in one request |

`/api/v1/me` is not throwaway; it is the foundation of FR-1 and FR-2 and stays in the product.

Contract rules, per `CLAUDE.md` and NFR-7/NFR-8 — every endpoint defines `200`, `400`, `401`
and `500`; every schema carries examples; every parameter carries a description; request
bodies are `additionalProperties: false`; errors use RFC 7807.

### Data model for this slice

Minimal: a `User` table sufficient to resolve the caller's identity and role. The full schema
(`Batch`, `Enrolment`, `Entry`, `DailyReport`, `AbsenceRecord`, `Cycle`, `Evaluation`,
`Override`, `Award`) is deliberately deferred — it depends on O-6 for the evaluation side, and
building it now would be speculative.

## 9. Error handling

RFC 7807 Problem Details on every error path, produced by a single Fastify error handler:
validation → 400, auth → 401, unhandled → 500. Stack traces are never leaked to the client.

**The OpenTelemetry trace ID is included as a Problem Details extension member.** A
user-reported error then maps directly to an App Insights trace. Cheap to build, and it
serves D3's observability criterion.

## 10. Testing

| Layer | Approach |
|---|---|
| `packages/core` | TDD, exhaustive, run under a deliberately wrong `TZ` in CI |
| API | Integration tests against Dockerised Postgres, hitting real routes. Tokens are signed with a locally generated test key pair and the JWKS endpoint is stubbed, so tests never call Entra; the validation code path under test is the same one production uses |
| Contract | `redocly lint` at zero warnings; CI fails if regenerating types produces a diff |
| Load | k6 scripts committed now, executed and reported at D4 |

The staleness check matters: it is what makes "generated, never hand-edited" enforceable
rather than a convention.

## 11. CI/CD

**On PR:** install → `redocly lint` → generate types and client → fail on diff → typecheck →
lint → unit tests → integration tests

**On merge to `main`:** build both images → push to GHCR → deploy Bicep → smoke test.
Target under 8 minutes (NFR-5).

The smoke test is a workflow step, not a manual check: after deployment it requests `/health`
and expects 200, then requests `/api/v1/me` without a token and expects **401 with an RFC 7807
body**. A 200 there would mean the endpoint is unauthenticated, which is a deploy-blocking
failure. The workflow fails on either check, and the run records the elapsed pipeline time so
NFR-5 is measured rather than assumed.

## 12. Definition of done

Verifiable, evidence-based:

- [ ] Public staging URL reachable, gated by Entra
- [ ] `GET /api/v1/me` returns caller identity derived from a real token
- [ ] A request trace visible in App Insights within 60 seconds
- [ ] Deploy pipeline green, under 8 minutes
- [ ] `redocly lint` — zero errors **and** zero warnings
- [ ] Date engine fully unit-tested, green under a wrong-timezone CI run
- [ ] Rollback to the previous revision tested, with exact commands documented

## 13. Risks and open items

| Item | Status |
|---|---|
| **O-10** (new) | **FR-13 and FR-15 conflict on the grace window.** FR-13 says a late entry is accepted "for one further day"; FR-15 says an entry may target "the current weekday or the immediately preceding weekday". These disagree on Monday — under FR-13, Friday's grace closes Saturday night; under FR-15, Friday is still Monday's immediately preceding weekday. Implemented on the FR-15 reading (grace runs to the end of the next **weekday**), marked `// ASSUMPTION: O-10`. Consistent with weekday-only arithmetic and with weekends never counting against a student. **Needs mentor confirmation.** |
| **O-11** (new) | **Weekends reclassified from "no submission slot" to optional Extra work** (2026-07-28), revising FR-12 and adding FR-33. Weekdays stay required; weekends may hold entries counted as Extra, never missed, never late, never in a denominator. **Changes §3.4, which the §4.2 standing rule reserves to the decision owner — needs mentor sign-off.** |
| **O-5** (AI provider) | Does not touch this slice — no Evaluation table needed |
| **O-6** (rubric wording) | Does not touch this slice — full schema deferred |
| **FR-1** | Partially satisfied. Personal Entra tenant, not the Bistec training tenant |
| Bistec brand colour | `--primary` remains a placeholder indigo; one-token swap when supplied |
| Entra app registration via Bicep | Not possible natively; committed bootstrap script instead (§7) |
| 200 RPS burst on free-tier Container Apps | Unproven until D4. The $200/30-day credit is headroom if a larger tier is needed during load testing |
| Demo Day #2 date (O-9) | Still unscheduled — affects sequencing beyond this slice, not this slice |

## 14. What comes after

Slice 2 candidates, in the order the requirements suggest: the full Prisma schema and seed
data, then the submission flow (FR-10 to FR-17), then the review flow (FR-18 to FR-20), then
the mentor dashboard and cycle ribbon (FR-28) — which is the stakeholder's must-ship and
should land as early as the dependencies allow.

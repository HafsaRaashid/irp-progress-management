# Plan 8 — Notifications Implementation Plan

**Goal:** Fire a Teams and email notification to every mentor on entry submission, absence
marking, and daily-report state transition (FR-21), fire-and-forget, without coupling the
triggering API call's success to either channel.

**Architecture:** A new `NotificationService` (`apps/api/src/services/notification-service.ts`),
built once at boot like `dayService`/`rosterService`, with one method `notify(event)` that never
throws and is never awaited by its caller. Two adapters — `TeamsWebhookSender` (native `fetch`)
and `SmtpEmailSender` (`nodemailer`, new dependency) — sit behind a shared `NotificationSender`
interface so `notify()` never depends on which channel is configured. `apps/api/src/routes/entries.ts`,
`absences.ts`, and `reviews.ts` each gain one `notify()` call after their existing write commits.

**Tech Stack:** Fastify + TypeScript (existing), `nodemailer` (new), native `fetch` for Teams,
OpenTelemetry hand-written spans (ADR-0007), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-plan-8-notifications-design.md` — all sections.
**ADRs:** `docs/adr/0024-teams-webhook-over-graph-api.md`,
`docs/adr/0025-smtp-m365-over-acs-or-third-party.md` — both written and accepted before this plan's
first task, per the spec's §9.

**Branch:** `feat/plan-8-notifications`. One branch, one PR.

**FRs:** FR-21.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **No `spec/openapi.yaml` change.** FR-21 adds no new HTTP endpoint and no new response shape —
  Teams/email are side effects of existing writes, not API surface. If a task seems to need a spec
  change, stop; the design deliberately keeps this off the contract (spec §3).
- **Fire-and-forget is load-bearing (spec D5).** `notify()` must never be `await`ed by a route
  handler, and a sender rejection must never propagate to the HTTP response. Every task touching a
  route must prove this with a test where the injected sender throws on every call and the route
  still returns its normal success status.
- **No debouncing, no notification-sent state (spec D6).** One notification per entry, per
  absence, per transition. Do not add a "already notified" table or in-memory cache — this was
  explicitly rejected in the design.
- **Students are never recipients (spec D2).** `notify()` only ever reads `role: "ADMIN"` users.
  A test asserting a student's own submission does not address the student is part of Task 1.
- **`AUTH_DEV_BYPASS` and the dev-server ports are untouched by this plan.** Nothing here is a new
  process entry point in the `apps/web` sense — this is `apps/api` only.
- **New env vars are optional everywhere except where notifications should actually fire** (spec
  §7). `pnpm dev` and CI must keep working with all six unset — a missing `TEAMS_WEBHOOK_URL` or
  SMTP block no-ops that channel with one startup warning, never a boot failure. Do not add these
  to `config.ts`'s `REQUIRED_ENV_NAMES`.
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
```

This plan touches `apps/api` only — no `apps/web` build is part of its verification set.

### File structure

| File | Responsibility | Task |
|---|---|---|
| `apps/api/src/services/notification-service.ts` | Create — `NotificationEvent` union, `NotificationSender` interface, `createNotificationService` factory | 1 |
| `apps/api/src/services/notification-senders.ts` | Create — `TeamsWebhookSender`, `SmtpEmailSender` | 1 |
| `apps/api/test/notification-service.test.ts` | Create — unit tests against fake `UserRepo`/senders, no DB | 1 |
| `apps/api/test/notification-senders.test.ts` | Create — Teams payload shape, SMTP call shape, both against fakes | 1 |
| `apps/api/package.json` | Modify — add `nodemailer`, `pino` (service-local logger), `@types/nodemailer` | 1 |
| `apps/api/src/config.ts` | Modify — six new optional fields, no new required-env entries | 2 |
| `apps/api/.env.example` | Modify — document the six new vars as optional | 2 |
| `apps/api/src/index.ts` | Modify — construct senders + `notificationService`, wire into `buildServer` | 2 |
| `apps/api/test/config.test.ts` | Modify — new fields default sanely when unset | 2 |
| `apps/api/src/server.ts` | Modify — `notificationService` on `ServerDeps`, passed to three route registrations | 3 |
| `apps/api/src/routes/entries.ts` | Modify — `notify({ type: "EntrySubmitted", ... })` after the write | 3 |
| `apps/api/src/routes/absences.ts` | Modify — `notify({ type: "AbsenceMarked", ... })` on create only, never on delete | 3 |
| `apps/api/src/routes/reviews.ts` | Modify — `notify({ type: "ReportTransitioned", ... })` after transition | 3 |
| `apps/api/test/helpers/build-test-server.ts` | Modify — inject a no-op `notificationService` by default, overridable | 3 |
| `apps/api/test/entries-endpoint.test.ts` | Modify — add the "sender throws, request still succeeds" case | 3 |
| `apps/api/test/absences-endpoint.test.ts` | Modify — same, plus "delete does not notify" | 3 |
| `apps/api/test/reviews-endpoint.test.ts` | Modify — same, plus "notify called once per transition with correct `to`" | 3 |
| `docs/ONBOARDING.md` | Modify — §4 documents the six new optional vars | 4 |
| `handoff.md` | Modify — §2a Plan 8 row: Not started → Merged, with PR link | 4 |

---

## Task 1 — `NotificationService` core and the two senders

**Do:**
1. `NotificationEvent` discriminated union and `NotificationSender` interface exactly as spec §3.
2. `createNotificationService(deps)` where `deps` is `{ userRepo: Pick<UserRepo, "list">, teams: NotificationSender, email: NotificationSender, webBaseUrl: string, logger: { warn(obj: Record<string, unknown>, msg: string): void } }`. `notify(event)` builds the message content (spec §5), looks up `userRepo.list({ role: "ADMIN", archived: false })`, and dispatches to both channels without awaiting the caller.
3. `TeamsWebhookSender(webhookUrl: string | undefined)` — `undefined` means "no-op, log once at construction". Builds the MessageCard shape from spec §5, POSTs with `fetch`.
4. `SmtpEmailSender(config: SmtpConfig | undefined)` — same no-op-when-unset shape, wraps `nodemailer.createTransport`.
5. Each dispatch attempt wrapped in its own span (`notification.teams` / `notification.email`) per spec §6, using a `Tracer` passed into the service the same way `tracerProvider` reaches other boot-time code.
6. A failure inside either sender is caught, logged at `warn` with event type + recipient, and never rethrown to `notify()`'s caller.

**Test:**
- `NotificationService.notify` builds a correctly shaped Teams card for each of the three event types, with the `{webBaseUrl}/review/{studentId}` link.
- `NotificationService.notify` fans out one email per current `ADMIN` user, addressed individually; a `STUDENT` in the same roster is never addressed.
- A sender that rejects does not throw out of `notify()`.
- An empty `ADMIN` roster skips email fan-out but still calls the Teams sender once.
- `TeamsWebhookSender` constructed with `undefined` never calls `fetch` and logs once.
- `SmtpEmailSender` constructed with `undefined` never calls `nodemailer.createTransport`.

**Done when:** `pnpm --filter @irp/api test notification-service notification-senders` passes; `pnpm --filter @irp/api exec tsc --noEmit` is clean.

## Task 2 — Configuration and boot wiring

**Do:**
1. `AppConfig` gains: `teamsWebhookUrl: string | undefined`, `smtp: { host: string; port: number; user: string; pass: string; fromEmail: string } | undefined` (all-or-nothing — partial SMTP config is a startup warning, not a partial sender), `webBaseUrl: string` (defaults to `http://localhost:3100`).
2. None of the six join `REQUIRED_ENV_NAMES`.
3. `apps/api/.env.example` documents all six as optional, matching spec §7's block, with a comment that an unset value no-ops that channel.
4. `index.ts` constructs `TeamsWebhookSender`, `SmtpEmailSender`, and `createNotificationService`, then threads `notificationService` into `buildServer`'s deps.

**Test:**
- `config.test.ts`: all six env vars unset → `teamsWebhookUrl`/`smtp` are `undefined`, `webBaseUrl` defaults correctly. Full SMTP block set → `smtp` is populated. Partial SMTP block (e.g. host without user) → `smtp` is `undefined`, not a throw (config loading never fails on this; the sender logs the warning at construction, per spec §7's "keeps `pnpm dev` unchanged" intent).

**Done when:** `pnpm --filter @irp/api test config` passes; `pnpm --filter @irp/api dev` boots clean with no notification env vars set (manual check, logs the two no-op warnings).

## Task 3 — Wire `notify()` into the three routes

**Do:**
1. `ServerDeps` gains `notificationService: NotificationService`; `buildServer` passes it to `entryRoutes`, `absenceRoutes`, `reviewRoutes`.
2. `entries.ts`: after `entryRepo.addEntry` succeeds, call `notify({ type: "EntrySubmitted", studentId, entryDate, submittedAt })` before `return`.
3. `absences.ts`: the `POST` handler calls `notify({ type: "AbsenceMarked", ... })` after `create`. The `DELETE` handler calls nothing (spec §2 — retraction is not a submission).
4. `reviews.ts`: after `entryRepo.transition` succeeds, call `notify({ type: "ReportTransitioned", studentId: report.studentId, reportId: report.id, to: req.body.to })`.
5. `test/helpers/build-test-server.ts` gains an optional `overrides` parameter so a test can inject a spy/throwing `notificationService`; default is a real `createNotificationService` wired to no-op senders (both env-shaped `undefined`), so existing tests see zero behavioural change.

**Test:**
- Add one case per route file: inject a `notificationService` whose `notify` throws synchronously — the route's existing success assertions (status code, body) still pass.
- `reviews-endpoint.test.ts`: a spy `notificationService` records exactly one `ReportTransitioned` call per transition request, with `to` matching the request body.
- `absences-endpoint.test.ts`: a spy records a call on `POST`, records **no** call on `DELETE` of the same record.
- `entries-endpoint.test.ts`: a spy records exactly one `EntrySubmitted` call with the entry's `studentId` and `entryDate`.
- Full existing suite (`pnpm --filter @irp/api test`) still green — proves the default no-op wiring doesn't disturb anything.

**Done when:** `pnpm --filter @irp/api test` passes in full; `pnpm --filter @irp/api exec tsc --noEmit` is clean.

## Task 4 — Documentation

**Do:**
1. `ONBOARDING.md` §4: document the six new `apps/api/.env` variables (`TEAMS_WEBHOOK_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFICATIONS_FROM_EMAIL`, `WEB_BASE_URL`) as optional for local dev, per spec §10.
2. `handoff.md` §2a: Plan 8 row moves from "Not started" to "Merged, PR #<n>" once the PR lands (fill in the number in the merge commit, not in this branch's own commits — see note below).

**Done when:** both docs reviewed for accuracy against the actual shipped config names.

---

## Note on the PR-number line in `handoff.md`

Task 4's `handoff.md` edit cannot know its own PR number ahead of time. Write the row as "Merged,
PR #TBD" in this branch, and fill in the real number as a one-line follow-up commit once the PR is
actually merged — the same pattern already used for prior slices in this file's history.

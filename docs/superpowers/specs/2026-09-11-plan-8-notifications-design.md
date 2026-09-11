# Notifications — Teams and Email on Submission and State Change — Design

**Date:** 2026-09-11
**Author:** Mohaideen Abdullah (spec lead, with Claude Code)
**Status:** Draft — pending review by Danella De Cruz before Hafsa Raashid begins implementation
**Feeds:** Plan 8 (`handoff.md` §2a), one branch and one PR, in `HafsaRaashid/irp-progress-management`
**FRs:** FR-21 — "Notifications fire on submission and on state change, delivered to Microsoft
Teams and email."
**Governs / closes:** none. Opens two new ADRs (§9).
**ADRs owed by this slice:** two — see §9

---

## 1. Scope and decision record

Decisions taken during brainstorming, all by the spec lead with the requesting stakeholder:

| # | Decision | Choice |
|---|---|---|
| D1 | Trigger events | **Entry submission, absence marking, and daily-report state transition** — all three student/mentor writes that FR-21's "submission and state change" language covers. Rejected: transitions-only (loses the "on submission" half of FR-21 outright). |
| D2 | Recipients | **Mentor-only.** Every event (including a student's own entry/absence) notifies mentors; students receive no notifications. Consistent with the existing non-goal that students see no score, rank, or cross-student visibility — extended here to mean students are not part of the notification loop at all. Rejected: cross-notify (student also learns when their own report transitions) and both-directions-to-everyone — both add a student-facing surface FR-21 does not ask for and the PRD's non-goals lean against inventing. |
| D3 | Teams delivery mechanism | **Incoming Webhook URL**, one per deployment, POSTed to directly. Rejected: Microsoft Graph API messaging — it would need new Graph permissions/consent through the same tenant-governance process that already has O-5 (AI provider) and the real Entra cutover stalled; a webhook needs no app-registration change and works today regardless of that governance state. |
| D4 | Email delivery mechanism | **SMTP via Microsoft 365**, using a service mailbox in the training tenant. Rejected: Azure Communication Services Email (a new Azure resource to provision and bill, for no capability M365 SMTP lacks here) and a third-party transactional provider (a new external vendor handling tenant email addresses and submission-derived content — the same class of data-processing sign-off O-5 requires for the AI provider, which would block this plan on the same open point rather than ship independently of it). |
| D5 | Blocking behaviour | **Fire-and-forget, best-effort.** The triggering API call (entry, absence, transition) always succeeds and returns as soon as its own write commits; notification dispatch happens after, and a Teams/SMTP failure is logged, never surfaced to the caller. Rejected: synchronous-with-retry — it couples the core app's availability to two external services FR-21 treats as a side effect, not the point of the request. |
| D6 | Entry granularity | **One notification per entry**, not debounced. Matches FR-21's "on submission" literally. Rejected: one-per-student-per-day debouncing — adds state ("already notified today") for a problem (notification volume) nobody has reported yet; revisit only if it proves noisy in practice. |

**Out of scope.** AI evaluation (Plan 9, blocked on O-5), winner computation + PDF (Plan 10) —
FR-21 covers submission/state-change notifications only, not the separate emailed-report question
already tracked as O-2. No in-app notification centre or read/unread state — Teams and email
*are* the notification surface, nothing is persisted server-side beyond an audit log entry (§6).
No per-mentor notification preferences (mute, digest, channel choice) — every mentor gets every
event, full stop, matching D2's blanket recipient rule. No retry queue or dead-letter store beyond
what's in §6 — this is a fire-and-forget best-effort feature, not a delivery-guarantee one.

## 2. The requirement, and why three trigger points

FR-21's two halves map cleanly to existing writes once you look at what "submission" means in
this system:

- **On submission** — a student's `POST /api/v1/entries` (a text entry) and `POST
  /api/v1/absences` (marking a weekday absent) are both student-initiated records of a day. Both
  are "a submission happened" from a mentor's point of view, so both trigger.
- **On state change** — `POST /api/v1/daily-reports/:id/transition` moves a report through
  `Submitted → In Review → Evaluated` (`apps/api/src/routes/reviews.ts:65-74`). Each transition
  triggers.

Absence *removal* (`DELETE /api/v1/absences/:date`) does **not** trigger — it retracts a prior
submission rather than making one, and FR-21 does not ask for "un-submission" notifications.

## 3. Architecture

A new `NotificationService` in `apps/api/src/services/notification-service.ts`, following the
existing service pattern (`day-service.ts`, `roster-service.ts`): a factory function taking its
dependencies (a `UserRepo` for recipient lookup, and the two senders below) and returning an
object with one method:

```ts
notify(event: NotificationEvent): void
```

`NotificationEvent` is a discriminated union:

```ts
type NotificationEvent =
  | { type: "EntrySubmitted"; studentId: string; entryDate: string; submittedAt: Date }
  | { type: "AbsenceMarked"; studentId: string; date: string; reason: string }
  | { type: "ReportTransitioned"; studentId: string; reportId: string; to: "InReview" | "Evaluated" };
```

Two adapters implement a shared `NotificationSender` interface:

```ts
interface NotificationSender {
  sendTeams(message: TeamsMessage): Promise<void>;
  sendEmail(message: EmailMessage): Promise<void>;
}
```

- **`TeamsWebhookSender`** — `fetch(TEAMS_WEBHOOK_URL, { method: "POST", body: JSON.stringify(card) })`.
  No new dependency; native `fetch` is already available (Node 24).
- **`SmtpEmailSender`** — wraps `nodemailer` (new dependency) configured from `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFICATIONS_FROM_EMAIL`.

`notify()` itself is synchronous-looking but never awaited by its caller (D5): internally it
kicks off an async `dispatch()` and swallows/logs any rejection.
`apps/api/src/routes/entries.ts`, `absences.ts`, and `reviews.ts` each gain one line, after their
existing write succeeds and *before* the handler returns:

```ts
notificationService.notify({ type: "EntrySubmitted", studentId: entry.studentId, ... });
```

This mirrors the existing dependency-injection shape: `notificationService` is threaded through
`ServerDeps`/route `opts` exactly like `entryRepo` or `dayService` today, and `buildServer`
constructs the real senders (or test doubles) the same way `index.ts` constructs the real repos.

## 4. Recipients

No new "mentor list" configuration. At send time, `notify()` calls `UserRepo` for every
`role: ADMIN, deletedAt: null` user (mentors, per the glossary, share access across all batches —
there is no per-batch mentor assignment to narrow against) and sends each their own email. Teams
delivery is a single shared webhook — one message per event, posted once, visible to whichever
channel the webhook is bound to; it is not per-recipient.

If the ADMIN roster is empty (a seed/config gap, not a real-world case) `notify()` no-ops the
email fan-out and still posts to Teams — the two channels fail independently.

## 5. Message content and the deep link

Every message (Teams card and email body) carries: student display name, the event
(`Entry submitted` / `Absent — <reason>` / `Moved to In Review` / `Moved to Evaluated`), the date
in question, and a link to `{WEB_BASE_URL}/review/{studentId}` — the existing per-student review
page (`apps/web/app/(app)/review/[studentId]/page.tsx`) a mentor already uses to act on that
student's day. `WEB_BASE_URL` is a new `apps/api` env var (distinct from `AUTH_URL`, which is
`apps/web`'s own — `apps/api` has no existing notion of where the web app is hosted).

Teams uses the simple webhook "MessageCard" JSON shape (title + text + one "Open review" action
button to the deep link); email is a short plain-text body with the same three facts and the same
link as a bare URL — no HTML template, no attachment (submissions are text-only; there is nothing
to attach).

## 6. Error handling and observability

Per D5, a sender failure is caught inside `dispatch()`, logged via the app's existing pino logger
at `warn` (not `error` — a Teams outage is not an application fault) with the event type and
recipient, and nothing propagates to the HTTP response. No retry: a missed notification is a
missed side effect, not a missed write — the entry/absence/transition is durably committed in
Postgres regardless of whether anyone was told about it.

Each dispatch attempt (success or failure, per channel) is wrapped in its own OpenTelemetry span
(`notification.teams` / `notification.email`, following the existing hand-written tracing
convention — ADR-0007), so a silent failure is still visible in Application Insights within the
NFR-6 60-second window, even though it never surfaces to a user.

## 7. Configuration

New `apps/api/.env` variables, all required only in an environment where notifications should
actually fire:

```
TEAMS_WEBHOOK_URL=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
NOTIFICATIONS_FROM_EMAIL=
WEB_BASE_URL=http://localhost:3100
```

If `TEAMS_WEBHOOK_URL` or the SMTP block is unset, the corresponding sender no-ops with a single
startup-time warning log rather than failing to boot — this keeps `ONBOARDING.md`'s local dev
flow unchanged (no new *required* secret for `pnpm dev`) while still exercising the full route →
service → sender wiring against a logging stub. Production (`infra/main.bicep`, out of this
slice's scope — see §11) is where these become non-optional in practice.

## 8. Testing

| Level | Case |
|---|---|
| Unit | `NotificationService.notify` calls the sender with a correctly shaped Teams card for each of the three event types |
| Unit | `NotificationService.notify` fans out one email per current ADMIN user, addressed individually |
| Unit | A sender that rejects does not throw out of `notify()` and does not affect the caller |
| Unit | An empty ADMIN roster skips email fan-out but still posts to Teams |
| Unit | Absence *removal* (`DELETE`) does not call `notify()` |
| Unit | `TeamsWebhookSender` builds a message with the correct `{WEB_BASE_URL}/review/{studentId}` link |
| Integration | `POST /api/v1/entries` still returns 201 and commits when the injected sender throws on every call |
| Integration | `POST /api/v1/daily-reports/:id/transition` triggers exactly one `ReportTransitioned` notification per call, with `to` matching the requested target |
| Integration | Existing `entries`/`absences`/`reviews` test suites continue to pass with a no-op `NotificationSender` test double — no real HTTP/SMTP call is ever made in CI |

No Playwright coverage — FR-21's delivery surface is Teams/email, neither of which the existing
`dashboard-flows.spec.ts` browser suite can observe; the integration tests above are the
verification boundary for this slice.

## 9. ADRs owed

Per `CLAUDE.md`, a decision with a plausible rejected alternative needs an ADR naming at least
two. Two qualify, and both should be written **before** implementation:

**ADR — Teams Incoming Webhook over Graph API for notification delivery.** Rejected: Microsoft
Graph API messaging (needs new Graph permissions/consent, which routes through the same
tenant-governance process already stalled on O-5/the Entra cutover); a bespoke bot/app (far more
setup than a one-time webhook URL for a one-directional, unauthenticated notification).

**ADR — SMTP via Microsoft 365 over Azure Communication Services or a third-party provider for
notification email.** Rejected: Azure Communication Services Email (a new billable Azure resource
for a capability the existing tenant's SMTP already provides); a third-party transactional
provider (a new external vendor processing submission-derived content and tenant email addresses —
the same class of data-processing question O-5 raises for the AI provider, which would import that
open point into a plan that doesn't otherwise depend on it).

## 10. Documentation to update

- `handoff.md` §2a — mark Plan 8 in progress / merged once shipped
- `docs/interview-and-prd.md` §5 — O-2 already assumes "Teams/email notifications still fire for
  submission and review events (FR-21)"; no change needed there, but cross-reference this spec
- `ONBOARDING.md` §4 — document the six new optional `apps/api/.env` variables and that they are
  optional for local dev
- `docs/adr/` — the two ADRs from §9, before implementation starts

## 11. Risks

| Risk | Handling |
|---|---|
| Teams webhook URL or SMTP credentials are a secret checked into the wrong place | Both are env vars only, never committed — same convention as `DATABASE_URL`/`AUTH_SECRET` today. Production values live in Container Apps secrets (`infra/main.bicep`), out of this slice's scope to wire — flagged here so the implementer doesn't assume it's already there. |
| SMTP via M365 needs a service-account mailbox that doesn't exist yet | Not a code blocker — the sender is built against config either way. Flagged as a manual-setup dependency, same category as the Entra tenant work already tracked in `handoff.md` §1. |
| One-notification-per-entry (D6) turns out noisy for an active student | Accepted risk, deliberately deferred — see D6's rationale. Revisit only with evidence from real usage, not speculatively. |
| Fire-and-forget means a notification can silently never arrive with no operator-visible signal beyond a trace span | Accepted per D5 — this is a side-effect feature, not a delivery-guaranteed one. §6's tracing is the intended detection path, not a retry mechanism. |

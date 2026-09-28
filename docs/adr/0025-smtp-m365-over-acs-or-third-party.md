# ADR-0025 — SMTP via Microsoft 365 over Azure Communication Services or a third-party provider for notification email

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** Mohaideen Abdullah (spec lead), Danella De Cruz (review), Hafsa Raashid (impl)
- **Requirements:** FR-21
- **Relates to:** O-5 (AI provider — the same class of data-processing sign-off a third-party
  provider would import into this plan)

## Context

FR-21's email half needs a way to send a plain-text message, containing a student's display name
and a submission-derived event, to every mentor. Three ways to send that email from `apps/api`:

1. **SMTP via a Microsoft 365 service mailbox** in the Bistec training tenant — the tenant this
   deployment already lives in for auth (ADR-0010/ADR-0012).
2. **Azure Communication Services (ACS) Email** — a purpose-built Azure resource for transactional
   email, provisioned alongside the rest of `infra/main.bicep`.
3. **A third-party transactional email provider** (SendGrid, Postmark, etc.).

Options 2 and 3 both mean a new party — a new Azure resource with its own billing and
provisioning, or an external vendor — receiving submission-derived content (a student's name and
what they did) and mentor email addresses. That is the same class of data leaving the tenant's
direct control that O-5 raises for the AI provider, and it would import O-5's stalled
data-processing sign-off into a plan that otherwise has no dependency on it. Option 1 sends nothing
outside the tenant already handling every other piece of this system's data.

## Decision

Send notification email via **SMTP through a Microsoft 365 service mailbox** in the training
tenant, configured with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and
`NOTIFICATIONS_FROM_EMAIL`. Implemented with `nodemailer`, the standard Node SMTP client — no new
Azure resource, no new external vendor.

## Consequences

### Positive

- No new data-processing relationship to sign off — mail never leaves the tenant that already
  holds every student and mentor record.
- No new billable Azure resource, and nothing in `infra/main.bicep` to provision for this slice.
- `nodemailer` is a single, narrowly-scoped, widely-used dependency — no vendor SDK, no API-key
  lifecycle beyond the mailbox credential itself.

### Negative

- **Deliverability and throughput are M365's, not a dedicated transactional service's** — no
  built-in bounce/open tracking, and M365 mailboxes carry sending-rate limits meant for a person,
  not a notification system. Accepted per the design spec's D6: one notification per entry,
  un-debounced, at the scale of two batches of five students each — well under any M365 rate limit,
  and there is no bounce-handling requirement in FR-21.
- **A service-account mailbox must exist before this ships** (§11 in the design spec) — not a code
  blocker, since the sender is built against config either way, but a manual tenant-setup dependency
  in the same category as the Entra tenant work already tracked in `handoff.md` §1.
- SMTP credentials are a long-lived secret (a mailbox password or app password), versus a
  short-lived API key some transactional providers offer. Mitigated the same way every other secret
  in this repo is: env var only locally, Container Apps secret in production, never committed.

## Alternatives considered

### Rejected — Azure Communication Services Email

Purpose-built for transactional volume, with proper deliverability tooling and no per-mailbox rate
limits. Rejected because it is a new billable Azure resource for a capability the existing tenant's
SMTP already provides at this feature's scale, adding provisioning and cost for no capability FR-21
needs today.

### Rejected — a third-party transactional provider (SendGrid, Postmark, etc.)

Best-in-class deliverability and sending infrastructure. Rejected because it hands submission-
derived content and tenant email addresses to a new external vendor — the same class of
data-processing question O-5 raises for the AI provider — which would block this plan on that open
point rather than let it ship independently, as the design spec's D4 explicitly avoids.

## Revisit when

- Notification volume grows enough that M365's per-mailbox sending limits become a real
  constraint (a batch-size increase far beyond the current two cohorts of five, or debouncing per
  D6 stops being sufficient) — ACS Email is the first upgrade to reconsider, since it needs no new
  data-processing relationship, unlike a third-party provider.
- O-5 resolves and establishes an approved external-data-processing path anyway — at that point a
  third-party provider's better deliverability tooling becomes a lower-cost option to revisit.

# ADR-0024 — Teams Incoming Webhook over Graph API for notification delivery

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** Mohaideen Abdullah (spec lead), Danella De Cruz (review), Hafsa Raashid (impl)
- **Requirements:** FR-21
- **Relates to:** O-5 (AI provider — same tenant-governance path this ADR avoids), ADR-0012 (dev
  auth bypass — the other place this codebase has deliberately stayed off the real Entra tenant)

## Context

FR-21 requires notifications on submission and on state change, delivered to Microsoft Teams and
email. Two ways exist to post into Teams from a server: an **Incoming Webhook URL** bound to one
channel, or the **Microsoft Graph API**'s `chatMessage`/`channelMessage` send endpoints.

Graph messaging needs an app registration with `ChannelMessage.Send` (or equivalent) permission,
consented by a tenant admin, in the same Bistec training tenant that FR-1's real Entra ID cutover
is waiting on (`docs/interview-and-prd.md` O-12) and that O-5's AI-provider decision already stalls
on data-processing sign-off. Adding a new Graph permission scope routes through that identical
governance process — it is not a code change this plan can make unilaterally.

A webhook needs none of that: a channel owner pastes a URL into the channel's connector settings,
and the server `POST`s a JSON payload to it. No app registration, no admin consent, no new scope on
the tenant this project does not yet control end-to-end.

## Decision

Use a Teams **Incoming Webhook URL**, configured once per deployment as `TEAMS_WEBHOOK_URL`, posted
to directly with `fetch`. One webhook, one channel, every mentor notification lands there (D2 in
the design spec — mentors share access across all batches, so there is no per-batch channel to
split against).

## Consequences

### Positive

- Ships independently of the Entra cutover and of O-5 — no new tenant permission, no new consent
  screen, no dependency on a governance decision this plan does not otherwise need.
- Minimal surface: one `fetch` call, one JSON payload shape (MessageCard), no SDK, no OAuth
  client-credentials flow to manage or rotate.
- A webhook URL is revocable by the channel owner without touching this codebase or its
  deployment — no engineering-side ameliorating action needed if it is compromised, only
  re-issuing the URL and updating the one env var.

### Negative

- **One shared channel, not per-mentor delivery.** Every mentor sees every notification in the same
  Teams channel; there is no "@mention the right mentor" targeting. Acceptable here because D2
  already makes every mentor a recipient of every event — there is no narrower audience to address.
- **A leaked webhook URL lets anyone post to the channel**, unauthenticated, for as long as the URL
  is live. Mitigated by treating it as a secret (env var only, Container Apps secret in
  production — same convention as `DATABASE_URL`/`AUTH_SECRET`), and by it being revocable.
- Incoming Webhooks are a legacy Teams connector mechanism Microsoft has signalled will eventually
  be replaced by Workflows-based connectors. Accepted for now — see Revisit when.

## Alternatives considered

### Rejected — Microsoft Graph API messaging

Would give per-recipient delivery (individual chat messages, not one shared channel post) and use
the tenant's supported long-term messaging surface. Rejected because it requires a new Graph
permission consented through the same tenant-governance process already stalled on O-5 and the
Entra cutover — this plan would inherit a blocker it does not otherwise have. Revisit once that
governance process actually runs for some other reason (the real Entra cutover, or an O-5
resolution); at that point per-mentor Graph messaging becomes a low-marginal-cost upgrade.

### Rejected — a bespoke Teams bot/app

Full per-recipient control and richer interactive cards. Rejected as disproportionate: this is a
one-directional, unauthenticated fire-and-forget notification (D5 in the design spec), not an
interactive surface — a bot's install/consent/lifecycle overhead buys nothing FR-21 asks for.

## Revisit when

- The Entra cutover or an O-5 resolution puts real Graph consent on the table anyway — re-evaluate
  per-mentor Graph messaging at that point, since the governance cost would already be paid.
- Microsoft deprecates Incoming Webhooks on a firm timeline (tracked loosely today, not yet acted
  on) — migrate to the Workflows connector equivalent before that date, not after.

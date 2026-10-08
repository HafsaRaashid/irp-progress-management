# ADR-0032: Hand-written Azure OpenAI client over the `openai` SDK

## Status
Accepted.

## Context
Calling Azure OpenAI needs either the `openai` npm package (configured for Azure) or a direct
`fetch` against its REST endpoint. This repo already made the equivalent choice twice: ADR-0024
(Teams webhook over the Graph API SDK) and ADR-0025 (SMTP over a vendor SDK).

## Decision
A hand-written `fetch` client (`apps/api/src/services/evaluation-ai-client.ts`), matching
`createTeamsWebhookSender`/`createSmtpEmailSender`'s shape: a small interface, a factory taking
config and (here) an injectable `fetch`, tested against a fake with no real network call.

## Rejected alternatives
1. **The `openai` npm SDK.** Pulls in a dependency this repo otherwise avoids for exactly this
   kind of integration (ADR-0024/0025 precedent), for an API surface (one chat-completions POST)
   simple enough that the SDK buys little beyond typed request/response shapes this codebase
   already types itself via the OpenAPI-generated `Evaluation` schema.
2. **Azure's dedicated `@azure/openai` SDK package.** A separate Azure-specific client package
   exists on npm, but it is stale (no release in roughly two years) — Microsoft's own current
   guidance directs new Azure OpenAI integrations to the `AzureOpenAI` class inside the `openai`
   package itself, not this package. Choosing it would mean depending on an effectively
   unmaintained library for the same single-endpoint call alternative 1 already rejects, with no
   offsetting benefit over a hand-written `fetch`.

## Consequences
The client is easy to test (inject a fake `fetch`, exactly like the Teams/SMTP senders already
do) and easy to swap if ADR-0031 is later reversed.

# ADR-0031: Azure OpenAI as the AI evaluation provider — an O-5 override

## Status
Accepted, proceeding ahead of O-5's own required process (see context).

## Context
`CLAUDE.md` states O-5 (the AI provider decision) needs an ADR and leadership escalation before
any AI call is implemented, and the PRD lists O-5 as Undecided as of this ADR's date. This ADR
records a provider choice made WITHOUT that escalation, on the explicit instruction of the spec
lead, who accepts the risk — see `docs/superpowers/specs/2026-10-06-ai-monthly-evaluation-design.md`
§0 for the full reasoning. This is the technical half of O-5 only; the leadership/data-processing
sign-off itself remains outstanding.

## Decision
Azure OpenAI, via the Azure resource/subscription this project already deploys to.

## Rejected alternatives
1. **OpenAI direct API.** Moves student submission text (personal data) to a separate
   third-party tenant outside Azure — the exact risk O-5's own wording raises.
2. **Anthropic's API.** Same cross-tenant data-residency concern as OpenAI direct.
3. **Wait for the leadership escalation before implementing anything.** Rejected by the spec
   lead's explicit instruction. Cost if this is later reversed: a provider swap touches only
   `apps/api/src/services/evaluation-ai-client.ts` and its tests — the data-assembly and rubric
   maths underneath have no provider dependency.

## Consequences
If leadership's eventual answer rejects Azure OpenAI, this ADR is superseded, not merely amended —
record that decision as its own ADR naming this one.

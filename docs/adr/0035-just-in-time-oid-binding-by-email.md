# ADR-0035 — Just-in-time Entra oid binding by email

- **Status:** Accepted and implemented (see Implementation status)
- **Date:** 2026-10-12
- **Deciders:** HafsaRaashid (with Claude Code)
- **Requirements:** FR-3
- **Relates to:** ADR-0010 (Auth.js v5), ADR-0012 (dev auth bypass by issuer swap) — this ADR
  changes the identity-binding step of ADR-0012's §7 cutover, not the bypass mechanism itself;
  Plan 3 spec §7 and `docs/manual-setup-steps.md` §1.3b, both of which currently name the manual
  step this ADR replaces
- **Logged as:** O-22, `docs/interview-and-prd.md` §5

---

## Context

FR-3 registration takes `externalId` directly from an Admin, who must copy it out of the Azure
portal (Object ID on the person's Entra profile) and paste it into the registration form.
`apps/api`'s auth plugin (`plugins/auth.ts:102`) matches every request's token `oid` claim
against `User.externalId` via `userRepo.findByExternalId`; no match throws `ForbiddenError` (spec
§7) — a 403 with no further detail.

Nothing validates the pasted value at registration time. A typo produces a `User` row that looks
correct in the directory — right name, right email, right role — and the person it describes
simply 403s forever at their first sign-in, with no error surfacing anywhere an Admin would see
it. This was logged as O-22 on 2026-10-09, alongside an interim mitigation: hint text next to the
field in `apps/web/app/(app)/students/forms.tsx` naming what the value is and where to find it.
The hint reduces the error rate; it does not remove the step that causes it.

**`oid` has to stay the authoritative key.** Two properties rule out replacing it outright:

- **Email is mutable.** A name change rewrites it, and every `Entry`, `DailyReport`, `Evaluation`,
  and `Override` hanging off that `User.id` would be silently orphaned from the identity a mentor
  now sees in the directory if email were the join key.
- **Email is reassignable.** A departed person's address can be repointed at a new hire in Entra.
  If email were the key, the new hire would silently inherit the departed person's entire record.

Microsoft's own guidance names `email`/`upn`/`preferred_username` as unsafe keys for exactly these
reasons. `oid` is immutable and never reassigned — it is the right key. The problem is narrower
than "which field is authoritative": it is that a **human currently has to transcribe it**, and
nothing catches a transcription error before it ships.

## Decision

Keep `oid` → `User.externalId` as the authoritative match in `plugins/auth.ts`, but stop asking a
human to supply it. Register by **email** (already stored, already `@unique`); leave
`externalId` unset; bind the real `oid` automatically the first time that person signs in
successfully.

### Schema

```prisma
externalId String? @unique // Entra oid claim; null until the person's first successful sign-in
```

`externalId` becomes nullable. **No partial unique index is needed, contrary to O-22's note that
flagged one as required** — checked directly against Postgres's actual behaviour, not assumed: a
plain unique index already treats every `NULL` as distinct from every other `NULL`, so any number
of pending (`externalId IS NULL`) rows can coexist under a bare nullable `@unique` column, while
uniqueness is still enforced the instant a row holds a real value. The migration is one line:

```sql
ALTER TABLE "User" ALTER COLUMN "externalId" DROP NOT NULL;
```

The existing `User_externalId_key` index is untouched.

### Auth path (`apps/api/src/plugins/auth.ts`)

After the existing signature/issuer/audience/expiry verification (unchanged) and extraction of
`oid` (unchanged):

1. `findByExternalId(oid)` — the existing fast path. For anyone who has ever signed in before,
   this is the only query, exactly as today; steady-state request cost (NFR-1/NFR-2) does not
   change.
2. **Only on a miss**, attempt a bind: a single atomic statement —
   `UPDATE "User" SET "externalId" = $oid WHERE email = $tokenEmail AND "externalId" IS NULL AND
   "deletedAt" IS NULL RETURNING *` (email compared case-insensitively — Prisma's
   `mode: "insensitive"` on Postgres, since Entra's casing of the `email` claim is not guaranteed
   to match whatever casing an Admin typed at registration, and casing is not an identity
   difference worth failing a sign-in over). A single conditional `UPDATE` rather than a
   read-then-write avoids a bind race between two near-simultaneous first-sign-in attempts for the
   same row — at most one succeeds, the loser falls through to step 3 having updated zero rows.
3. If the bind in step 2 updated a row, use it. If it updated nothing — no row at all matched
   `email`, or a row matched but already holds a different `externalId` — fall through to the
   existing `ForbiddenError` (spec §7 is unchanged: valid token, no usable record, 403).

The `email` claim is already present on every token this system issues: the dev provider signs
`{ oid, email, name }` (`apps/web/lib/dev-identity.ts:123`), and the web app's Entra provider
requests the `email` scope explicitly (`auth.config.ts:144`), matching the shape auth.ts already
expects.

### Registration (`POST /api/v1/users`, `spec/openapi.yaml`'s `UserCreate`)

`externalId` is dropped from `UserCreate`'s `required` array and from the registration form
(`apps/web/.../students/forms.tsx`) entirely — not merely made optional in the UI. The field, its
hint text, and the comment block explaining it are removed from the form; the common path asks
only for email, display name, and role (plus enrolment for a student). The property stays in the
OpenAPI schema and the Prisma model as nullable, for the rare case an Admin already has a
confirmed `oid` in hand and wants to set it directly — not exposed in the UI for v1, matching the
project's existing refusal to build speculative admin tooling (`CLAUDE.md`'s non-goal list already
rules out a comparable date-correction UI for the same reason).

## Rejected alternatives

**1. Status quo — keep manual transcription.** Zero work. Rejected: it is the exact failure this
decision exists to remove — a typo produces no error anywhere until the affected person's first
sign-in, and even the interim hint text only lowers the error rate, it does not catch one.

**2. Validate the pasted `oid` against Microsoft Graph at registration time**
(`GET /users/{oid}`), rejecting an unknown or malformed value before it saves. Rejected on two
grounds: it needs Graph API credentials and app permissions that do not exist yet — no Entra
directory is provisioned (`handoff.md` §3), the same blocker ADR-0012 already cites — and it does
not actually solve the problem even once provisioned. It would confirm the pasted GUID is *some*
real Entra object, not *that specific person's* object; an Admin who transcribes a different real
user's correct `oid` passes this validation cleanly and still grants access to the wrong person.

**3. Drop `externalId` and authenticate on email alone.** Rejected for the reason given in
Context: email is mutable and reassignable, so this reopens the exact failure mode `oid` exists to
prevent — a name change or an Entra-side email reassignment would silently transplant one person's
access and history onto someone else.

**4. Self-registration — create the `User` row on first sign-in instead of an Admin pre-creating
it.** Rejected: FR-3 reserves registration to an Admin, and a self-created row has no role and no
batch enrolment for anyone to have assigned — those are decisions an Admin makes at registration
time, not data a sign-in event can supply. This is also the same shape of thing the non-goals list
already rules out (no reject-and-resubmit flow, no unreviewed self-serve path).

## Consequences

### Positive

- Removes the transcription step, and therefore its failure mode, from the common registration
  path entirely. Registering a real person needs only information an Admin already has on hand.
- `oid` remains the authoritative key on every request, matching the conclusion Context already
  reaches — this decision changes how the value gets into the row, not what the row is keyed on.
- No change to the steady-state auth request: `findByExternalId` is still the only query for
  anyone who has signed in before. The bind query runs at most once per person, ever.
- The Entra cutover runbook step that currently reads `UPDATE "User" SET "externalId" =
  '<entra-oid>'` for each real person (Plan 3 spec §7, `docs/manual-setup-steps.md` §1.3b) is
  deleted outright — binding happens automatically on first sign-in, the same way it already does
  for dev identities today.

### Negative, stated plainly

- **Binding happens exactly once, on the first successful sign-in, matched by email.** If that
  match fails — most plausibly because the person's Entra email changed between registration and
  their first sign-in, so the stored row's email and the token's current `email` claim disagree —
  the row never binds, and the person is 403'd indefinitely with no self-service recovery. This is
  the same silent-failure *shape* O-22 originally reported, just moved to a narrower and rarer
  trigger (an email change between registration and first login, rather than any registration at
  all). An Admin can still correct it by hand — update the stored email, or set `externalId`
  directly — but this ADR does not build a dedicated correction tool for it; doing so before the
  case is ever observed would be exactly the speculative admin tooling this project's non-goals
  already argue against.
- **A reused email cannot bind to the row that already holds a different `externalId`.** If Entra
  repoints a departed person's address at a new hire, the bind query's `"externalId" IS NULL`
  guard means the new hire's sign-in matches nothing and they get the same opaque 403 as an
  unregistered person, until an Admin frees the email — e.g. by archiving or renaming the departed
  person's row. This is by design (a bound `oid` is never silently overwritten) and is a named,
  accepted gap, not a solved one.
- `email` comparison at bind time is case-insensitive by necessity (Entra's claim casing and an
  Admin's typed casing are not guaranteed to agree). **This requires `email`'s own uniqueness to
  also be case-insensitive**, caught during implementation rather than assumed at design time: a
  plain `@unique` on `email` is case-sensitive, so two rows differing only by case (`Jane@x.com`
  and `jane@x.com`) could otherwise both exist and make a bind-by-email match genuinely ambiguous.
  Fixed by replacing `email`'s plain unique constraint with a hand-written functional index on
  `lower(email)` (migration `case_insensitive_email`) — the same hand-written-index technique
  already used for `Enrolment_one_open_per_student`, since Prisma cannot declare either kind
  declaratively. This closes the gap rather than merely naming it.

## Implementation status

**Implemented 2026-10-12, ahead of the Entra cutover** (`feat/mentor-ui-ux-improvements`), rather
than waiting for it — the mechanism itself needs no real Entra tenant to build or typecheck, and is
already exercised by the dev-bypass identities (`apps/web/lib/dev-identity.ts` already signs
`{ oid, email, name }`, the exact shape the bind fallback reads). What the original Revisit-when
plan below called for is now done:

1. `externalId` nullability migration applied (`nullable_external_id`), plus the case-insensitive
   email migration above.
2. `findByExternalId` → `bindExternalId` fallback implemented in `plugins/auth.ts`.
3. `externalId` dropped from `UserCreate`'s `required` array in `spec/openapi.yaml`; types and the
   client SDK regenerated.
4. The field, its hint text, and its explanatory comment removed from
   `apps/web/app/(app)/students/forms.tsx`.
5. The manual `UPDATE "User" SET "externalId" = ...` step replaced in the **living** runbook,
   `docs/manual-setup-steps.md` §1.3b. **Plan 3 spec §7 (`docs/superpowers/specs/2026-07-29-...md`)
   is deliberately left untouched** — it is a point-in-time design record of what Plan 3 actually
   decided, and this project's convention is not to retroactively rewrite historical plan/spec
   docs; this ADR and the runbook are the current source of truth instead.

**Still outstanding, and still genuinely gated on a real Entra directory existing:** validation
against a real `oid`/`email` claim shape (Entra's claims are only assumed to match the dev
provider's shape, per ADR-0012), and therefore the real-token CI job this mechanism has never run
against. Those remain blocked exactly where ADR-0012 already said they were.

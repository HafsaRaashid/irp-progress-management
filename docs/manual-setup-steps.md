# Manual Setup Steps — things only you can do

Everything in this file requires a human: an account, a card, a consent click, or a decision
that is not mine to make. Everything *not* in this file is automated or will be.

Ordered by **when it blocks something**, not by difficulty. The first section is the one that
matters — start it now, because it gates two whole plans and takes real elapsed time.

---

## 1. Blocks Plan 4B — start today

### 1.0 Read this first — none of this blocked Plan 3 or Plan 4A, and both have shipped

**Update, 2026-07-30.** Plan 4 was split. **Plan 4A needs nothing from this
section** — it containerises and hardens the runtime with no Azure account.
Everything in §1 now blocks **Plan 4B**.

Plan 3 shipped a **dev auth bypass** (ADR-0012), so the whole application runs,
tests and demos with no Entra directory at all. **Plan 3 merged as PR #6 without
any of §1 being done**, and Plan 4A was built and CI-verified the same way.

What §1 is still needed for: **Plan 4B** — deploying on Azure. `infra/entra.bicep` stayed **out of
scope** for Plan 4B (its fourth deferral, a governance call — see the corrected §1.1a below), so real
Microsoft sign-in and waking the dormant real-token CI job remain outstanding, not shipped by 4B.

**What the bypass does not excuse:** it must be deleted, not left dormant. The
cutover is five config steps — see the Plan 3 spec §7 (updated 2026-08-01 to include the three
`AUTH_MICROSOFT_ENTRA_ID_*` variables) and §1.3b below.

### 1.1 Create an Azure free account — ✅ DONE, 2026-07-28

Signed up successfully with the work account. Current state:

| | |
|---|---|
| Subscription | `Azure subscription 1` — `7bb869f8-053c-4c2d-b444-1bf079bfcef7`, Enabled |
| Tenant | `bisteccare.lk` (`d5e769b0-fd19-45e4-a4a8-b73545450234`), as `Damian@bisteccare.lk` |
| Hosting | Working — `az group list` succeeds |

**Hosting is no longer a blocker. Entra is — see §1.1a.**

What the free account gives this project:

| Resource | Free allowance | Enough? |
|---|---|---|
| Container Apps | Recurring monthly grant | Yes, for two small apps |
| PostgreSQL Flexible Server B1ms | 750 h/month for 12 months, 32 GB storage | Yes — 750 h is continuous |
| Application Insights | Free ingestion tier | Yes at this traffic |
| Entra ID | Free tier | Yes |

Plus $200 credit for 30 days as headroom if load testing needs a bigger tier briefly.

> **Why your own account and not Bistec's.** Bistec tenant access was never provisioned, and
> 50 of the 75 remaining graded points sit behind having something deployed. This unblocks
> today. Ask the mentor for Bistec tenant access anyway — see §3 — but nothing waits on it.

### 1.1a Create a dedicated Entra directory — ⬅ **Plan 4's blocker. Do this next.**

> **CORRECTED 2026-07-31, verified with `az`. The premise below is false.**
> `bistecglobal.com` and `bisteccare.lk` are **the same tenant**,
> `d5e769b0-fd19-45e4-a4a8-b73545450234` (*BISTEC Global*) — both are verified domains on it,
> alongside about twenty others. So the subscription and the users are in **one** directory, and a
> single-tenant app registration there would let real mentors and students sign in. Graph reads also
> work (four consecutive calls succeeded), and `allowedToCreateApps` is `true`, so no admin role is
> needed to create the registration.
>
> **A dedicated directory is therefore not technically necessary.** What remains is a *governance*
> question — `d5e769b0` is BISTEC's live corporate directory — and that is why Entra was deferred
> again rather than done. Ask the mentor before registering a user-facing SSO app there. See the
> Plan 4B design spec §2 for the evidence.
>
> Everything below is kept as the historical reasoning. Do not act on it without reading this note.

**Why, in one line:** the users are in `bistecglobal.com` (where you have no account), the
subscription is in `bisteccare.lk` (where Graph is blocked by conditional access), so neither
directory can host the app registrations. See `handoff.md` §3 for the full reasoning.

**Known complication, 2026-07-29:** your **work account has no Entra admin access**. That does not
necessarily prevent creating a *new* tenant — creating one makes you its Global Administrator
regardless of your rights in the current directory — but some directories restrict it. Try the flow
below first. If it is refused, the fallback is a free tenant created from a **personal Microsoft
account**, then a native `admin@<name>.onmicrosoft.com` inside it for all CLI and Bicep work. The
"do not use a personal Microsoft account" warning further down applies to the identity that
*deploys Graph resources*, not the one that creates the tenant — so that fallback is sound.

One consequence to expect if you take the fallback: the subscription stays in `bisteccare.lk` while
the Entra objects live elsewhere, so `main.bicep` and `entra.bicep` become **two deployments with
two credentials** rather than one. Manageable, but it is real extra work in Plan 4.

Roughly 5 minutes.

1. Go to <https://entra.microsoft.com>
2. **Manage tenants → Create → Microsoft Entra ID** (*not* the B2C option)
3. Organisation name and initial domain — e.g. `irpdemo` gives `irpdemo.onmicrosoft.com`. Pick a
   country, complete the captcha, **Create**.
4. **Create a native cloud-only admin inside the new directory** — Users → New user → Create new
   user, e.g. `admin@irpdemo.onmicrosoft.com`. Assign it **Global Administrator**. Sign in once to
   clear the initial password prompt.
5. Create the demo users the slice needs — one mentor and two or three students. Free, and it
   makes the demo real rather than a single-user screenshot.

**Step 4 is not optional bureaucracy.** Creating a tenant grants Global Admin to your *external*
`Damian@bisteccare.lk` identity, and external/guest identities are where Graph-via-Bicep gets
awkward. Use the native account for all CLI and Bicep work.

**Do not use a personal Microsoft account instead.** Microsoft's docs state that *"permissions for
personal Microsoft accounts cannot be used to deploy Microsoft Graph resources declared in Bicep
files."* An MSA would silently break the Bicep-for-Entra decision the design depends on.

Then: `az login --tenant <new-tenant-id> --allow-no-subscriptions`

**If tenant creation is blocked** (some directories restrict non-admins from creating tenants),
say so — the fallback is the mentor ask in §3, with the design unchanged either way.

### 1.2 Install the Azure CLI — ✅ DONE

Installed and working, version **2.88.0**, authenticated as `Damian@bisteccare.lk`. The **Bicep
CLI** is also installed, version 0.45.15, via `az bicep install` — which needs no elevation and no
authentication.

**Correction, 2026-07-31.** This section previously said the CLI was absent on the second machine
and could not be installed non-interactively. It is present and authenticated, and `az` reaches both
ARM and Microsoft Graph. The conditional-access note below described real failures at the time; they
did not recur across four consecutive Graph calls on 2026-07-31. Treat Graph as working but not
proven reliable — nothing in Plan 4B depends on it.

### 1.2a Register the Azure resource providers

**Four** are needed and all are currently `NotRegistered`. Bicep fails with a confusing error
rather than a clear one if they aren't registered first, so do this before Plan 4.

```powershell
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.DBforPostgreSQL
az provider register --namespace Microsoft.Insights
az provider register --namespace Microsoft.OperationalInsights
```

`Microsoft.ContainerRegistry` was on this list and **is no longer needed** — images go to GHCR, not
ACR (see §1.5).

Free, reversible, creates nothing, takes a few minutes in the background. **I cannot run these for
you** — they need an authenticated `az` session, and `az login` is an interactive browser flow.
Run `az login` yourself, then either run the four lines above or tell me and I will.

### 1.3 Grant admin consent for the Entra app registrations

The app registrations themselves are created by **`infra/entra.bicep`** (`Microsoft.Graph/
applications@v1.0`), not by hand and not by a checked-in script — see `handoff.md` §3 decision 4.
But **granting admin consent requires a human click in the portal** — that is a deliberate
Microsoft safeguard and cannot be scripted away.

Two other things in this area are also human-only, for the same reason:

- **Minting the client secret.** Bicep cannot emit one — `passwordCredentials.secretText` is
  read-only. Auth.js needs a secret for the confidential-client code flow, so it is created once
  with `az ad app credential reset` and lands in `apps/web/.env.local` plus a GitHub Actions secret.
- **Assigning the k6 service principal its app role**, which needs elevated consent with no
  narrower permission available.

I will tell you exactly which app and which permissions when Plan 3 reaches that point.

### 1.3a Register the dev users (local development)

`dev-unknown-1` is deliberately absent — it must produce a 403 and land on
`/not-registered`.

```powershell
$env:IRP_DB_PORT = "5433"
docker compose -f apps/api/docker-compose.yml up -d
docker compose -f apps/api/docker-compose.yml exec -T db psql -U irp -d irp -c "INSERT INTO \"User\" (\"id\", \"externalId\", \"email\", \"displayName\", \"role\", \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid(), 'dev-admin-1', 'mentor@dev.local', 'Dev Mentor', 'ADMIN', now(), now()), (gen_random_uuid(), 'dev-student-1', 'student@dev.local', 'Dev Student', 'STUDENT', now(), now()) ON CONFLICT (\"externalId\") DO NOTHING;"
```

### 1.3b The Entra cutover, when the directory exists

1. Register each real person by **email** through the Users page, same as a dev identity. Do
   **not** hand-transcribe their `oid` — leave `externalId` unset. It binds itself the first time
   that person signs in successfully, matched against the registered email (ADR-0036). This
   replaces the earlier manual `UPDATE "User" SET "externalId" = '<entra-oid>'` step.
   **Prerequisite:** the bind matches the token's `email` claim, and the API validates the
   *access token*, which does not carry `email` by default. On the API's app registration, add it
   under Token configuration → Add optional claim → Access → `email`. Then sign in once with a
   registered account and confirm the person lands in the app rather than on `/not-registered`;
   if they do not, decode the access token and check whether `email` is present.
2. Unset `AUTH_DEV_BYPASS` in `apps/web/.env.local` and the deployed config.
3. Point `JWKS_URI` and `JWT_ISSUER` at the tenant.
4. Set the three web-side variables `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`,
   `AUTH_MICROSOFT_ENTRA_ID_ISSUER`. **Added 2026-08-01 — missing from earlier versions of this
   list.** `apps/web/auth.config.ts`'s `isEntraConfigured` requires all three before it registers the
   Microsoft Entra provider at all; without them `/signin` still renders the "not configured" panel
   regardless of steps 1–3. Config-only: `/signin` is `force-dynamic`, so a new Container App revision
   (created the moment these variables change) re-reads them — no image rebuild.
5. Set the repository **variable** `ENTRA_REAL_TOKEN_TESTS=true` to wake the CI job.
6. Delete `apps/web/lib/dev-identity.ts`, its route, and its tests.

No application code changes in steps 1–4. That is the design working.

### 1.4 Add GitHub Actions secrets — ➡ **see `docs/deploy-runbook.md` §1.4 for the real list**

**Superseded, 2026-07-31.** This list was written before Plan 4B settled the deploy identity and the
registry decision, and it is wrong on three counts: `AZURE_CREDENTIALS` (a service-principal JSON
secret) was rejected in favour of GitHub OIDC federation — there is no client secret for Azure login
at all, only `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID`; `APPLICATIONINSIGHTS_CONNECTION_STRING`
is never a GitHub secret — `infra/main.bicep`'s App Insights resource emits it and injects it as a
container env var itself; and `GHCR_PAT` is wrong outright now that §1.5 has decided the packages are
public — no registry credential exists anywhere. `ENTRA_CLIENT_SECRET` remains correct in shape but
not yet actionable, since Entra is still deferred (§1.1a).

The authoritative, current secret and variable list — matching what `.github/workflows/deploy.yml`
actually consumes — is `docs/deploy-runbook.md` §1.4. Use that, not this section.

**Never paste any of these into the chat.** Put them straight into GitHub. If one is ever
exposed, rotate it rather than hoping.

### 1.5 Container image visibility — ✅ DECIDED: **public**

**Decided 2026-07-31: the GHCR packages are public.** Container Apps pulls anonymously, so there is
no `GHCR_PAT`, no registry secret in Bicep, and nothing to rotate. The accepted cost is
world-readable images; they contain no secrets, because all configuration is injected at runtime, so
the exposure is the source code.

This fires ADR-0009's own "revisit when the packages are made public" trigger. The conclusion is **no
change**: D1's negative consequence — a long-lived `read:packages` credential — is simply retired,
and the ACR-for-managed-identity question is moot because no registry credential exists at all.

**One manual step remains:** after the first push creates them, set `irp-api`, `irp-web` and
`irp-migrate` to Public in the repository's Packages settings. Until then the pull fails
`UNAUTHORIZED`.

### 1.6 Hosting shape, for reference — nothing to do here

Settled 2026-07-29, recorded so you are not re-deciding it at deploy time. Full reasoning in
`docs/adr/0009-hosting-topology.md`.

| Choice | Value |
|---|---|
| Region | **Southeast Asia** (Singapore) — lowest latency to Sri Lanka, ~50 ms, and the p95 < 250 ms target is measured over it |
| Registry | GHCR |
| Postgres reachability | Public endpoint + firewall + `sslmode=require`. Not VNet-private — that needs a VNet-injected Container Apps environment and a /23 subnet |
| Migrations | A **Container Apps Job** inside the environment, so no firewall hole is ever opened for a GitHub runner's dynamic IP |
| `apps/web` scaling | Min replicas **0**. Cold start is acceptable for a demo |
| `apps/api` scaling | Min replicas 0 normally, **≥1 during the k6 run** — a scale-from-zero cold start alone would miss p95 < 250 ms |

**Two dates that matter:** the $200 credit expires around **2026-08-27** (30 days from account
creation), so the load test belongs inside that window; and the free Postgres B1ms allowance is
750 h/month **for 12 months**, from 2026-07-28.

---

## 2. Blocks Plan 11 (load testing)

### 2.1 Install k6

```powershell
winget install k6.k6
```

Not needed until the load-test plan, but it is a one-line install and easy to forget.

---

## 3. Mentor escalations — send as one batched Teams message

Your team contract (PRD §4.4) says ambiguities go to the mentor batched, with a one-working-day
response window. Six items are outstanding. **Three of them changed requirements and need
sign-off; three are older and block later work.**

### Needs sign-off — I have already built on a stated assumption

| # | Question | What I assumed | What it affects |
|---|---|---|---|
| **O-11** | Weekends now count as optional **Extra** work — weekdays required, weekends never missed, never late, never in a compliance denominator. Extra feeds the AI summary as positive context but carries no automatic score bonus. Confirm? | As described | Already in the date engine, `CLAUDE.md`, the PRD and ADR-0003. **Changes FR-12 and adds FR-33, which §4.2 reserves to you as decision owner** |
| **O-10** | FR-13 grants a late entry "one further day"; FR-15 permits targeting "the immediately preceding weekday". **These conflict on Monday** — under FR-13 Friday's grace closes Saturday night, under FR-15 Friday is still Monday's preceding weekday. Which is right? | FR-15 reading: grace runs to the end of the next *weekday*, so Friday stays open until Monday 23:59:59 | The date engine. Marked `// ASSUMPTION: O-10` in code |
| **O-12** | The brief pins Next.js 15; current release is 16. Approve 16? | Next.js 16, per ADR-0004 | Nothing yet. Must resolve **before Plan 3**. Reversal is free until then |

### Older, still blocking

| # | Question | Blocks |
|---|---|---|
| **O-5** | Which AI provider, and is student data leaving the tenant approved? Submissions are personal data. Needs escalation to Hearts Academy / leadership, not just the mentor | **Plan 9 entirely** (FR-22 – FR-27) |
| **O-6** | The exact wording of the five rubric criteria. Weights are confirmed at 20/25/25/10/20 | The evaluation schema and the evaluation screen |
| **O-9** | Demo Day #2 date | Scheduling only |

Also worth asking, since it costs nothing: **can Bistec grant training-tenant access?** If yes,
FR-1 becomes fully satisfied by an issuer swap. If no, we stay on a personal Entra tenant and
note it.

---

## 4. One small thing I need from you

**The Bistec brand colour** — a hex value, or even "the blue in the logo". `--primary` is
currently a placeholder indigo.

It is a one-token swap, but any replacement must avoid hue 20–70° (reserved for `missed` and
`late`) and 140–170° (reserved for `ok`), or it will collide with the status vocabulary.

---

## 5. At the very end — submission

From the challenge brief's submission checklist. None of this is code.

- [ ] **Share the staging URL with the programme lead**
- [ ] **Have the deploy runbook reviewed by a senior engineer** — explicitly required, and it is a human review, not a check I can run
- [ ] Rename the four deliverable files to `{team-name}-month2-*` per the naming convention
- [ ] Zip the repository as `{team-name}-month2-irp-progress-management`
- [ ] Hold the retrospective and commit the notes — it must name real incidents, not vibes
- [ ] Fill in O-1: the interview date, duration and stakeholder name, still `_TODO_` in PRD §1.1
- [ ] Copy the final PRD back to the onboarding repo's `weekly-challenges/month-2/` if the submission copy must match

### Deliverable files expected

| # | File | Status |
|---|---|---|
| 1 | `{team}-month2-interview-and-prd.md` | Drafted, needs the O-1 fields |
| 2 | Repository — spec + generated types | Plan 2 |
| 3 | `{team}-month2-deploy-runbook.md` | Plan 4 |
| 4 | `{team}-month2-retro-and-load.md` | Plan 11 |

---

## 6. What you do *not* need to do

Listed so you do not waste time on it:

- **No portal clicks for infrastructure.** Everything except Entra admin consent comes from `infra/main.bicep`.
- **No manual deploys.** GitHub Actions handles it on merge to `main`.
- **No manual app registration.** `infra/entra.bicep` declares them and is idempotent on `uniqueName`; you only consent and mint the secret (§1.3).
- **No database setup.** Bicep provisions Postgres; migrations run as a Container Apps Job, not from a CI runner.
- **No local `.env` juggling for CI.** Secrets live in GitHub.

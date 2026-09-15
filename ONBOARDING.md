# Onboarding — IRP Progress Management System

Everything needed to get this repo running from a completely fresh machine,
plus what you'll see once it's seeded, so you can demo it. This file will be
updated as the setup changes — treat it as living, not a one-time snapshot.

Written for **PowerShell on Windows** (the primary dev environment for this
project). Commands are otherwise plain and translate to bash/zsh with minor
syntax changes (`$env:VAR = "x"` → `export VAR=x`).

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.x | |
| pnpm | 11.17.0 | via corepack, not a global install |
| Docker Desktop | any recent | for local Postgres |
| Git | any recent | |

```powershell
node -v
corepack enable
corepack use pnpm@11.17.0
docker version --format '{{.Server.Version}}'
```

The Azure CLI, Bicep, and an Entra tenant are **not** needed to run this
locally — the app has a dev auth bypass (ADR-0012) that lets it run, test,
and demo with zero Azure/Entra setup. Those are only for deploying to Azure.

---

## 2. Clone and install

```powershell
git clone <repo-url> irp-progress-management
Set-Location irp-progress-management
pnpm install
```

## 3. Generate and build the workspace packages

`packages/types` and `packages/client` are generated from `spec/openapi.yaml`
and are git-ignored — they don't exist in a fresh clone. `packages/core` is
committed source, but `apps/api` and `apps/web` resolve it from `dist/`, which
is also git-ignored. All three steps are required:

```powershell
pnpm generate
pnpm --filter @irp/core build
pnpm --filter @irp/client build
```

(`pnpm generate` alone leaves `packages/client/dist` stale — the extra build
step above is required, not optional; `next build` is the only thing that
actually catches a missing dist.)

**Nothing in §2–§3 warns you when it's stale rather than missing.** `pnpm
install` succeeds, `pnpm dev` starts, and the failure surfaces later as what
looks like broken application code:

| What you see | Actually means |
|---|---|
| `apps/api` exits at boot: `SyntaxError: The requested module '@irp/core' does not provide an export named 'X'` | `packages/core/dist` is stale — rebuild `@irp/core` |
| Browser shows a Turbopack **Build Error**: `Export X doesn't exist in target module … packages/client/src/index.ts` | `packages/client/src` was generated from an older `spec/openapi.yaml` — re-run `pnpm generate`, then rebuild `@irp/client` |

So **returning to an existing clone after pulling is not a shorter path than a
fresh one** — run §3 in full every time, and §5's `prisma generate` too. Both
are cheap (a few seconds) and neither is safe to skip on the assumption that
the directories already existing means they're current.

There are **five** git-ignored generated trees in total, and the fifth catches
people out because it makes a *passing* check fail rather than making something
break:

```powershell
pnpm --filter @irp/web build   # AUTH_DEV_BYPASS=false — see §9
```

`apps/web/tsconfig.json` includes `.next/types/**/*.ts`, and Next's
`typedRoutes` route union lives in `.next/types/routes.d.ts` — written by
`next build`, **not** by `next dev` (dev writes its own copy to
`.next/dev/types/`, which `tsconfig` does not include). If the last
`next build` predates a page being added, `pnpm typecheck` reports errors like
`Type '"/roster"' is not assignable to type 'Route'` against code that is
correct and works in the browser. Run the build once and it goes clean.

## 4. Env files

Copy the examples and fill them in:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

**`apps/api/.env`** — edit these two lines so the API validates the dev
bypass's tokens instead of expecting real Entra ID tokens:

```
JWKS_URI=http://localhost:3100/api/dev-jwks
JWT_ISSUER=http://localhost:3100/api/dev-jwks
```

Leave `DATABASE_URL` as the example's `127.0.0.1:5433` value (see §5 for why
5433, not 5432).

**`apps/web/.env.local`** — generate a real secret and leave Entra empty:

```powershell
# Anything 32+ random bytes works; openssl if you have it, otherwise:
$env:AUTH_SECRET = -join ((48..57)+(97..122) | Get-Random -Count 32 | % {[char]$_})
```

Paste that into `AUTH_SECRET=` in `.env.local`. Keep `AUTH_DEV_BYPASS=true`.
Leave all three `AUTH_MICROSOFT_ENTRA_ID_*` variables **empty** — a
placeholder value there breaks the dev bypass too (see the comment in the
file itself).

**`apps/api/.env`'s six notification variables (FR-21, Plan 8) are all
optional — leave every one of them blank for local dev:**

```
TEAMS_WEBHOOK_URL=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
NOTIFICATIONS_FROM_EMAIL=
WEB_BASE_URL=http://localhost:3100
```

`TEAMS_WEBHOOK_URL` unset and the SMTP block unset (or only partially
set — it is all-or-nothing) each independently no-op that channel with a
single startup warning log, rather than failing to boot. `pnpm dev` and CI
both run with every one of these blank. See ADR-0024 (Teams webhook) and
ADR-0025 (SMTP via M365) for why those two delivery mechanisms were chosen,
and the Plan 8 design spec for the full notification behaviour.

## 5. Start Postgres and migrate

```powershell
$env:IRP_DB_PORT = "5433"
docker compose -f apps/api/docker-compose.yml up -d
$env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
pnpm --filter @irp/api exec prisma migrate deploy
pnpm --filter @irp/api exec prisma generate
```

Why 5433 and not the default 5432: it's the repo-wide convention because
5432 is often already taken by some other local Postgres/container. Use
5433 everywhere on every machine so the connection string never has to
change. **CI still uses 5432** — don't "fix" the workflow to match.

Why `$env:DATABASE_URL` even though it's already in `apps/api/.env`: the
Prisma CLI does not read `.env` files (Prisma 7 dropped that; only `tsx
--env-file` in `pnpm dev` reads it). Set it in the shell for any direct
`prisma` command.

Why `127.0.0.1` and not `localhost`: on Windows, `localhost` can resolve to
`::1` (IPv6), and the Postgres container only publishes the IPv4 address.
`127.0.0.1` avoids a `P1001: Can't reach database server` that looks like a
broken database and isn't.

Why `prisma generate` comes **after** `migrate deploy` and **before** §6: the
client in `apps/api/src/generated/prisma` is a third git-ignored generated
directory, and it is generated from `schema.prisma`, not from the database. A
stale one has no model property for anything a newer migration added, so the
seed fails with a bare `TypeError: Cannot read properties of undefined
(reading 'deleteMany')` — the undefined thing is the missing model, not the
data.

## 6. Seed demo data

```powershell
pnpm --filter @irp/api run db:seed
```

Idempotent — safe to re-run any time. **Re-run it after running the API's
own test suite** (`pnpm --filter @irp/api test`), because those tests
`TRUNCATE` the tables the seed populates.

It reads `DATABASE_URL` from `apps/api/.env` via `process.loadEnvFile()`, so
unlike the `prisma` commands above it does not need the shell variable — but
setting it does no harm, since `loadEnvFile` never overrides an already-set
variable.

## 7. Run the app

Two separate terminals (both are long-running dev servers):

```powershell
Set-Location apps/api; pnpm dev
```
```powershell
Set-Location apps/web; pnpm dev
```

Open **`http://localhost:3100`** — not `127.0.0.1`. Next.js canonicalises
loopback hostnames to the literal string `localhost`; hitting `127.0.0.1` in
the browser breaks HMR (page renders via SSR but never hydrates, so nothing
is clickable) and breaks the Auth.js sign-in redirect.

Why **3100** and not Next's default 3000: the same reason Postgres is on 5433
and not 5432 — the default is routinely already held by something else on a
developer machine. `pnpm dev` carries the port, so there is nothing to pass.
The API stays on **3001**.

**If you ever move that port, it is not one setting.** `JWKS_URI` and
`JWT_ISSUER` in `apps/api/.env` both name it, and so does `DEV_ISSUER` in
`apps/web/lib/dev-identities.ts` — a hardcoded constant, not something derived
from `AUTH_URL`. `JWT_ISSUER` is string-compared against what `DEV_ISSUER`
stamped on the token, so if those two disagree the API starts perfectly and
returns 401 to everything, and the app bounces you to
`/signin?reason=expired` as though your session had simply timed out.
`CLAUDE.md`'s **Local ports** rule lists every file involved.

---

## 8. Signing in and what you'll see (demo data)

On `/signin` you'll see a **dev identity picker** (only present because
`AUTH_DEV_BYPASS=true` — it's replaced by a real Microsoft sign-in button
once Entra is wired up). Three choices:

| Picker option | Signs in as | Role |
|---|---|---|
| **Mentor (Admin)** | `dev-admin-1`, "Dev Mentor" | mentor — sees everything below |
| **Student** | `dev-student-1`, "Dev Student" | student — sees only their own data |
| **Unregistered user** | `dev-unknown-1` | has no User row; deliberately produces a 403 → `/not-registered`, proving the authorization boundary |

**Sign in as Mentor to see the full demo** — the student view only ever
shows one persona (Dev Student, fully compliant), so the interesting
variety (late, missed, absent, archived, etc.) is only visible from the
mentor's Roster / Review / Students / Cycles screens, which read every
batch's students, not just the signed-in identity.

### Seeded batches

| Batch | Started | Notes |
|---|---|---|
| **Batch 1** | 2 cycles before today | Older batch, further into its lifecycle. `batch: "A"` in the fixtures |
| **Batch 2** | at the start of the current cycle | Newer batch, just getting going. `batch: "B"` |

The names come from `SEED_BATCH_NAMES` in `packages/fixtures`. Renaming them
there does **not** migrate an existing dev database — the seed owns its
batches by name, so the old rows survive as empty orphans and the picker shows
both sets. Delete the old ones by name once after any rename.

### Seeded students (10 total, plus 2 mentors)

All history is generated **relative to today's date** — the seed computes
every persona's late/missed/absent days backwards from "now", so re-seeding
on a different day shifts the exact dates but preserves each persona's
character. Nothing here is a fixed calendar date.

| Name | Batch | Persona (`kind`) | What it demonstrates |
|---|---|---|---|
| Dev Student | A | `compliant` | Every required day submitted on time — the clean baseline. Also the only student reachable via the student-side dev picker |
| Nuwan Perera | A | `late` | Roughly 1 in 3 submissions land inside the grace window, flagged Late |
| Sachini Silva | A | `missed` | Roughly 1 in 4 required days has no entry and no absence — flagged Missed |
| Kavindu Jayasuriya | A | `absent` | Roughly 1 in 5 required days is a recorded Absence with a reason |
| Tharindu Weerasinghe | A | `archived` | Stopped submitting 3 weeks after joining, then archived (soft-deleted) — proves archived students disappear from active Roster/Cycles views (FR-5) |
| Ishara Gunawardena | B | `compliant` | Clean baseline in the newer batch |
| Dilini Rathnayake | B | `weekend` | Submits an Extra entry every Saturday — drives the Roster's "Extra (cycle)" count; weekends never count as required/missed |
| Ramesh Kumar | B | `joiner` | Enrolled a few days after Batch 2's cycle started — a mid-cycle joiner (FR-27) |
| Amaya Wickramasinghe | B | `transfer` | Started in Batch 1, transferred to Batch 2 when it opened — cross-batch enrolment history |
| Chamodi Herath | B | `mixed` | A blend of on-time, late, missed, and absent days — the most "realistic" single persona; also the one used to demo the Roster → Review → Submitted → In Review → Evaluated → locked walk, and the archive/restore flow |

Older daily reports are pre-advanced through the review lifecycle so you
don't have to manually walk every day forward:
- Reports older than ~14 days: **Evaluated**
- Reports 7–14 days old: **In Review**
- Reports newer than 7 days: **Submitted** (untouched, for you to review live)

### Suggested demo flow

1. Sign in as **Mentor**.
2. **Roster** — see both batches, the per-student status for today, Dilini's
   "Extra (cycle)" count, and that Tharindu (archived) does not appear.
   Note the Extra column is a **cycle** total, not a figure for the selected
   date: change the date within the same cycle and it does not move. Every
   other column on the row is date-scoped.
3. **Review** → pick Chamodi Herath (or any recent Submitted report) → walk
   it Submitted → In Review → Evaluated, then note it locks.
4. **Students** directory → show the archive flow, and that it's reversible
   (restore, FR-5). Note that **Register** moved to **Settings** (ADR-0022),
   while **Create batch** came back here as a third panel stacked under
   **Transfer** (ADR-0023, which narrows ADR-0022's scope rather than
   reversing it) — Students now carries **Transfer**, **Create batch**, and
   **People**.
5. **Settings** → **Register** a throwaway student or mentor, then switch to
   **Appearance** and pick **Dark**. Dark was shipped with ADR-0002 but was
   only reachable by changing the OS theme until this slice (ADR-0021) — it's
   worth demoing precisely because it was previously unreachable. The repaint
   is instant (no reload), and it survives a reload because the choice is a
   server-readable cookie, not `localStorage`. Switch back to **Follow
   system** (or **Light**) before continuing, so the rest of the walkthrough
   isn't accidentally done in the wrong theme.
6. **Today** dashboard → per-batch "N of M submitted" figures and the cycle
   ribbon. Open **"How to read this"** underneath: it names the eight ribbon
   marks and states the aggregation rule — each bar is the **worst** outcome in
   the batch that day (missed → late → absent → partly in → on time), so a red
   bar means at least one student missed, not that all of them did (ADR-0020).
7. **Cycles** view → every active student in either batch, confirm no score is
   shown (scoring/evaluation is blocked on open point O-5 — AI provider not
   yet chosen).
8. **Sign out** — in the sidebar now, pinned directly below **Settings**
   inside the same divider group, not in the topbar (O-15) — then sign back
   in as **Student** → `/my-month` → own pills only, no rank, no peer names,
   no score (FR-29/FR-30). Note **Settings** is on the student sidebar too,
   showing **Appearance** only — the theme is a personal preference, not a
   mentor privilege.
9. Sign in as **Unregistered user** → confirm the 403 → `/not-registered`.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `P1001: Can't reach database server` despite a healthy container | `localhost` resolved to `::1` | Use `127.0.0.1` in every connection string |
| `PrismaConfigEnvError` on `migrate`/`generate` | Prisma CLI doesn't read `.env` | `$env:DATABASE_URL = "..."` in the current shell first |
| `docker version` fails with `failed to connect to the docker API at npipe:...dockerDesktopLinuxEngine` | Docker Desktop isn't running (the engine, not the CLI — `docker.exe` resolves fine) | Start Docker Desktop, then re-probe until it answers. On a per-user install it is **not** under `C:\Program Files\Docker` — see the path in `handoff.md`'s local-environment table |
| `apps/api` exits immediately: `SyntaxError: The requested module '@irp/core' does not provide an export named 'X'` | `packages/core/dist` is stale — it predates the export | `pnpm --filter @irp/core build` (§3) |
| Turbopack **Build Error** in the browser: `Export X doesn't exist in target module … packages/client/src/index.ts` | `packages/client/src` was generated from an older `spec/openapi.yaml` | `pnpm generate`, then `pnpm --filter @irp/client build` (§3) |
| Seed fails with `TypeError: Cannot read properties of undefined (reading 'deleteMany')` | Stale Prisma client — the undefined value is a model a newer migration added | `pnpm --filter @irp/api exec prisma generate` (§5), then re-seed |
| `pnpm typecheck` reports `TS2322: Type '"/roster"' is not assignable to type 'Route'` (and similar for other routes) on pages that render fine | Stale `.next/types/routes.d.ts` — `typedRoutes` types come from `next build`, and `next dev` writes a copy `tsconfig` doesn't read | `$env:AUTH_DEV_BYPASS = "false"; pnpm --filter @irp/web build`, then re-typecheck. **Don't cast the href** — the code is correct |
| Page renders but nothing is clickable | Browser pointed at `127.0.0.1:3100` | Use `http://localhost:3100` |
| Signed in fine, then every page bounces to `/signin?reason=expired` | **Expected after any `apps/web` restart.** The dev signing keypair is generated once per *process* (`lib/dev-identity.ts`), so tokens minted by the previous process no longer verify — `apps/api` returns 401 and `lib/api-client.ts` redirects. Tokens are 8h, so this is a restart, not a timeout | Sign in again. A dev-server restart triggered by editing a workspace package (e.g. re-running `pnpm generate`) does this too, which is why it can look spontaneous |
| Sign-in redirect lands on the wrong origin / cookie missing | Same cause as above | Use `localhost`, not `127.0.0.1`, in the browser |
| `docker compose up` port conflict on 5432 | Another local Postgres/container already holds it | This repo standardizes on 5433 — make sure `$env:IRP_DB_PORT = "5433"` is set before `up` |
| `next build` succeeds locally with `AUTH_DEV_BYPASS=true` | The production guard is broken — should never happen | Investigate immediately, don't ignore |
| `pnpm --filter @irp/web build` fails locally | `.env.local` sets `AUTH_DEV_BYPASS=true`, and `next build` forces `NODE_ENV=production` | This is the guard working as intended. Run with `AUTH_DEV_BYPASS=false` explicitly for a local production build |
| Demo data missing/wrong after running tests | `apps/api`'s test suite truncates the seeded tables | Re-run `pnpm --filter @irp/api run db:seed` |
| `TS2307: Cannot find module '@/assets/….png'` in CI, on a branch that typechecks locally | The declaration for image imports lives in `next-env.d.ts`, which is **generated and git-ignored** — present locally the moment `next dev`/`next build` has run, absent in a fresh clone. CI typechecks before it builds | Already fixed for images by `apps/web/types/static-image-assets.d.ts`. If you add the first import of a **new** asset type, add its reference there — and verify by moving `next-env.d.ts` aside first, because a warm working tree cannot reproduce this |
| Sign-in appears to work, then every page bounces to `/signin?reason=expired` **immediately**, and the API log shows 401s | `JWT_ISSUER` in `apps/api/.env` does not byte-match `DEV_ISSUER` in `apps/web/lib/dev-identities.ts`. Usually a half-finished port change. Distinct from the restart case above, which only strikes after `apps/web` restarts | Make the two strings identical (both `http://localhost:3100/api/dev-jwks` today). Note `JWKS_URI` is a **different** variable and is fetched, so it says `127.0.0.1` — that mismatch is deliberate |
| A database/API command run through an AI coding agent's sandboxed shell fails to connect even though the container is healthy | Some sandboxed shells can't open TCP connections to localhost ports | Run database/dev-server commands in a real terminal, not a network-sandboxed one |

---

## 10. What this setup deliberately does not need

- No Azure account, Azure CLI, or Bicep — those are deploy-only.
- No Entra ID tenant or app registration — the dev bypass mints its own
  tokens; `apps/api` still validates them for real, it just trusts a
  different (local) issuer.
- No manually-inserted database rows — `pnpm --filter @irp/api run db:seed`
  is the only supported way to get demo data, and it's the same seed CI and
  the Playwright suite use.

**The dev bypass must never be used in production** — it throws at startup
if `AUTH_DEV_BYPASS=true` and `NODE_ENV=production` are set together, by
design. Don't work around that guard.

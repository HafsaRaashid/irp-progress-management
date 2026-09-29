# End-to-end suite

Six spec files, one Playwright config with **two** projects, one seeded database:

| Spec | Proves |
|---|---|
| `signin.spec.ts` | The chain this slice exists to prove: browser → Auth.js → encrypted cookie → decrypt → `@irp/client` → `apps/api` → Postgres → rendered user. Every dev-identity-picker branch, including the unregistered-user 403 and the never-a-token-in-the-browser assertion. |
| `student-flows.spec.ts` | The Plan 6 student surface — on-time submission, the legal submission window (never older than the previous weekday), the absence round-trip, FR-20's lock from the student's own view, the mentor-page redirect, and sign-out. Signed in as `dev-student-1` ("Dev Student") only — see "Personas" below for why. |
| `mentor-flows.spec.ts` | The Plan 6 mentor surface — Roster (row-per-student, the weekend persona's Extra badge), Roster → Review → attendance/tasks record → Submitted → In Review → Evaluated → locked, the Students directory's archive flow, and registering + archiving a throwaway student. Registration itself happens on `/settings` (ADR-0022, Plan 7A) — the People directory on `/students` only lists and archives. Signed in as `dev-admin-1` ("Dev Mentor"). |
| `dashboard-flows.spec.ts` | The Plan 7 dashboards — mentor Today's per-batch figures and calendar (O-17), the Cycles view, and FR-29/FR-30's student My month. Signed in as `dev-admin-1` for the mentor side and `dev-student-1` for the student side; see its own section further below for the full test table. |
| `dark-theme.spec.ts` | The Plan 7A dark guard — every reachable view renders, and its landmark content is present, with the OS reporting dark: the six mentor views plus `/review/<id>` (reached via the Roster's own "Review" link, the way `mentor-flows.spec.ts` does), the two student views, and the bare `/signin` frame. Read-only, and runs under the `chromium-dark` project only; see "Two projects, not one" below. |
| `settings.spec.ts` | The Plan 7A Settings page — the theme switch's cookie round trip (attribute survives a reload only if the server actually read the cookie) and, since the fix wave, that the attribute genuinely applies the dark tokens; and that a student reaches Settings with Appearance only, no mentor sections. Runs in the default `chromium` project (light), signed in as both `dev-admin-1` and `dev-student-1`. |

## Two projects, not one

`playwright.config.ts` defines `chromium` (light, the default, `testIgnore`s `dark-theme.spec.ts`)
and `chromium-dark` (`colorScheme: "dark"`, `testMatch`ed to `dark-theme.spec.ts` alone).

**The dark project must never be widened to the mutating specs.** `mentor-flows.spec.ts` and
`student-flows.spec.ts` submit an entry for today, walk a report irreversibly to Evaluated, and
`mentor-flows`' archive test calls `reseed()` mid-run. `workers: 1` already pins this suite to one
serial schedule so state consumed by one pass is not met unexpectedly by another (see the config's
own comment on the 24/24 → 23/24 → 19/24 history); running any of those three specs a second time
under `chromium-dark` would be exactly that hazard again, deliberately reintroduced. `dark-theme.spec.ts`
is read-only for this reason, not by accident — it navigates and asserts rendering, nothing else.
`testMatch` is what scopes `chromium-dark` to this one file; do not widen it, and do not add any
navigation here that submits, transitions, or reseeds.

### One view still unguarded

`/not-registered` is not reachable by this suite. It needs the unregistered dev identity, and
`e2e/helpers.ts` exposes sign-in helpers only for the two registered personas
(`signInAsStudent`, `signInAsMentor`) — no helper exists for the unregistered one, and adding
one here would be scope creep for what this spec is for. So of the eleven views the app
serves, ten are covered by the dark walk (the six mentor views, `/review/<id>`, the two student
views, and `/signin`) and `/not-registered` is the one that is not. Whoever adds an
unregistered-identity helper for another suite should extend `dark-theme.spec.ts` at the same
time.

### What proves dark works — four layers, none redundant

Easy to conflate; each one is the only thing that proves its own claim:

| Layer | Proves |
|---|---|
| `apps/web/test/theme-tokens.test.ts` | The two `dark-tokens` blocks in `globals.css` (media query and `:root[data-theme="dark"]`) stay byte-identical. Says nothing about whether either block ever applies. |
| `chromium-dark` (`dark-theme.spec.ts`) | The **media-query** path: with the OS reporting dark and no explicit choice, every view renders. Does not touch the cookie or the explicit-choice path at all. |
| `settings.spec.ts` (cookie round trip) | The **explicit-choice** path persists: choosing Dark stamps the attribute, and it survives a reload only if the server read the cookie back. Says nothing about whether the attribute then does anything visually. |
| `settings.spec.ts` (computed-style assertion, added in the pre-merge fix wave) | The attribute actually **applies** — `getComputedStyle(document.documentElement).getPropertyValue("--bg")` reads `#121212` after choosing Dark, in the light `chromium` project where the media query cannot be the cause. Before this assertion existed, typoing or deleting the `:root[data-theme="dark"]` selector left every other layer green. |

No single layer implies another; a change that breaks dark can pass three of these four and still
be caught by the fourth.

## Personas

`@irp/fixtures` (`packages/fixtures/src/index.ts`) is the one list the database seed and the
dev-identity picker both derive from — see its own docblock. The picker itself still only carries
three entries (`apps/web/lib/dev-identities.ts`: Mentor, Student, Unregistered user) — Plan 5 kept
it that way and Plan 6 did not extend it — so a **Student** flow can only ever be driven as
`dev-student-1` ("Dev Student", compliant, Batch 1). Every other persona is reached from the
**mentor's** side instead, since Roster/Review/Students read every batch's students, not just the
signed-in identity:

| externalId | Name | Batch | Kind | Exercised in |
|---|---|---|---|---|
| `dev-student-1` | Dev Student | Batch 1 (A) | compliant | `student-flows.spec.ts` (signed in as), `mentor-flows.spec.ts` (roster row count), `dashboard-flows.spec.ts` (signed in as for the whole student My month suite; also part of Batch 1's dashboard/Cycles figures) |
| `seed-student-a2` | Nuwan Perera | Batch 1 (A) | late | `mentor-flows.spec.ts` (roster row count), `dashboard-flows.spec.ts` (Batch 1's N of M and Cycles listing) |
| `seed-student-a3` | Sachini Silva | Batch 1 (A) | missed | `mentor-flows.spec.ts` (roster row count), `dashboard-flows.spec.ts` (Batch 1's N of M and Cycles listing) |
| `seed-student-a4` | Kavindu Jayasuriya | Batch 1 (A) | absent | `mentor-flows.spec.ts` (roster row count), `dashboard-flows.spec.ts` (Batch 1's N of M and Cycles listing) |
| `seed-student-a5` | Tharindu Weerasinghe | Batch 1 (A) | **archived** | `mentor-flows.spec.ts` (asserted ABSENT from the active roster), `dashboard-flows.spec.ts` (asserted ABSENT from the Cycles listing too) |
| `seed-student-b1` | Ishara Gunawardena | Batch 2 (B) | compliant | `dashboard-flows.spec.ts` (part of Batch 2's N of M figure) |
| `seed-student-b2` | Dilini Rathnayake | Batch 2 (B) | **weekend** | `mentor-flows.spec.ts` (roster's `+N extra` badge), `dashboard-flows.spec.ts` (Batch 2's N of M figure) |
| `seed-student-b3` | Ramesh Kumar | Batch 2 (B) | joiner | `dashboard-flows.spec.ts` (part of Batch 2's N of M figure) |
| `seed-student-b4` | Amaya Wickramasinghe | Batch 2 (B) | transfer | `dashboard-flows.spec.ts` (part of Batch 2's N of M figure) |
| `seed-student-b5` | Chamodi Herath | Batch 2 (B) | **mixed** | `mentor-flows.spec.ts` (review's Submitted → In Review → Evaluated walk, and the archive flow), `dashboard-flows.spec.ts` (part of Batch 2's N of M figure) |
| `dev-admin-1` | Dev Mentor | — | mentor | `mentor-flows.spec.ts` (signed in as), `dashboard-flows.spec.ts` (signed in as for the whole mentor Today/Cycles suite) |
| `seed-mentor-2` | Priya Fernando | — | mentor | — (never signed in by any spec) |

## Relative-date honesty

Several assertions depend on which weekday the suite happens to run on (the submission window's
size, whether the current cycle contains a Saturday yet, whether the compliant persona's own
on-time seed entry for today has already landed). Rather than forcing a fixed answer, those tests
compute today's actual state via `@irp/core` and either assert against the derived expectation or
call `test.skip(true, "...")` with a description explaining exactly which condition wasn't met.
Skips here are not a suite that gave up — they're recorded evidence of which branch a given run
took. Check the HTML report's annotations (or the `list` reporter's output locally) if a run
skipped more than expected.

## Prerequisites

1. Postgres running and migrated:

   ```powershell
   $env:IRP_DB_PORT = "5433"
   docker compose -f apps/api/docker-compose.yml up -d
   $env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
   pnpm --filter @irp/api exec prisma migrate deploy
   ```

2. The seeded demo data. `dev-unknown-1` is deliberately absent —
   the test asserts it produces a 403.

   **Re-seed before every Playwright run.** `apps/api`'s own test suites
   `TRUNCATE` the database, so a `pnpm --filter @irp/api test` run wipes
   the demo rows even if you seeded earlier in the session.

   ```powershell
   $env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
   pnpm --filter @irp/api run db:seed
   ```

   The seed is idempotent and covers far more than the two users the old
   manual INSERT created — see `docs/superpowers/specs/2026-08-02-slice-2-product-design.md` §6.

   `mentor-flows.spec.ts`'s archive test reseeds again itself, mid-suite (a
   synchronous `execSync` of the same command), to restore Chamodi Herath
   after archiving her — see that test's comment for why reseeding was
   chosen over leaving her archived. You do not need to reseed by hand
   between `student-flows.spec.ts` and `mentor-flows.spec.ts` on a single
   `pnpm --filter @irp/web e2e` run; only re-seed by hand when re-running the
   suite in a fresh session.

3. `apps/api/.env` and `apps/web/.env.local` from their `.env.example` files,
   with `AUTH_DEV_BYPASS=true` and the API pointed at the dev JWKS:

   ```bash
   # apps/api/.env
   JWKS_URI=http://localhost:3100/api/dev-jwks
   JWT_ISSUER=http://localhost:3100/api/dev-jwks
   JWT_AUDIENCE=api://irp-progress-management
   ```

   `apps/web/.env.local` needs `AUTH_SECRET` set (any 32+ random bytes,
   `openssl rand -base64 32`) so the session cookie can be encrypted and
   decrypted, and `AUTH_DEV_BYPASS=true` so the dev identity picker renders
   on `/signin` instead of the Microsoft Entra button.

## Run

```powershell
pnpm --filter @irp/web exec playwright install chromium
pnpm --filter @irp/web e2e
```

If the JWKS fetch fails, `apps/api` returns **503** rather than 401 (Task
11's behaviour). Check `JWKS_URI` in `apps/api/.env` points at
`http://localhost:3100/api/dev-jwks` and that `apps/web` is up.

## `dashboard-flows.spec.ts` (Plan 7)

Ten tests over the same seeded personas, covering FR-28's mentor dashboard, the Cycles view,
and FR-29/FR-30's student My month. This table does not list every one individually — two
§8.2-restructure checks (the student's own calendar sits above the composer; My month carries
no calendar of its own) are in the file but not repeated below.

| Test | Personas it touches | What it proves |
|---|---|---|
| N of M submitted, per batch | `dev-admin-1`'s view of Batch 1 and Batch 2 | The must-ship figure renders for every batch, N never exceeds M, and N is never smaller than the late count shown beside it. Navigates via the batch chip between iterations (O-17): only the selected batch's region renders per page load, unlike the old ribbon stack |
| M matches the Roster's row count | Batch 1's active students | The dashboard's denominator and the Roster agree for the *same day* |
| Calendar's weekday-cell count matches the cycle it names | Batch 1 | The figcaption's "Day x of y" and the calendar's own weekday-cell count agree — see the caveat below |
| Switching the batch chip re-renders the calendar (O-17, D3) | Batch 1 and Batch 2 | The calendar's caption updates to the newly selected batch, and only one calendar exists on the page at a time |
| Cycles lists every active Batch 1 student, never a score | All Batch A personas; the archived one (Tharindu) | FR-5 — an archived student leaves active views; and no score exists to leak |
| Month N of 6, own pills, empty S&W | `dev-student-1` (fully compliant) | FR-29's three elements render together |
| No score, rank, or peer name | `dev-student-1` vs every other persona | FR-30, asserted against the whole `<main>` text |
| Student blocked from mentor dashboards | `dev-student-1` | `/cycles` redirects home, and the link is never offered |

### Re-seed before running

```bash
export DATABASE_URL='postgresql://irp:irp@127.0.0.1:5433/irp?schema=public'
pnpm --filter @irp/api db:seed
```

### Every assertion here is relational — and it has to be

The seed is a **function of the run date**: `run-seed.ts` computes every
persona's history backwards from "now" via `@irp/core`, so which days are
late, missed or absent — and which cycle each batch is on — shifts with the
calendar. A hard-coded count, date or percentage would pass on the day it was
written and fail on the 10th.

So these tests never assert a literal figure. They read what the page reports
and check it against something that must agree: N against M, the calendar's
declared cycle length against its own rendered weekday-cell count, the
dashboard's denominator against the Roster's row count for the same day.

**One trap worth knowing.** The Roster defaults to *today*; mentor Today falls
back to the *last required day* when today is a weekend. Comparing the two
against the Roster's default would pass Monday to Friday and fail every
Saturday. The row-count test therefore addresses the Roster explicitly by the
ISO date the dashboard exposes on `data-date`, alongside the batch id in its
`data-testid` — neither value hard-coded, and no weekday assumption.

### What the calendar weekday-cell-count check does and does not prove

Both figures it compares — the figcaption's "Day x of **y**" and the count of
gridcells whose accessible name contains "submit until" (only real weekday
cells carry that wording; weekend and adjacent-month-padding cells never do,
per `apps/web/components/cycle-calendar/cycle-calendar.tsx`'s `cellLabel`) —
derive from the **same** `cycleWorkingDays(bounds)` array, computed once per
request. So the check catches a rendering bug (the UI reading the wrong
field, or the two elements falling out of step), but it cannot catch a
backend miscalculation of `requiredDayCount` itself: both numbers would then
be wrong identically and still agree.

The general-purpose proof that `cycleWorkingDays` itself is correct —
weekday-only, starts/ends within the cycle's own bounds, a plausible count for
a typical cycle — lives in `packages/core/src/cycle.test.ts`, independent of
any one fixture date. `apps/api/test/dashboard-service.test.ts` additionally
pins a handful of specific scenarios to independently-derived literals
(Finding 5 of this same whole-branch review, API scope), which is real
regression coverage for those exact fixtures but is not itself a general proof
of the algorithm — it is `packages/core/src/cycle.test.ts` that is.

### A note for whoever ships the evaluation UI

The FR-30 leak test asserts the rendered text matches none of
`/rank|leaderboard|performance index/i`. Today no code path on `/my-month`
renders a score at all — the evaluation UI is blocked on O-5 — so that
assertion cannot currently fail. When scores land, revisit the forbidden-word
list: a leak worded differently would pass this test unchanged.

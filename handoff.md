# Handoff — IRP Progress Management System

**Created:** 2026-07-27
**Origin:** split out of `bistec-intern-onboarding` (Month 2 Internal Project Sprint)
**Target location:** `D:\Bistec\irp-progress-management`
**Team:** Damian De Cruz, solo (all three BMAD roles — see `docs/interview-and-prd.md` §4)
**Stakeholder / decision owner:** IRP Mentor, Bistec Hearts Academy (contact via Teams)

---

## 0. Where this folder lives

This folder was authored inside the onboarding repo and **copied** to its own location:

| Path | Role |
|---|---|
| `D:\Bistec\irp-progress-management\` | **The build repo. Authoritative. Work here.** |
| `D:\Bistec\bistec-intern-onboarding\weekly-challenges\month-2\irp-progress-management\` | Frozen snapshot, committed as part of the Month 2 submission record. Do not build here |

If you are reading this at the onboarding-repo path, you are in the snapshot — switch to `D:\Bistec\irp-progress-management`.

Still to do in the build repo:

```powershell
cd "D:\Bistec\irp-progress-management"
git init
git add .
git commit -m "chore: initial commit — PRD, interview record, and project guidance"
gh repo create irp-progress-management --private --source . --push   # or create it in the Bistec org
```

Copies of the PRD, the interview record, and the brief also sit directly under the onboarding repo's `weekly-challenges/month-2/` as the graded submission artefacts. **This repo is authoritative for building.** If a requirement changes, change it here — then copy back to the onboarding repo if the submission copy needs to match.

---

## 1. State of play

### 2026-08-18 — PR #17's red CI, and the web dev server moves to 3100

Two things, both outside any plan. **Both merged the same day — #17 then #18 — and `main` is now at
`5e99498` with nothing in flight.**

**1. The first static asset import broke CI, and no local check could have caught it.**
Plan 7B's brand mark landed `import mark from "@/assets/hearts-academy-mark.png"`. All three
timezone legs failed at Typecheck with `TS2307: Cannot find module …` while the branch was green
locally through a full `next build`. The declaration that makes a PNG import resolve —
`/// <reference types="next/image-types/global" />` — lives in `apps/web/next-env.d.ts`, which is
**generated and git-ignored**: present on any machine where `next dev` or `next build` has ever
run, absent in a fresh clone. CI typechecks *before* it builds, so nothing had generated it.

Fixed by committing the reference as `apps/web/types/static-image-assets.d.ts`. Rejected:
committing `next-env.d.ts` itself (it carries `import "./.next/types/routes.d.ts"`, a path into
another git-ignored tree — one TS2307 traded for another), and reordering CI's Typecheck after the
build (makes a plain `tsc` gate depend on a full Next build). Plan 7B Task 3 Step 6 asserted the
opposite in writing and was corrected at source.

**The generalisable shape:** a git-ignored generated file that a *local* check silently depends on
is invisible to that check. This is the same class as the stale `.next/types/routes.d.ts` trap
already recorded — same file, opposite direction: there, staleness made typecheck **falsely red**;
here, presence made it **falsely green**.

**2. `apps/web` now runs on 3100, not 3000** — the same reasoning that put Postgres on 5433.
Mentor's call, repo-wide from here on.

The trap found while doing it: **`DEV_ISSUER` is a hardcoded constant, not derived from
`AUTH_URL`.** Move the port without it and `apps/api` string-compares an `iss` claim that no longer
matches — it boots clean, 401s everything, and the app reports `?reason=expired`, so it reads as a
session problem rather than a config one. Every copy is listed in CLAUDE.md's **Local ports** rule
and in the constant's own docblock.

**Container-internal ports deliberately stay 3000**: `Dockerfile`'s `web` `PORT`/`EXPOSE`,
`compose.yaml`'s `PORT` and healthcheck, and `infra/main.bicep`'s `targetPort` — which must equal
the image's `PORT`. The collision 3100 avoids is host-side. `compose.yaml` publishes `3100:3000`,
so nothing a developer runs binds 3000 either way.

### 2026-08-04 — Plan 7B: frame and brand, and its Task 9 follow-up (O-15)

**Shipped:** the Bistec Hearts Academy mark in the app frame — `BrandMark`, a small `variant="mark"`
card in the topbar and the full stacked `variant="lockup"` on `/signin` and `/not-registered` —
replacing the placeholder diamond everywhere it appeared. Every sidebar row now carries a
hand-drawn `currentColor` icon before its label, including the label-only branch reserved for a
future destination. **Sign out** moved out of the topbar into the sidebar, pinned directly below
Settings inside the same `border-top` divider group, as a peer of the nav rows rather than a
loose control. **`Create batch` returned to Students**, stacked under `Transfer` in the left
column, per **ADR-0023** — which narrows **ADR-0022**'s scope for `Create batch` specifically
(ADR-0022 itself is unedited; its reasoning about `Register` and the Students/registration naming
mismatch stands) after the two-panel Settings/Students split left `Transfer` alone in a
grid-cols-2 left column next to `People`'s much taller directory, reading as a rendering fault
rather than a deliberate trim. None of this maps to an FR: it is logged as **O-15**, on the same
footing as O-14 (theme), with sign-off outstanding and non-blocking.

**`--brand-card` is the one token exempt from the light/dark pairing rule, deliberately.** Every
other token in `globals.css` is declared once in the light `:root` and again inside the
`dark-tokens:start`/`:end` markers `theme-tokens.test.ts` asserts hold exactly thirteen pairs.
`--brand-card` sits **outside** those markers and is never overridden, so it resolves to the same
`#ffffff` in both themes. This is not an oversight the pairing rule should have caught — the brand
lockup is a supplied asset with its own internal contrast (near-black wordmark on a light field)
that is not ours to re-verify, and a card that followed the theme would put that wordmark on
`#1c1e23` and erase it. It exists for the brand card alone and is not a general-purpose surface.

**Task 9's visual pass (performed directly against the running app, both themes, fresh seed data —
see `.superpowers/sdd/2026-08-04-plan-7b-frame-and-brand/task-9-visual-findings.md`): five of six
checks pass outright** — the topbar mark reads as intentional in both themes at 32px, all six
sidebar icons align on one baseline and the active row's icon recolours with its label, Sign out
matches the nav rows exactly including its full-width focus ring, `/students` now runs `Transfer`
and `Create batch` to a height comparable with `People` (the FR-3 deliverable ADR-0023 exists for),
and the `/signin`/`/not-registered` lockup card is uniformly white with no seam in dark.

**One latent spacing inconsistency was found and fixed.** The Review-count badge carried
`className="tabular ml-2"` on top of `.nav-item`'s `gap: 8px`, so label→badge spacing was
`gap + ml-2` while icon→label spacing was `gap` alone — invisible in every screenshot because the
seeded data leaves nothing pending review, so the badge never rendered. Fixed by dropping the
redundant `ml-2` (`apps/web/components/app-frame/sidebar.tsx`); `sidebar.test.tsx` and
`app-frame.test.tsx` both re-run clean, the latter's `/^Review\s*3$/` assertion being
whitespace-tolerant by design.

**A second latent defect was found and fixed in the same pass: a dev-console `next/image`
mismatch warning on the lockup (`55ec68e`).** The `Image`'s declared `height: 134` was hand-set
against `hearts-academy-lockup.png`'s pixel dimensions at the time it was chosen, and Task 3's
transparent-field trim changed those dimensions without the declared height being recomputed to
match — next/image's dev-only warning compares the declared `height`/`width` HTML attributes
against the actual rendered size, not CSS, so the mismatch fired on every load. A `style={{
height: "auto" }}` override was tried and measured (via a real browser) to be a no-op: Tailwind's
preflight already forces `height: auto` on every `<img>`. Fixed by recomputing the declared height
from the asset's true pixel ratio (see `brand-mark.tsx`'s comment for the exact figures); `height:
133` is what actually silences the check, because it is what the browser already renders.

**The back/forward theme question Plan 7A left open reproduces, and it is worse than 7A's review
predicted — logged as new open point O-16.** 7A expected the page to *stay* dark while only the
radio might misread "Follow system." Measured with the OS reporting light (so any dark rendering
could only come from the explicit choice): choosing **Dark**, navigating away, then pressing
**Back** renders the page itself in the **pre-choice (light) theme**, not just the radio — Next's
client router cache replays an `<html data-theme>` snapshot from before the cookie changed. It
self-heals on a full reload. This is **pre-existing from Plan 7A / ADR-0021**, not introduced by
Plan 7B — `theme-control.tsx`/`theme-actions.ts` were untouched by this plan apart from Task 9's
fix below. A real fix is an ADR-level decision: the theme cookie is deliberately `httpOnly`
(ADR-0021), so the client cannot read it to re-stamp the attribute on restore, and every candidate
(drop `httpOnly`, add `revalidatePath`, introduce a client-readable store) either needs its own ADR
or is the exact thing `theme-actions.ts`'s docblock rejects — it would force a server round trip
and re-render on every switch, contradicting ADR-0021's flash-free Decision. Not fixed here on
purpose — see `docs/interview-and-prd.md` O-16.

**What Task 9 did fix: the radio group's half of that defect.** `ThemeControl` seeded its checked
state from the server-supplied `current` prop alone, which is exactly what a stale router-cache
replay can serve out of step with the live DOM. It now reconciles from
`document.documentElement.dataset.theme` in a `useEffect` that runs once after mount — after
hydration, not during it, so the first render is still byte-identical to the server's and no
hydration mismatch is introduced structurally. **This was not verified in a browser console**
(no dev server was started for this task per its instructions); the claim is architectural, not
empirically confirmed against a live hydration warning. `revalidatePath` was not touched, and the
cookie stays `httpOnly`. Covered by two new cases in `apps/web/test/theme-control.test.tsx`, and two
existing tests (there and in `settings-page.test.tsx`) needed updating to set the live DOM
attribute consistent with their `current` prop, since that consistency is exactly what the real
app guarantees and a page-only unit test does not exercise for free.

**`/not-registered` remains the one view of eleven with no dark e2e cover.** `e2e/helpers.ts` has
no unregistered-identity sign-in helper and inventing one was out of scope for Plan 7B; already
recorded in `apps/web/e2e/README.md`.

Verified (full detail in
`.superpowers/sdd/2026-08-04-plan-7b-frame-and-brand/task-9-report.md`): typecheck 6/6 projects
(both before AND after `next build`, so the route-typing trap `CLAUDE.md` records could not have
hidden anything) · core 113/113 · api 269/269 · web 260/260 · `pnpm lint` exit 0 · `next build`
(`AUTH_DEV_BYPASS=false`) — 13 routes, all `ƒ` · Playwright 31 tests/1 skipped (the documented
`student-flows.spec.ts:38` gap), 30 passed · the two colour-literal/Tailwind-utility greps, zero
matches · `hearts-academy` mark and lockup assets present under `apps/web/.next/static/media/`.

### 2026-08-04 — roster legibility pass (FR-19, FR-28, FR-33)

A small post-Plan-7 slice, not a plan of its own. Three things, plus two defects it surfaced.

- **Seed batches renamed** `Batch Aurora`/`Batch Basalt` → **`Batch 1`/`Batch 2`**, at
  `SEED_BATCH_NAMES` in `packages/fixtures`. The Playwright suite now imports that constant instead
  of hardcoding the strings — the rename had to touch five literals, which is the argument.
  **The seed owns its batches by NAME, so a rename orphans the old rows rather than migrating
  them**; an existing dev DB keeps both sets and the picker shows four chips. Deleted the two old
  rows by name once, by hand. Written up in `run-seed.ts` and ONBOARDING §8.
- **Roster's `Entries` column header** was a plain `<Th>` against a `<Td numeric>`, so the header
  sat left while its count sat right and read as belonging to `Extra`. Fixed.
- **`Extra` → `Extra (cycle)`.** The value was never per-day: `roster-service.ts` counts `isExtra`
  across every day in the cycle containing the roster date (as `RosterRow.extraCountThisCycle` in
  the spec says), so it is identical on every date within a cycle while every other column on the
  row is date-scoped. The header was the whole defect; the number was always right.
- **The shared `Table` moved `px-2` → `px-3`.** Alignment alone could not fix the crowding: at 8px
  padding any right-then-left column pair puts its content 16px apart, so fixing the header merely
  moved the collision from `Entries`/`Extra` to `Extra`/`Absence reason`. 12px is the top of
  design-system §5's sanctioned "8–12px row padding"; vertical density deliberately unchanged.
- **Pre-existing, found by this work:** `apps/api/test/seed.test.ts` budgets `runSeed` at 120s in
  `beforeAll` but two tests call it again on Vitest's **default 5000ms**. It timed out at 5006ms
  mid-seed — the wipe commits, the rebuild is cut off, and the next four tests assert against a
  half-seeded database, so **one timeout presents as four unrelated failures**. Both tests now
  carry the 120s budget the file already used. Same trap as Playwright's default timeout.
### 2026-08-04 (later) — the ribbon key, and the Playwright worker-count defect

- **`RibbonKey`** — a collapsed `<details>` key for the mentor dashboard's cycle ribbon, rendered
  once below all batch sections. Names all eight marks and states the aggregation rule, which is
  the reason it exists: a mentor's bar is the **worst** outcome in the batch that day, so a red bar
  means at least one student missed, not that all did. **ADR-0020**, and a note in
  design-system §7. Mentor-only — the same colours mean a student's own status on their ribbon,
  where "at least one student" is nonsense.
  - Its swatches import `MARK_COLOR` from `cycle-ribbon.tsx` rather than re-declaring the tokens.
    `counts-row.tsx` records why: the status vocabulary reached four separate inline definitions
    before it was consolidated.
  - **The first version shipped an unreadable key past its own green tests.** At a 16px swatch
    track a 55% `partial` fill was indistinguishable from a full `ok` bar, and the `today` ring had
    no room to clear its outline offset — so three of eight swatches looked identical. The tests
    assert text and colour values, which cannot catch that. Track is now 20px with 3px horizontal
    clearance. **Look at the render.**

- **`playwright.config.ts` now pins `workers: 1`, and this is the diagnosis of the flake the entry
  above logged as unreproducible.** `fullyParallel: false` orders tests *within* a file; it does
  **not** stop Playwright distributing *files* across workers. That is `workers`, and its default
  is 1 **only when `process.env.CI` is set** — otherwise half the logical cores. The same config
  therefore ran **1 worker in CI and 4 on the dev machine**, confirmed from the CI job log
  ("Running 24 tests using 1 worker") against a local run reporting 4.

  All four spec files share one Postgres database and one dev server and they mutate it:
  `student-flows` submits an entry and marks an absence for today, `dashboard-flows` asserts
  today's counts and cross-reads the Roster for the same day, and `mentor-flows`' archive test
  calls `reseed()` — a full `db:seed` that wipes and rebuilds every persona **mid-run**. A reseed
  in one worker while another is mid-assertion is not tunable; the shared fixture is the design.

  Measured on one commit against a freshly seeded database: **24/24, then 23/24, then 19/24**, while
  CI stayed green because CI was serial. After pinning: three consecutive local runs, 24/24 each.
  **A gate that only fails where nobody is watching is the worst kind** — it teaches the reader to
  re-run rather than to read. Do not raise `workers` to speed the suite up; serial costs ~2 minutes.

Verified: typecheck 6/6 · core 113 · api 269 · web 203 · eslint clean · `next build` 12 routes ·
Playwright 24/24 ×3 consecutive.

Verified for the entry above: typecheck 6/6 · core 113 · api 269 · web 198 · eslint clean ·
`next build` 12 routes · Playwright 24/24.

### 2026-08-04 — Plan 7A: Settings page, theme by cookie, verified dark (FR-3)

**Shipped:** a `/settings` page, pinned at the bottom of the sidebar for both roles. It carries an
**Appearance** section (Light / Dark / Follow system, everyone) and, for mentors only, **Register**
and **Create batch** — moved off `/students`, which now carries only Transfer and People
(ADR-0022). The theme choice persists in a server-readable cookie (`irp-theme`), read by the root
layout so `<html data-theme>` is correct in the initial HTML with no flash-of-wrong-theme
(ADR-0021). The client control stamps the DOM synchronously on click and persists via a Server
Action it does not wait for, so the repaint is instant. **This is the first release in which dark
is reachable without changing the operating system's own theme** — ADR-0002 shipped the dark
tokens with a full contrast audit; there was never an in-app way to see them until now.

**O-14 is outstanding.** The theme switch maps to no FR — `CLAUDE.md` says a change mapping to no
FR does not belong in the repo, so this is logged rather than silently accepted. The assumption
taken is that finishing ADR-0002 is wanted: support nobody can reach is not support, and the dark
tokens ship either way. Mentor sign-off is non-blocking and still pending. The theme layer's
commits (Tasks 2–5, 8's `chromium-dark` project) are kept separate from the FR-3 registration move
(Task 7) precisely so a "no" on O-14 reverts cleanly without touching the registration change.

**ADR-0021** (theme persistence by server-readable cookie, over `localStorage` or a `User` column)
and **ADR-0022** (Settings as the registration home, over leaving registration on Students or
renaming Students to "People") — both under `docs/adr/`.

**`/_not-found` and `/not-registered` moved from `○` to `ƒ` in the build's route table.** This is
an intended, measured consequence of Task 3 reading the theme cookie in the root layout — a cookie
read forces dynamic rendering for every route the root layout wraps, including the two previously
static ones — **not a regression.** Verified empirically, not asserted: built at the base commit
(`36b0de4`, immediately before Task 3) and at Task 3's commit (`3217547`), and diffed the two route
tables. Before: both `○`. After: both `ƒ`, every other route unchanged. `pnpm typecheck` stayed
clean at the branch tip once `.next/types/routes.d.ts` was regenerated.

**The `chromium-dark` Playwright project is scoped to one read-only spec (`dark-theme.spec.ts`),
and must NEVER be widened to cover `mentor-flows.spec.ts` or `student-flows.spec.ts`.** Those two
mutate shared state that a single serial run cannot survive twice: `mentor-flows` submits a
throwaway registration, walks a report irreversibly `Submitted → In Review → Evaluated`, and calls
`reseed()` mid-run — a full `db:seed` that wipes and rebuilds every persona; `student-flows`
submits an entry and marks/clears an absence for *today*, a day that does not reset between passes.
Running either file a second time in the same serial pass means the second pass meets state the
first pass already consumed (an already-Evaluated report, an already-submitted "today", a database
mid-reseed) — this is exactly the state-dependence that produced the 24/24 → 23/24 → 19/24 flake
logged above, before `workers: 1` was pinned. `dark-theme.spec.ts` only navigates and asserts
rendering for exactly this reason: a light-vs-dark comparison needs the app in two colour schemes,
not the mutating suites run twice.

**A known pre-existing gap, surfaced by this slice's Playwright work but not introduced by it, and
deliberately not fixed here:** `apps/web/e2e/student-flows.spec.ts:38` ("marks and clears an
absence for today") skips whenever today already carries a submission — gated at line 64 on
*state*, not on the weekend check at lines 42–48. `apps/api/src/seed/run-seed.ts:64` seeds the
compliant persona's on-time entry in a fixed **17:10–17:49 Colombo** window, and `run-seed.ts:208`
only seeds instants that have already happened, so any full-suite run whose most recent reseed
lands after that window finds "today" already submitted and skips — roughly the last seven hours
of every Colombo day. It is the **only** e2e test covering the absence mark/clear round trip, so
**FR-12 has zero e2e coverage** on any suite run after that daily instant, silently, with a green
build. Recorded for a future plan to give the absence round-trip a day-independent target (e.g. a
day the seed never touches) rather than "today."

**A copy note, deliberately left as-is.** The theme rejection message composes to *"That is not a
theme this app offers. This device will go back to Follow system on reload."* "go back to Follow
system" momentarily parses as an instruction rather than a description of what will happen.
Recorded as slightly clumsy and left unchanged — reworking user-facing copy is a design-system
decision, not a fix-round liberty, and the message is correct, just not elegant.

**The dark visual pass (spec D5) is owned by the human partner and was not performed by an agent.**
`dark-theme.spec.ts` proves every view renders and its landmark content is present with the OS in
dark; it cannot judge whether dark *looks* right — a test cannot see a border vanish into a canvas.
Still needing eyes, in order of suspected risk:
- **The ribbon's `future` mark** — a transparent bar with a `var(--line)` border. On `#121212`, a
  `#313339` border is the lowest-contrast element in the system; whether unreached days are still
  legible as such has not been confirmed visually.
- **Focus rings** on the theme radios and the Register form — §12 requires a visible 2px
  `--primary` ring; `#8a9ff0` on `#1c1e23` should be obvious, but has not been looked at.
- **`status-pill.tsx`** — the one component whose source mentions theme by name; every status needs
  a legibility check.
- **The `RibbonKey` swatches** — confirm `Partly in` still reads as a part-height bar and `Today`
  still shows its ring at the smaller swatch scale.
- **Selected/active nav** using `--primary-weak` (`#262c45` in dark) — confirm the current page is
  still obviously current against the dark canvas.
- **The sidebar's bottom-pinning and its divider above Settings** — jsdom cannot verify either;
  both need a real render.

If the pass finds a defect needing a design decision rather than a straightforward token fix, the
instruction is to log it here and keep the switch: dark is no worse than it was before this slice
(unreachable), and a half-made design call in a hurry is worse than a recorded gap.

Verified (agent-run automated half only; excludes the human visual pass and PR/CI steps):
typecheck 6/6 projects · core 113/113 · api 269/269 · web 239/239 · `pnpm lint` exit 0 ·
`next build` (`AUTH_DEV_BYPASS=false`) — 13 routes, all `ƒ` · Playwright 29 tests/1 worker, 28
passed, 1 skipped (the known `student-flows.spec.ts:38` gap above, confirmed by name in the run),
0 failed. Full command-by-command detail in
`.superpowers/sdd/2026-08-04-plan-7a-settings-page/task-9-report.md`.

### 2026-07-29 — Plan 3

**Plan 3 merged as PR #6**. Slice 1 needs only Plan 4 (infra,
deploy, observability) to be complete.

**Plan 3 shipped a working web app.** A browser signs in, a real RS256 JWT is minted, `apps/api`
validates it through `createRemoteJWKSet` with its genuine `jose` path, and the real user renders
from `GET /api/v1/me`. Proven end to end by a Playwright suite, not asserted.

**It also shipped a dev auth bypass, and that is the thing to know before touching anything.**
Damian has no Entra admin access, so `AUTH_DEV_BYPASS=true` makes `apps/web` mint tokens with a
local key and publish the matching JWKS. **It swaps the token issuer; it does not skip
authentication** — `apps/api` has no bypass branch. **It must be deleted, not left dormant.** The
cutover is five config steps with no code change beyond them (Plan 3 spec §7, corrected 2026-08-01 to
include setting the three web-side `AUTH_MICROSOFT_ENTRA_ID_*` variables, previously missing from the
list). ADR-0012, and a house rule in `CLAUDE.md`.

**Machine change, 2026-07-29.** Development moved to a second machine. It is fully provisioned and
verified: install → generate → prisma generate → core build → `pnpm typecheck` clean, and
**160 tests / 16 files green against real Postgres** (112 core + 48 api). Docker server 29.6.1,
Postgres on host port **5433** as on machine 1. **The Azure CLI is NOT installed here** — it needs
an elevated MSI install, see `docs/manual-setup-steps.md` §1.2. The hosting topology was settled
this session and is ADR-0009. *(Superseded 2026-07-31: the CLI is now installed and authenticated
on this machine, version 2.88.0 — see `docs/manual-setup-steps.md` §1.2's current text.)*

### Done

**Documentation**
- **Stakeholder interview** — `docs/stakeholder-interview.md`.
- **Deliverable 1 — Interview Record + Problem Statement + PRD + Team Contract** — `docs/interview-and-prd.md`. 33 numbered FRs, 15 NFRs, 12 non-goals, traceability table. Open points now run O-1 to O-16.
- **`docs/design-system.md`** — visual system. Palette verified by script: 35 pairs across light and dark pass WCAG AA, all tokens in sRGB gamut.
- **Twenty-three ADRs** — `docs/adr/0001`–`0023`. Each names at least two rejected alternatives.
  **0010** Auth.js v5 over MSAL — records that `next-auth` is pinned to `5.0.0-beta.32`, a beta,
  because `latest` is `4.24.15`, an *older* major with no App Router support;
  **0011** Microsoft Graph Bicep extension over a committed bootstrap script — supersedes slice-1
  spec §7, and the file moves to Plan 4;
  **0012** the dev auth bypass by issuer swap — **read this one before touching auth.**
  **0007** hand-written tracing plugin over auto-instrumentation (Plan 2B Task 3);
  **0008** Prisma driver adapter (`@prisma/adapter-pg`) over Accelerate (Plan 2B Task 5) —
  Accelerate was rejected partly because student submissions are personal data and it is a
  third-party proxy they would transit, the same concern class as O-5;
  **0009** hosting topology (2026-07-29) — GHCR over ACR, public-with-firewall Postgres over a
  VNet private endpoint, migrations as a Container Apps Job, Southeast Asia, and scale-to-zero
  with the API's replica floor raised only for the k6 run;
  **0018** dashboard aggregates read a whole batch-cycle in one batched pass (five queries) rather
  than the roster's per-student fan-out (forty) — `listDays` now delegates to
  `listDaysForStudents`, so `classifyDay` stays the single classification path (Plan 7 Task 1);
  **0019** dashboard cycles are addressed by engine-computed 1-based sequence, never by a
  materialised `Cycle` row id (a GET must not materialise rows) and never by an arbitrary date
  range (Plan 7 Task 2).
- **`docs/manual-setup-steps.md`** — everything needing a human. **Start here if you are Damian.**

**Code — merged to `main`**

| PR | Plan | What |
|---|---|---|
| #1 | — | Design direction, ADRs 0001–0003, slice 1 spec |
| #2 | 1 · Foundation + cycle engine | `@irp/core`, 112 tests, green under three timezones in CI |
| #3 | 2A · Contract + generation | `spec/openapi.yaml`, `@irp/types`, `@irp/client`, spec-lint and determinism gates |
| #5 | 2B · Service + persistence | Fastify service, Prisma persistence, Azure-AD-shaped auth. FR-5 implemented; FR-3 groundwork only |

A running Fastify service exists: `GET /health` and `GET /api/v1/me`, Azure-AD-shaped JWT auth,
Prisma-backed user lookup with soft delete, RFC 7807 errors carrying a real span's traceId.
**160 tests across 16 files, zero skipped** (`apps/api` 48/9, `@irp/core` 112/7), against real
Postgres, green on all three CI timezone legs.

Plan 2B's whole-branch review found five Important issues, all fixed before merge. Three are worth
knowing because they change how the service behaves: the problem handler now honours Fastify's own
4xx `statusCode` instead of collapsing everything into a 500; `createValidatorCompiler` selects a
**coercing** ajv for querystring/params/headers and a strict one for bodies, so the first
`type: integer` query parameter in Plan 6 will not 400 on every request; and a route-discovery
guard test asserts every `/api/` route sits behind the auth preHandler, because the spec's
document-level `security` default is fail-closed while the implementation is opt-in per route.
The structural fix for that last one — a global fail-closed hook — is **Plan 3's**.

Two seams are deliberate extension points, not accidents of this slice's scope: `buildServer(deps:
ServerDeps)` in `apps/api/src/server.ts` takes config, the user repo, the JWKS key-getter, and the
tracer provider as constructor arguments, so Plan 3 swaps the JWKS source without touching how the
service is composed; and `createTracerProvider(exporter: SpanExporter)` in
`apps/api/src/telemetry.ts` takes only the exporter, with `apps/api/src/index.ts` currently
supplying `new ConsoleSpanExporter()` — Plan 4 replaces that one argument with an App Insights
exporter and nothing else changes.

**What exists now**

```
spec/openapi.yaml        OpenAPI 3.1, 20 operations across 18 paths, lints clean under
                         recommended-strict (two of those operations predate Plan 6, most of
                         the rest predate Plan 7 — only the three dashboard operations are new
                         to this branch)
packages/core/           the cycle/date engine. Builds to dist/. 113 tests
packages/types/          GENERATED, git-ignored, never committed
packages/client/         GENERATED, git-ignored, never committed
apps/api/                Fastify service — config, ajv 2020-12 validator compiler, hand-written
                         tracing plugin, RFC 7807 handler, Prisma + user repo, JWT auth plugin,
                         routes, server composition, entrypoint, and (Plan 7) a dashboard
                         service reading a whole batch-cycle in one batched pass rather than the
                         roster's per-student fan-out (ADR-0018) behind three dashboard routes.
                         262 tests
apps/api/prisma/         schema.prisma (eleven tables, Plan 5's full data model) + committed
                         migrations
apps/api/prisma.config.ts    Prisma 7 CLI datasource config (the schema block cannot hold `url`)
apps/api/src/generated/prisma/   GENERATED, git-ignored — a THIRD generated package
apps/api/docker-compose.yml  local Postgres 16, host port ${IRP_DB_PORT:-5432}
apps/web/                Next.js 16 — Auth.js v5, route groups ((auth) bare, (app) framed),
                         verified design tokens, app frame, CycleRibbon, server-only API client
                         factory, proxy guard, the full Plan 6 flow pages, and (Plan 7) mentor
                         Today (replacing the placeholder) and Cycles, student My month,
                         `lib/ribbon.ts`, and the `FieldLabel`/`Table` primitives. Every sidebar
                         destination — mentor and student — is now a real link. 184 unit tests
apps/web/lib/dev-identity.ts     THE DEV BYPASS. server-only. Mints RS256 tokens with a local
                         key. FOUR entry points need the guard, covered by THREE call sites —
                         the counts differ, which is exactly why "it's the same call" kept
                         being wrong. See CLAUDE.md and ADR-0012 before touching it
apps/web/e2e/            Playwright — signin.spec.ts (the sign-in chain), student-flows.spec.ts
                         and mentor-flows.spec.ts (Plan 6's submission and review screens over
                         the seeded personas), and (Plan 7) dashboard-flows.spec.ts, seven tests
                         over the same seeded personas
packages/client/dist/    GENERATED declarations, git-ignored. Consumers resolve TYPES from here
                         so apps/web keeps full strictness
redocly.yaml             recommended-strict + a custom four-response assertion
eslint.config.mjs        type-aware, generated dirs ignored
.github/workflows/ci.yml 3-timezone matrix + Postgres, generation and tamper gates, next build,
                         Playwright on all three legs (Task 16: the suite gained genuine
                         date/timezone-sensitive assertions, so the earlier UTC-only restriction
                         no longer applies — its own comment said as much), and a dormant
                         real-token job
```

Test totals as of Plan 7 (Task 12), taken from actual runs, not arithmetic on the old figures:
**`@irp/core` 113 · `apps/api` 262 · `apps/web` 184 unit + 22 Playwright.**

**Plan 6 surface, merged as PR #11** (merge commit `c968eae`). The following landed:

- **15 `apps/api` endpoints** across `spec/openapi.yaml`'s Plan 6 paths — entries (`POST
  /api/v1/entries`), the student's own day view (`GET /api/v1/me/days`), absences (`POST
  /api/v1/absences`, `DELETE /api/v1/absences/{date}`), batches + roster (`GET`/`POST
  /api/v1/batches`, `GET /api/v1/batches/{id}/roster`), review transitions and mentor day records
  (`POST /api/v1/daily-reports/{id}/transition`, `/api/v1/students/{id}/day-records[/{date}]`), a
  student's own cycle of days for the mentor (`GET /api/v1/students/{id}/days`), user
  administration (`GET`/`POST /api/v1/users`, `DELETE /api/v1/users/{id}`), and transfer + archive
  (`POST /api/v1/students/{id}/transfer`).
- **Five `apps/web` (app) pages**: UI primitives + sign-out (Task 11), the student Today page with
  its composer and absence toggle (Task 12), the mentor Roster (Task 13), the mentor Review flow —
  attendance/tasks record, forward-only Submitted → In Review → Evaluated transitions, FR-20's lock
  (Task 14), and the mentor Students directory — register, create batch, transfer, archive (Task
  15).
- **`apps/web/e2e/student-flows.spec.ts` and `mentor-flows.spec.ts`** (Task 16), covering both
  roles' Plan 6 screens over the seeded personas from `@irp/fixtures`, alongside the existing
  `signin.spec.ts`. See `apps/web/e2e/README.md` for the persona-to-flow map and the re-seed
  instruction the suite depends on.

**Plan 7 surface, complete on `feat/plan-7-dashboards`, not yet merged** — the PR is not open yet;
§2a's row stays as written above until it lands:

- **Three `apps/api` dashboard endpoints**: `GET /api/v1/batches/{id}/dashboard/today` (FR-28's "N
  of M submitted", late/absent counts), `GET /api/v1/batches/{id}/dashboard/summary?cycle=` (FR-28,
  per-student cycle compliance for the Cycles page), and `GET /api/v1/me/dashboard` (FR-29/FR-30,
  "Month N of 6" plus the current-cycle summary). All three read through the ADR-0018 batched pass
  and address cycles by the ADR-0019 engine-computed sequence, never a `Cycle` row id.
- **Four `apps/web` pages/modules**: mentor Today (`(app)/mentor-today.tsx`, replacing the
  placeholder), mentor Cycles (`(app)/cycles/page.tsx`), student My month (`(app)/my-month/page.tsx`),
  and `lib/ribbon.ts` plus the new `FieldLabel` and `Table`/`Th`/`Td` UI primitives. Every sidebar
  destination, mentor and student, is now a real link — the typography migration (D8) also brought
  every existing page onto the shared primitives, so no page carries page-local `style={{...}}`
  typography.
- **`apps/web/e2e/dashboard-flows.spec.ts`**, seven tests over the same seeded personas.
- **`docs/walkthrough.md`** — a persona-by-persona demo script written from the running app, not
  from the code; doubles as the SC-3 legibility check.

**A real scoring defect surfaced and was fixed during Task 3's review.** `countCycle` had used
`day.status !== "none"` as its obligation test — that test is student-scoped across every batch a
student has ever held, not this batch alone. A student who transferred out of batch A and back
inflated A's `requiredDays`/`settledDays`/`complianceRate` with days actually spent in batch B: one
measured case went 21→16 required days, 17→12 settled, compliance 0.1176→0.1667.
`countCycle` now clips against the student's enrolment interval(s) **in that batch**, not their
whole history. See `apps/api/src/services/dashboard-service.ts`'s docstring on `countCycle`.

**A known gap ships deliberately, and is documented at the site rather than silently left.**
Weekend `extra` is **not** batch-clipped: a weekend entry made while a student was transferred away
counts toward both batches' tallies when their cycle windows overlap. It never reaches a compliance
denominator, so no score is affected, but it does reach the mentor's screen and will later feed the
AI summary's positive context. This is pre-existing and systemic — the roster's
`extraCountThisCycle` has the identical unclipped shape — so `countCycle`'s docstring records that
it must be fixed in both places at once or not at all.

**`pnpm generate` does not rebuild `packages/client/dist`, and neither `pnpm typecheck` nor Vitest
catch it.** The package points `types` at `./dist` but `default` at `./src`, so bundler consumers
(Vitest, `tsc`) see fresh source while only `next build` type-checks against `dist`. Three
spec-changing Plan 7 tasks landed before this surfaced. `pnpm --filter @irp/client build` is
required locally after any spec change — CI is unaffected, since it already runs that build before
`next build`.

### Not started

> **Corrected 2026-08-18.** `infra/` is **no longer** in this list — Plan 4B wrote `main.bicep`,
> `deploy.yml` and the runbook, and the Bicep gate is green in CI (PR #9). It is *written but not
> applied*, which §3 covers. **`tests/load/` is the only genuinely-not-started item here**, and it
> stays blocked on the runbook §1 bootstrap, since k6's NFR-1/NFR-2 targets need a deployed URL.

`infra/`, `tests/load/`. Plan 4 needs the Entra directory below before its Graph Bicep can deploy
from CI — but note the dev bypass means **nothing is blocked on it for building or demoing**.

> **Superseded 2026-07-31/2026-08-01 (Plan 4B Task 10 / whole-branch review).** "The Entra directory
> below" and the table row calling it the project's top blocker are both disproven by this branch:
> `bistecglobal.com` and `bisteccare.lk` are the **same tenant**
> (`d5e769b0-fd19-45e4-a4a8-b73545450234`), `allowedToCreateApps` is `true`, and Entra was deferred a
> fourth time as a **governance** decision about BISTEC's live corporate directory, not a technical
> one — a dedicated directory is not technically necessary. See §3 "Azure and Entra: the real state"
> and the Plan 4B design spec §2 for the evidence. Do not act on the historical text below by
> registering app objects in `d5e769b0` — that is BISTEC's live corporate directory, and doing so
> without the outstanding governance sign-off would not be a cheap mistake.

### Blocked / needs the stakeholder
| # | Item | Blocks |
|---|---|---|
| **—** | ~~**A dedicated Entra directory.**~~ **Superseded — see the callout above.** The Azure *subscription* exists and hosting works; Entra itself is not blocked on a *dedicated* directory — `bistecglobal.com`/`bisteccare.lk` are one tenant and app-registration permissions are sufficient. Kept for record: Damian's work account has no Entra admin access in the (moot) dedicated-directory design; the fallback there was a free tenant from a personal Microsoft account, with a native `admin@<name>.onmicrosoft.com` | **No longer blocks building or demoing** — Plan 3's dev bypass removed that dependency. Still blocks: real Microsoft sign-in, `infra/entra.bicep`, and waking the dormant real-token CI job — now pending the mentor's governance sign-off on registering in BISTEC's live tenant, not a dedicated-directory technicality. `docs/manual-setup-steps.md` §1.1a |
| O-5 | **AI provider + data-processing approval.** Student submissions are personal data leaving the tenant | The whole AI slice (Plan 9, FR-22 to FR-26). Needs an ADR and escalation to leadership |
| O-6 | Exact wording of the five rubric criteria | The evaluation schema and screen |
| O-10 | FR-13 and FR-15 conflict on the Monday grace window | Implemented on the FR-15 reading, marked `// ASSUMPTION: O-10`. Blocks nothing |
| O-11 | Weekends reclassified as optional Extra work — **changes FR-12, adds FR-33** | Implemented. §4.2 reserves FR changes to the mentor, so sign-off is outstanding |
| O-12 | Next.js 16 over the pinned 15 | Impl Lead confirmed 2026-07-28; build proceeds. Mentor notification outstanding |
| O-13 | OpenAPI 3.1 over the brief's 3.0 | Impl Lead accepted the grading risk. Shipped |
| O-1, O-2, O-3, O-4, O-7, O-8, O-9 | Interview metadata; email delivery; tie-break; leadership access; absence penalty; non-goals confirmation; Demo Day date | Assumptions stated; nothing blocked |

Full list with current assumptions: `docs/interview-and-prd.md` §5.

Also outstanding and small: **the Bistec brand hex.** `--primary` is a placeholder indigo. Any replacement must avoid hue 20–70° (reserved for `missed`/`late`) and 140–170° (reserved for `ok`).

---

## 2. Build task list

> ### ⚠️ Ordering superseded, 2026-07-28
>
> **The Phase 1–7 ordering below is no longer the build order.** It has been replaced by the
> slice-based roadmap in §2a. The T-numbers are still live — they remain the index from work
> to FRs, and every plan cites them — but **the phases they sit in no longer describe
> sequence.**
>
> **Why it changed.** Phase 5 put deploy behind eight Phase-4 feature tasks, one of them
> (T-17) blocked on O-5. That parked 25 graded points behind a blocked task and made
> Deliverable 4 unstartable, since k6 needs a deployed URL. Deploy is now pulled into
> slice 1.
>
> Read §2a for order. Read §2b for the FR traceability the T-numbers carry.

### 2a. Slice roadmap — this is the build order

Each slice ships working software. Each plan is one branch and one PR, merged before the next
begins. Plans live in `docs/superpowers/plans/`, specs in `docs/superpowers/specs/`.

| Slice | Plan | Covers | Feeds | Status |
|---|---|---|---|---|
| **1 — Deployed integration skeleton** | 1 · Foundation + cycle engine | T-01, T-03, T-06 | D2 | ✅ **Merged, PR #2** |
| | 2A · Contract + generation | T-08 (thin), T-09 | D2 | ✅ **Merged, PR #3** |
| | 2B · Service + persistence | T-05 (User only), T-10 (thin) | D2 | ✅ **Merged, PR #5** |
| | 3 · Auth + web shell | T-11 | D3 | ✅ **Merged, PR #6** |
| | 4A · Containerisation + runtime hardening | T-21 (partial) | — | ✅ **Merged, PR #8** |
| | 4B · Infra, deploy, observability | T-19, T-20, T-21 (rest), T-22, T-23 | D3 | ✅ **Merged, PR #9.** `infra/entra.bicep` stayed **out of scope** — its fourth deferral, a governance call now that the tenant premise is corrected (see §3) — not a technical blocker |
| **2 — The product** | 5 · Full data model + seed | T-05 (full), T-07 | D2 | ✅ **Merged, PR #10.** Plan: `docs/superpowers/plans/2026-08-02-plan-5-data-model-and-seed.md` · Spec: `docs/superpowers/specs/2026-08-02-slice-2-product-design.md` |
| | 6 · Submission + review flows | T-08 (full), T-12, T-13 | — | ✅ **Merged, PR #11.** Plan: `docs/superpowers/plans/2026-08-02-plan-6-submission-and-review.md` · Spec: `docs/superpowers/specs/2026-08-02-slice-2-product-design.md`. Opened with the repo error contract, the entry-vs-absence race fix, and the transfer-day inclusivity decision deferred from Plan 5's pre-PR pass |
| | 7 · Dashboards | T-14, T-15 | SC-4 | ✅ **Merged, PR #12.** Three dashboard endpoints, mentor Today + Cycles, student My month, the typography migration audit, `dashboard-flows.spec.ts`, and `docs/walkthrough.md`. Plan: `docs/superpowers/plans/2026-08-03-plan-7-dashboards.md` · Spec: `docs/superpowers/specs/2026-08-02-slice-2-product-design.md` |
| | *(UI follow-ups to 7 — no new T-numbers)* | — | — | ✅ **Merged, PRs #13–#17.** Design-system pass (#13); roster legibility + `Batch 1`/`Batch 2` seed rename (#14); the collapsed ribbon key and `workers: 1` (#15, ADR-0020); **7A** Settings page, theme by cookie, verified dark (#16, ADR-0021/0022); **7B** frame and brand — sidebar icons, the logo, Sign out relocated, `Create batch` returned to Students (#17, ADR-0023). 7A and 7B carry their own plan/spec pairs under `docs/superpowers/` |
| | *(developer-environment chore)* | — | — | ✅ **Merged, PR #18.** Web dev server moved 3000 → **3100**; container-internal ports deliberately unchanged. No FR — see CLAUDE.md's **Local ports** rule |
| **3 — Evaluation** | 8 · Notifications | T-16 | — | 🚧 **PR #2 open, not yet merged.** `NotificationService` + Teams webhook + SMTP senders, wired fire-and-forget into entry submission, absence marking, and daily-report transitions; full test suite green. Plan: `docs/superpowers/plans/2026-09-15-plan-8-notifications.md` · Spec: `docs/superpowers/specs/2026-09-11-plan-8-notifications-design.md` · ADRs: 0024 (Teams webhook), 0025 (SMTP via M365) |
| | 9 · AI evaluation | T-17 | — | **Blocked on O-5** |
| | 10 · Winner + PDF | T-18 | — | Not started |
| **4 — Proving it** | 11 · Load test + retro | T-24 – T-26 | D4 | Not started — and cannot start meaningfully until the deploy runbook's §1 bootstrap is run: NFR-1/NFR-2's k6 targets need a deployed URL, and NFR-3 needs the Entra directory this plan deferred a fourth time |

**Plan 4 was split on 2026-07-30.** Everything that needs no Azure account is 4A; everything that
does is 4B. The split does **not** relax the ordering rule below: **slice 1 is not "deployed and
traced" until 4B ships**, and Deliverable 3 stays at zero and Deliverable 4 stays unstartable until
then. What 4A buys is that 4B is Bicep plus a workflow against images already proven to run.
**"4B ships" means the branch merges, not that anything is applied** — see §3 for the distinction
between apply-ready and applied, which matters for anyone tempted to mark Deliverable 3 done from
this table alone.

**The one ordering rule that matters:** slice 1 must be deployed and traced before slice 2
begins. Features land on a pipeline already known to work — never the other way round.

T-02 (ADRs) is continuous, not a task: five are written, more land as decisions arise.
T-04 (per-story docs in `docs/stories/`) is **dropped** — the spec-plus-plan pair in
`docs/superpowers/` serves the same purpose with acceptance criteria attached, and
maintaining both would guarantee drift.

### 2b. T-number reference — traceability only, not sequence

### Phase 1 — Foundations
| # | Task | Covers |
|---|---|---|
| T-01 | pnpm workspace monorepo scaffold: `apps/web`, `apps/api`, `packages/types`, `packages/client`, `spec/`, `infra/`, `tests/load/`, `docs/adr/`, `docs/stories/`. TypeScript strict everywhere | D2 |
| T-02 | ADRs. **Done:** 0001 Tailwind + shadcn/ui · 0002 light-default theming · 0003 cycle ribbon for FR-28. **Remaining:** monorepo tooling; AI provider (**blocked on O-5**). Numbering is chronological by decision — the bootstrap "record architecture decisions" ADR is redundant, `CLAUDE.md` already carries that convention | D2 |
| T-03 | Baseline GitHub Actions workflow: install → lint → typecheck → test → redocly lint. Runs on PR | D2 |
| T-04 | Story breakdown — write `docs/stories/S-0xx-*.md` from the FRs, with acceptance criteria per story | D1/D2 |

### Phase 2 — Data model
| # | Task | Covers |
|---|---|---|
| T-05 | Prisma schema: `User`, `Batch`, `Enrolment`, `Entry`, `DailyReport`, `AbsenceRecord`, `Cycle`, `Evaluation`, `Override`, `Award`. Soft-delete on students | FR-5, FR-6, FR-8 |
| T-06 | Cycle/date engine: 10th→9th boundaries anchored to admission date, Asia/Colombo evaluation, weekday-only arithmetic, grace-window and late determination. **Unit-test this hard — it's the subtlest logic in the system** | FR-9, FR-12, FR-13, FR-14, NFR-12 |
| T-07 | Seed script: 2 batches, 10 students, a month of realistic entries including late and absent days | D2 |

### Phase 3 — API contract (Deliverable 2)
| # | Task | Covers |
|---|---|---|
| T-08 | Hand-write `spec/openapi.yaml`: auth, students, batches, entries, daily reports, absence, review transitions, evaluations, overrides, awards, dashboards. Every endpoint 200/400/401/500; RFC 7807 error body; `additionalProperties: false`; examples on every schema | FR-1..FR-32, NFR-7, NFR-8 |
| T-09 | Wire generation into CI: `openapi-typescript` → `packages/types`, `@hey-api/openapi-ts` → `packages/client`. Fail the build if generated output is stale | D2 |
| T-10 | Fastify handlers typed off the generated `paths`. Strict request validation returning Problem Details | FR-1..FR-21 |

### Phase 4 — Application
| # | Task | Covers |
|---|---|---|
| T-11 | Azure AD SSO on both apps; Admin/Student role gating; no local passwords | FR-1..FR-4, NFR-14 |
| T-12 | Student daily submission flow: text-only, multiple entries/day, current-or-previous-weekday only, absence marking. Under 2 min to submit | FR-10..FR-17, NFR-9 |
| T-13 | Mentor review flow: Submitted → In Review → Evaluated, mentor's own attendance/task record, lock on Evaluated. **No reject state** | FR-18..FR-20 |
| T-14 | Mentor dashboard — performance summary + "N of M submitted today" + late/absent counts, no scrolling. **Ship this first; it is the stakeholder's must-have** | FR-28, SC-4 |
| T-15 | Student dashboard — own history, "Month N of 6", strengths-and-weaknesses summary. No score, no rank, no other students | FR-29, FR-30 |
| T-16 | Teams + email notifications on submission and state change | FR-21 |
| T-17 | AI monthly evaluation: summary generation, fixed-rubric scoring (20/25/25/10/20), mentor override with reason, no summary editing, no mid-cycle evaluation. Persist model version + score. **Blocked on O-5** | FR-22..FR-27, NFR-15 |
| T-18 | Winner computation + downloadable PDF with AI justification | FR-31, FR-32 |

### Phase 5 — Deploy & observability (Deliverable 3)
| # | Task | Covers |
|---|---|---|
| T-19 | `infra/main.bicep` — Container Apps, Postgres 16, App Insights, Azure AD app registration. No portal clicks | D3 |
| T-20 | Deploy workflow to Azure Container Apps on merge to `main`, under 8 min | D3, NFR-5 |
| T-21 | OpenTelemetry → App Insights, every route traced, visible within 60 s | D3, NFR-6 |
| T-22 | Tested rollback path to the previous revision, with exact commands | D3 |
| T-23 | `deploy-runbook.md` — infrastructure, pipeline, auth, observability, rollback | D3 |

### Phase 6 — Load test & retro (Deliverable 4)
| # | Task | Covers |
|---|---|---|
| T-24 | k6 scripts in `tests/load/`: sustained 50 RPS, 200 RPS burst, auth-gated 10 RPS × 5 min, 30 min idle memory watch | D4, NFR-1..NFR-4 |
| T-25 | Run them, capture results, analyse the slowest endpoint citing App Insights traces | D4 |
| T-26 | `retro-and-load.md` — start/stop/continue (≥3 each), velocity vs estimate, honest notes on solo multi-agent orchestration, results table, bottlenecks, follow-ups with owners and dates | D4 |

### Phase 7 — Post-demo (before Month 3)
Fix every P1/P2 from the stakeholder demo · Dependabot + weekly patch rotation · postmortem for the worst sprint day · convert one endpoint to typed-SDK-only · pin an App Insights dashboard in the README · pair-review two other teams' OpenAPI specs.

---

## 3. Current position

**Everything through Plan 7B is merged. `main` is at PR #18 (`5e99498`, 2026-08-18).** Plan 8
(Notifications) is implemented on branch `feat/plan-8-notifications` (2026-09-15) and open as
**PR #2**, awaiting review and merge — see the row in §2a and the "next action" note below.

Plan 7 itself merged as **PR #12** (three dashboard endpoints — `GET
/api/v1/batches/{id}/dashboard/today`, `GET /api/v1/batches/{id}/dashboard/summary`, `GET
/api/v1/me/dashboard` — mentor Today and Cycles, student My month, the typography migration audit,
`dashboard-flows.spec.ts`, and `docs/walkthrough.md`; Task 3's review also fixed a real scoring
defect in `countCycle`). Six further PRs landed on top of it, none adding a T-number: **#13**
design-system pass · **#14** roster legibility and the `Batch 1`/`Batch 2` seed rename · **#15** the
collapsed ribbon key and `workers: 1` · **#16** Plan 7A, the Settings page and theme-by-cookie ·
**#17** Plan 7B, the frame and brand · **#18** the dev-server port move to 3100. See §2a for what
each covers.

**The next action is reviewing and merging Plan 8's PR #2** — the branch is implemented and its
full test suite is green. After that, slice 3's remaining two plans are either not started
(10, and it depends on Plan 9's scores) or blocked (9, on O-5). The two things that would unblock
the most beyond Plan 8 are both outside the code: running the deploy runbook's §1 bootstrap
(Deliverable 3 is still apply-ready, not applied — see below) and getting a decision on **O-5**, the
AI provider, which gates Plan 9 and touches personal data. Neither is something the next session can
simply pick up and start writing.

**Housekeeping owed before the next plan starts:** archive `.superpowers/sdd/` into
`.superpowers/sdd/plan-7b/` and reset `progress.md`, per CLAUDE.md. The directory is git-ignored,
so nothing recovers it once the next plan overwrites the fixed filenames — this is exactly how
Plan 1's ledger was lost.

Everything below this paragraph, up to and including the "Azure and Entra" material, predates
Plans 5, 6 and 7 and describes Plan 4B's state at merge; read it as history, not current status.

**Slice 2 ("The product") now contains everything it was ever scoped to cover, and nothing more.**
Plan 5 built the full data model and seed; Plan 6 shipped submission and review (merged, PR #11);
Plan 7 shipped both dashboards (PR #12), and PRs #13–#17 refined that UI without widening scope. What slice 2 does **not** contain, by the spec's own
D2/D3 decisions: no AI evaluation (Plan 9, blocked on O-5), no notifications (Plan 8), no winner
computation or PDF (Plan 10). The `Evaluation`/`Override`/`Award` tables exist as schema only —
zero rows in the seed — and the student My month page renders the designed empty state ("No
evaluation yet — your first summary appears after your cycle closes") rather than any fabricated
score. There is still no reject state, no configurable rubric, and no student-visible score or
rank; nothing in Plan 7 touches those non-goals.

**Deliverable 3's status is unchanged by everything since Plan 4B — still apply-ready, not
applied.** Plan 7 and its follow-ups touched only `apps/api` and `apps/web`. PR #18 is the one
exception and it is not a real one: it edited `infra/main.bicep`, `Dockerfile` and `compose.yaml`
to add **comments** explaining why the container-internal port stays 3000 while the developer-facing
port moved to 3100, and changed no deployed value — `targetPort` is still 3000, as it must be to
equal the image's `PORT`. The apply-ready-versus-applied distinction the Plan 4B paragraph below
establishes — the Bicep gate being green and the files existing is not the same as the resource
providers being registered or anything actually running in Azure — still holds verbatim. Do not
infer from "dashboards shipped" that anything is deployed.

> **Historical as of 2026-08-18 — the line below described the position while Plan 4B was still on
> its branch.** Plan 4B has since merged as PR #9, and nine further PRs have landed on top of it.
> Current position is the top of this section. **What has *not* changed is the apply-ready-versus-
> applied distinction the next paragraph draws** — that is still live and still the reason
> Deliverable 3 is incomplete.

**Branch:** `feat/plan-4b-infra-deploy-observability` · **Last merged:** Plan 4A as **PR #8**
(merge commit `720b387`, 2026-07-30) · **Plan 4B: all ten tasks complete, apply-ready, not yet
applied** — see below.

**Plan 4B shipped apply-ready, and that distinction matters.** `infra/main.bicep`, `deploy.yml` and
`docs/deploy-runbook.md` all exist and the Bicep gate is green in CI, but **nothing has been
applied**: the four resource providers are still `NotRegistered` and no Azure credential exists in
GitHub. So **Deliverable 3 is not complete until Damian works through the runbook's §1**, and NFR-5,
NFR-6 and the T-22 rollback are written procedures with unfilled `[ ] MEASURE` markers rather than
results. Nothing in this plan claims otherwise — do not report D3 as done on the strength of the
files existing.

**Three premises that earlier handoffs stated as fact are false**, and two were load-bearing:
the Azure CLI is installed and authenticated; Graph reads work; and `bistecglobal.com` and
`bisteccare.lk` are **one tenant**, not two. The last one falsifies ADR-0011's premise — a
single-tenant app registration would let real mentors and students sign in, satisfying FR-1 properly.
Entra was deferred a fourth time as a **governance** call about BISTEC's live corporate directory,
not a technical one. Plan 4B design spec §2 carries the evidence.

> **Plan 4B is the first plan that the dev bypass does NOT route around — for deployment, not for
> Entra.** Plans 3 and 4A both shipped without any Azure or Entra setup. This one needed the Azure
> subscription and the four Azure resource providers (`docs/manual-setup-steps.md` §1.2a) to deploy
> at all, but **not** a dedicated Entra directory — that premise was false (above). Register the four
> providers before running the runbook's apply, or Bicep fails confusingly rather than cleanly.

**Plan 4A's whole-branch review found four things, all fixed before the merge.** Two were gates that
did not gate (the coin-flip Playwright budget, and the unbounded CI jobs) and two were false
statements sitting in comments: `instrumentation.ts` claiming Next builds no Edge instrumentation bundle, and
`app/api/dev-jwks/route.ts` describing the bypass guard's trigger **inverted** ("with the bypass
flag off" — it fires when the flag is *on* in production). Everything else reviewed clean:
`shutdown.ts`, `bootstrap.ts`, `exporter.ts`, `proxy.ts`, the `Dockerfile` build graph,
`compose.yaml`, the `schema.prisma` `importFileExtension` pin, ADRs 0013/0014, and the
`@azure/monitor-opentelemetry-exporter` pin (which is correctly recorded in `CLAUDE.md` with its
prerelease-semver trap).

**Known doc debt, deliberately not touched:** `docs/adr/0012` and the Plan 3 plan/spec still say the
bypass has **three** entry points. ADRs are dated records superseded by later ones rather than
edited in place, and `CLAUDE.md` now carries the live four-entry-point list. If that convention is
wrong here, ADR-0012 wants a superseded-by pointer.

**On the SDD ledger.** `.superpowers/sdd/progress.md` is **git-ignored, so it does not travel with
a clone or a push.** Earlier notes called it "the authoritative resume map" — that is only true on
the machine that wrote it. It was **not present** when this branch was resumed on a second device,
so the resume had to be reconstructed from the plan file and `git log`. Treat this section, the
plan file, and the commit history as the durable record; treat the ledger as a local convenience
that may simply be absent.

### Plan 4A — where it stands

Plan 4 was split into 4A (containerisation) and 4B (deploy). All ten tasks are complete. The repo
has a single `Dockerfile` build graph with four targets (`migrate`, `api`, `web`, plus shared
stages), a root `compose.yaml` running `db → migrate → api → web`, and an `images` job in CI that
builds all three images and smoke-tests the stack.

**Task 9's re-review ran on resume (2026-07-30) and found one residual item, now fixed.**
CORRECTION 4's three fixes were all correctly implemented, but its finding 1 was stated more
broadly than it was closed: it named a missing job-level `timeout-minutes` and fixed only the one
`docker run` command. No job in the workflow had a timeout, so any hang outside that single
command still burned GitHub's 360-minute default and never reached its `if: always()` teardown —
and `docker compose up --wait` is such a hang, because `migrate` has no healthcheck and `api`
gates on `service_completed_successfully`. All three jobs now carry `timeout-minutes`. Recorded as
CORRECTION 5 in the plan.

Three facts from 4A worth knowing before touching anything:

- **CI runs on `pull_request` and pushes to `main` only.** A bare push to a feature branch
  triggers **nothing** — PR #8 exists because that had to be discovered the hard way.
- **The dev-bypass guard has a fourth entry point**, `apps/web/instrumentation.ts`. A
  containerised `next start` does not import route modules at boot, so the module-scope guard in
  `auth.config.ts` fired only on the first request and the container stayed up serving 500s
  rather than refusing to start.
- **The Playwright sign-in test was a coin flip, not a passing gate.** Its first assertion had to
  absorb two cold Turbopack compiles (~4.9s) inside Playwright's default 5000ms `expect` budget,
  so it passed by ~0.3s on one run and failed by ~0.4s on the next — the failing one being a
  **docs-only commit**. `playwright.config.ts` now sets `expect: { timeout: 20_000 }` and
  `timeout: 60_000`, with the measurements recorded there. The suite must run against `next dev`
  (the bypass cannot exist in a production build), so on-demand compilation is inherent and has
  to be budgeted for rather than tuned away.

### What Plan 3 cost, and the one lesson worth carrying

Fourteen tasks, 35 commits, twelve fix passes. **Every defect the reviews found originated in the
plan, not in an implementation.** The two most serious were a design-system colour set I asserted
was "verified" without having read §3.3, and a `DayMark` union that conflated status with "is
today" so that today-with-zero-submissions would have rendered as solid full green to a mentor.

Three claims about the dev bypass's guard coverage turned out to be false in sequence — the guard
called only from `auth.ts`; "excluded from the production bundle"; and coverage being exhaustive
"because it is the same call". The third was found by the whole-branch review serving a live JWKS
with 200 from `/api/dev-jwks` in a real production build. **The lesson: coverage claims about that
bypass need checking, not trusting**, which is why `CLAUDE.md` now states it as a rule — any new
module importing `lib/dev-identity` directly must call the guard itself.

Sixty unit tests passed while the end-to-end chain was broken four independent ways. That is the
argument for `apps/web/e2e/` existing, and for `next build` being a required gate — plain `tsc`
misses `typedRoutes` and middleware export-shape errors, and one of those broke the production
build for four tasks unnoticed.

> **Correction, 2026-07-29 (Plan 3 Task 14): the claim below is wrong.** The installed
> `scripts/sdd-workspace` **ignores its argument** and returns the flat `.superpowers/sdd/` path
> regardless of which plan file is passed. It does **not** resolve a per-plan workspace, so
> **`CLAUDE.md`'s manual-archiving convention still applies** — move everything except
> `progress.md` and `.gitignore` into `.superpowers/sdd/plan-<N>/` before the first task of a new
> plan. The paragraph immediately below is kept for context but describes intended, not actual,
> behaviour of the installed script version.
>
> **Ledger path convention changed.** The `subagent-driven-development` skill now resolves a
> **per-plan** workspace via `scripts/sdd-workspace <plan-file>` — `.superpowers/sdd/<plan-basename>/`
> — so plans no longer overwrite each other's records and the old manual archiving step is
> obsolete. The flat `.superpowers/sdd/progress.md` path referenced by older notes is dead.
>
> **Second correction, 2026-08-01 (Plan 4B Task 10): the first correction above is now itself wrong.**
> The installed `scripts/sdd-workspace` **does** resolve a per-plan path on this machine — it returned
> `.superpowers/sdd/2026-07-31-plan-4b-infra-deploy-observability/` for this plan, not the flat
> `.superpowers/sdd/` path the 2026-07-29 note describes. Whether that was a script version
> difference between machines or a mistaken read at the time is not established; what matters is
> that the manual-archiving convention is **not** needed on this installation. Related, and still
> true regardless of which behaviour is current: the ledger directory is git-ignored and travels with
> **no** clone or push, so it must never be relied on as a resume map — see the "Plan 3 is merged"
> paragraph below, which recorded exactly that for both Plan 3 and Plan 4A.

**Plan 3 is merged (PR #6).** An earlier note here said its SDD ledger was "kept" at
`.superpowers/sdd/progress.md` as the only record of what the review loop caught, and told the next
session to archive it into `.superpowers/sdd/plan-3/`. **Both instructions are now dead.** The
directory is git-ignored, so on the machine that resumed Plan 4A it contained nothing but
`.gitignore` — no Plan 3 ledger, no Plan 4A ledger, nothing to archive. **Do not plan around the
ledger surviving.** If a record needs to outlive the machine that made it, it goes in the plan
file, this file, or a commit message.

### Plan 4's inherited obligations — three closed in 4A, one carried to 4B

1. **`infra/entra.bicep`** — **still open, now 4B's.** Moved here from Plan 3 (ADR-0011); deferred
   again in 4A because it cannot be applied without the Entra directory. **This is its third
   deferral** — treat it as owed, not optional.
2. ~~**A `SIGTERM`/`SIGINT` handler in `apps/api`**~~ — **closed in 4A.**
   `apps/api/src/shutdown.ts` drains via `app.close()`, disconnects Prisma, and force-exits
   non-zero if the drain overruns, rather than being `SIGKILL`ed. Proven by `docker compose stop`
   returning exit code 0 in CI.
3. ~~**The `middleware.ts` → `proxy.ts` migration, with an ADR**~~ — **closed in 4A.** ADR-0013.
   The guard now runs on Node, not the Edge, and `apps/web/middleware.ts` no longer exists.
4. ~~**`index.ts` only `$disconnect()`s Prisma inside the `catch` around `app.listen`**~~ —
   **closed in 4A** by `apps/api/src/bootstrap.ts`.

Plus four Minors the whole-branch review triaged as safe to carry: a gratuitous
`{ extractable: true }` in `apps/api/test/auth-jwks-failure.test.ts`; `devKeyPairForTest` exporting
a `CryptoKeyPair` from production source; no unit test that `app/(app)/page.tsx` sources role from
the API rather than `auth()` (covered in substance by Playwright, since `DEV_IDENTITIES` carries no
role); and `packages/client/dist` deliberately outside the determinism checksum, documented with
the trigger that would change that answer.

### Azure and Entra: the real state

> **CORRECTED 2026-07-31/2026-08-01 (Plan 4B Task 10). Fact 1 below and two table rows are false —
> read this before the historical record that follows.**
>
> `bistecglobal.com` and `bisteccare.lk` are **the same tenant**, `d5e769b0-fd19-45e4-a4a8-b73545450234`
> (*BISTEC Global*) — both are verified domains on it, alongside about twenty others, verified with
> `az rest` against `/v1.0/domains`. So "the users are not in `bisteccare.lk`" (fact 1 below) is
> false: the subscription and the users are in **one** directory, and a single-tenant app
> registration there would let real mentors and students sign in, properly satisfying FR-1. Graph
> reads also work now — four consecutive calls succeeded on 2026-07-31, against the "blocked by
> conditional access" row below — and `allowedToCreateApps` is `true`, so no admin role is needed to
> create the registration. The Azure CLI row is also outdated: it is installed and authenticated,
> not merely "installed on machine 1" as machine-specific notes elsewhere once implied.
>
> **The dedicated Entra directory this section's "Decision" recommends is therefore not technically
> necessary.** What remains is a *governance* question — `d5e769b0` is BISTEC's live corporate
> directory — and that is why Entra was deferred a fourth time in Plan 4B rather than done. See the
> Plan 4B design spec §2 for the evidence and `docs/manual-setup-steps.md` §1.1a for the same
> correction in context. Everything below is kept as the historical reasoning that led to the
> now-superseded decision; do not act on fact 1 or the "Decision" paragraph without reading this note
> first.

Verified on 2026-07-28. **The old "no Azure account, `az` not installed" note was wrong in both
directions** — correcting it is why this section exists.

| Thing | State |
|---|---|
| Azure CLI | Installed, **2.88.0** |
| Subscription | **`Azure subscription 1`**, `7bb869f8-053c-4c2d-b444-1bf079bfcef7`, Enabled |
| Tenant | `d5e769b0-fd19-45e4-a4a8-b73545450234` — **`bisteccare.lk`**, signed in as `Damian@bisteccare.lk` |
| Hosting (ARM) | ✅ Works — `az group list` exits 0 |
| Resource providers | ❌ **All `NotRegistered`** — `Microsoft.App`, `Microsoft.DBforPostgreSQL`, `Microsoft.Insights`, `Microsoft.OperationalInsights`, `Microsoft.ContainerRegistry`. Register before Plan 4 or Bicep fails confusingly |
| Entra / Graph | ❌ **Blocked by conditional access**, as of 2026-07-28. *(Superseded 2026-07-31 — see the callout above: four consecutive Graph calls succeeded. Treat Graph as working but not proven reliable.)* |
| Permissions in `bisteccare.lk` | **Unknown**, as of 2026-07-28. *(Superseded 2026-07-31 — `allowedToCreateApps` is `true`, so a standard user can create app registrations; no elevated role is needed.)* |

**Two facts that together decide the auth design — fact 1 is now known false, see the callout above:**

1. ~~**The users are not in `bisteccare.lk`.**~~ Students and mentors hold `bistecglobal.com`
   accounts, and Damian has no account there. An app registration is scoped to one directory, so a
   single-tenant app in `bisteccare.lk` would let nobody but Damian sign in. **False as of
   2026-07-31: `bistecglobal.com` and `bisteccare.lk` are the same tenant, so the users ARE in
   `bisteccare.lk`.**
2. **CI cannot re-authenticate interactively.** Even if the registrations can be created by hand in
   `bisteccare.lk`, Plan 4 deploys Graph Bicep from GitHub Actions. Whether a conditional-access
   policy targeting users also catches a workload identity depends on separately-licensed
   configuration — unverified, and Plan 4 is the expensive place to find out. Moot for Plan 4B: the
   deploy service principal in the runbook authenticates to ARM, not Graph, and needs no Graph access
   at all, since `infra/entra.bicep` stayed out of scope.

**Decision (historical — see the correction above): a dedicated Entra directory**, created by Damian, where he is Global Administrator.
The Azure subscription stays in `bisteccare.lk` — hosting is demonstrably unaffected. Use a
**native cloud-only** `admin@<name>.onmicrosoft.com` account for all CLI and Bicep work, not the
external `Damian@bisteccare.lk` identity the new tenant grants Global Admin to on creation.

**Do not substitute a personal Microsoft account.** Microsoft's Graph Bicep docs state that
*"permissions for personal Microsoft accounts cannot be used to deploy Microsoft Graph resources
declared in Bicep files"* — an MSA would silently invalidate the Bicep-for-Entra decision below.

**FR-1 remains partially satisfied**, exactly as slice-1 spec §6 "Known gap" already records: auth
is generic OIDC, so pointing at a real Bistec training tenant later is an issuer and
app-registration swap, not a rewrite. `manual-setup-steps.md` §3 carries the standing mentor ask.

### Plan 3 design decisions — settled in the brainstorm, do not re-litigate

The brainstorm is **partly complete**: Section 1 (architecture and data flow) is approved.
Sections 2 and 3 have not been presented, and no spec file exists yet.

| # | Decision | Why |
|---|---|---|
| 1 | **Thin vertical slice.** `apps/web` scaffold, Auth.js sign-in/out, one authenticated page calling `GET /api/v1/me` through `@irp/client` and rendering the real user, design-system tokens and app frame. **No product screens** | Proves the whole chain end to end and keeps Plan 4 close behind, honouring "deployed and traced before slice 2" |
| 2 | **Auth.js v5** with the Microsoft Entra provider | Slice-1 §6 named it as expected and reserved the call to the Impl Lead, who confirmed it. MSAL rejected: no Next.js integration, so session storage, callback routes and middleware would all be hand-built in a plan meant to be thin |
| 3 | **The access token never reaches the browser.** Session is an encrypted HTTP-only cookie; the token is pulled server-side and attached by `@irp/client` | Makes `CLAUDE.md`'s "no hand-written fetch in the frontend" structural rather than a matter of discipline — the browser has no token to fetch with |
| 4 | **Entra registrations in Bicep** — `infra/entra.bicep`, `Microsoft.Graph/applications@v1.0`, landing in **Plan 3**, not Plan 4 | Verified GA and sufficient: supports `api.oauth2PermissionScopes`, `appRoles` with `allowedMemberTypes`, `web`/`spa.redirectUris`, `identifierUris`, `requiredResourceAccess`, `requestedAccessTokenVersion`. `uniqueName` is required and is the idempotency key. Keeps `CLAUDE.md`'s no-checked-in-scripts rule intact with **no exception needed**. Plan 3 cannot work without the registrations, so the thing that creates them belongs here |
| 5 | **Testing: hermetic suite + one secrets-gated real-token CI job** | All existing tests stay offline via the `getKey` injection seam. One job acquires a real Entra token through the **k6 service principal** and calls `/api/v1/me`. That principal is required by Deliverable 4 anyway (NFR-3, "10 RPS for 5 min, zero token failures" — the reason slice-1 §6 rejected Easy Auth), so it is D4's prerequisite built early, not extra scaffolding |
| 6 | **The secrets-gated job must hard-fail, never skip**, when secrets are expected but absent | A conditionally-skipped job is the exact false-green shape this repo has been bitten by twice — `describe.skipIf` and the porcelain gate. Apply the `apps/api/test/helpers/require-db.ts` pattern |
| 7 | **First users: a documented one-off insert**, recorded in the runbook | The API returns 403 for a valid token with no `User` row (spec §7, deliberate; FR-3 is not built). Rejected: a throwaway seed script, because **Plan 5 owns seeding (T-07)** and a second one would drift; and auto-provisioning on first sign-in, because that silently contradicts §7's "rejected, not provisioned" security posture |

**Constraints carried into the spec:**

- **Bicep cannot emit a client secret** — `passwordCredentials.secretText` is read-only. Auth.js
  needs one for the confidential-client code flow, so `infra/entra.bicep` creates the
  registrations and the secret is minted once with `az ad app credential reset`, landing in
  `.env.local` and a GitHub Actions secret. That step and the **admin-consent portal click** are
  Microsoft safeguards, not gaps in our automation — both belong in the runbook.
- **Graph replication lag can fail a first deploy** — service principal IDs may not have
  propagated when dependent resources deploy.
- **Assigning an app role needs elevated consent**, with no narrower permission available. Affects
  giving the k6 service principal its role.
- **Two ADRs are owed** before or with the implementation, per `CLAUDE.md`'s two-rejected-
  alternatives rule: **Auth.js v5 over MSAL**, and **Bicep Graph extension over a committed
  bootstrap script or portal clicks**.

**Mandatory fix, not optional, and it belongs in this plan:** `apps/api/src/plugins/auth.ts`'s
`catch` around `jwtVerify` is unconditional and swallows key-getter errors too. Inert with a local
key set; with `createRemoteJWKSet` a JWKS-endpoint outage would tell every user *"your token is
invalid"* (401) while the real fault is a 5xx. Plan 2B logged it as a Plan 3 obligation precisely
because this is the plan that makes it real.

### Starting a fresh session

1. Read `CLAUDE.md` — especially its **hard-won facts** list and the **dev auth bypass** house rule
   — then this file. **§3's "Azure and Entra: the real state" and Plan 4's inherited obligations are
   the resume map.** Then **`docs/adr/0012-dev-auth-bypass-by-issuer-swap.md`**, which is the single
   most important document for anyone touching auth, and
   `docs/superpowers/specs/2026-07-29-plan-3-auth-and-web-shell-design.md` §7 for the Entra cutover.
2. Bring the clone up. **`ONBOARDING.md` is the step-by-step version of this** — env files, the
   Postgres container, the seed, the dev identity picker, and a troubleshooting table keyed by the
   exact error text. Use it; this step is the compressed form.

   **`prisma generate` needs `DATABASE_URL` in the shell environment first** —
   Prisma 7 dropped implicit `.env` loading, and `prisma.config.ts` resolves `env("DATABASE_URL")`
   from the real process env, so a bare `prisma generate` fails `PrismaConfigEnvError` on a fresh
   clone. The value only has to *parse*; `generate` never connects.

   **Run every step below on a *returning* clone too, not just a fresh one.** There are **five**
   git-ignored generated trees — `packages/types`, `packages/client`, `packages/core/dist`,
   `apps/api/src/generated/prisma`, and `apps/web/.next/types` — so they all survive a `git pull` at
   whatever version they were last built from, and nothing invalidates them. `pnpm install`
   succeeds and `pnpm dev` starts; the staleness surfaces as four failures that all read as broken
   application code:

   | Symptom | Actually stale | Fix |
   |---|---|---|
   | `apps/api` exits at boot on `SyntaxError: The requested module '@irp/core' does not provide an export named …` | `packages/core/dist` | `pnpm --filter @irp/core build` |
   | Turbopack **Build Error** in the browser: `Export … doesn't exist in target module … packages/client/src/index.ts` | `packages/client/src` (generated from an older `spec/openapi.yaml`) | `pnpm generate`, then `pnpm --filter @irp/client build` |
   | Seed dies on `TypeError: Cannot read properties of undefined (reading 'deleteMany')` | `apps/api/src/generated/prisma` — the undefined value is a model a newer migration added | `pnpm --filter @irp/api exec prisma generate` |
   | `pnpm typecheck` fails in `apps/web` with `TS2322: Type '"/roster"' is not assignable to type 'Route'` (nine of them) on code that runs correctly | `apps/web/.next/types/routes.d.ts` | `pnpm --filter @irp/web build` (see below) |

   All four were hit in one sitting on 2026-08-04 bringing an existing clone up after Plan 7 — each
   one only at the point the process that needed it actually ran, which is why they arrive one at a
   time rather than all at once.

   **The fourth row is the nastiest and is new**, because it is the only one that fails *closed* in
   the wrong direction — a green gate going red against correct code, rather than a broken thing
   erroring. `apps/web/tsconfig.json` includes `.next/types/**/*.ts`, and `typedRoutes` writes the
   route union to `.next/types/routes.d.ts` from **`next build`**. `next dev` writes a *different*
   copy at `.next/dev/types/routes.d.ts` that `tsconfig` does not include. The Aug-1 build-time copy
   still listed only `"/" | "/not-registered" | "/signin"`; every Plan 6/7 route was missing from it.
   `pnpm --filter @irp/web build` fixed all nine errors with **zero source changes**. Visiting the
   pages in `next dev` does not help — that only refreshes the copy `tsc` never reads. Recorded in
   `CLAUDE.md`'s hard-won-facts list; **never resolve one of these errors with a cast**.

   ```powershell
   pnpm install
   pnpm generate
   Copy-Item apps/api/.env.example apps/api/.env      # git-ignored
   $env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
   pnpm --filter @irp/api exec prisma generate         # third generated package
   pnpm --filter @irp/core build
   pnpm --filter @irp/client build                     # declaration-only emit; apps/web
                                                       # resolves TYPES from dist/ so it can
                                                       # stay fully strict. REQUIRED before
                                                       # typecheck on a fresh clone
   pnpm typecheck                                      # clean, 5 projects
   ```

   To run the database-backed tests as well:

   ```powershell
   $env:IRP_DB_PORT = "5433"
   docker compose -f apps/api/docker-compose.yml up -d
   pnpm --filter @irp/api exec prisma migrate deploy
   pnpm test        # @irp/core 112 · apps/api 59 · apps/web 63, zero skipped
   ```

   To run the Playwright suite, copy `apps/web/.env.example` to `.env.local`, set
   `AUTH_DEV_BYPASS=true`, point `apps/api/.env`'s `JWKS_URI`/`JWT_ISSUER` at
   `http://localhost:3100/api/dev-jwks`, then **seed the dev users** — `apps/web/e2e/README.md` has
   the exact SQL. The API suites `TRUNCATE` the `User` table, so re-seed after running them.

   ```powershell
   pnpm --filter @irp/web exec playwright install chromium
   Set-Location apps/web; pnpm exec playwright test    # 5 specs
   ```

   **`pnpm --filter @irp/web build` needs `AUTH_DEV_BYPASS=false`** locally, because `.env.local`
   supplies the flag and `next build` sets `NODE_ENV=production`, so the guard correctly refuses.
   A local build succeeding with the flag **true** means guard one has broken — investigate at once.
3. **Plan 3 is merged.** Next is Plan 4: `brainstorming` → spec → `writing-plans` →
   `subagent-driven-development`. Its four inherited obligations are listed in §3 and none are
   optional. Read `.superpowers/sdd/progress.md` first — it is Plan 3's execution record and
   explains why several decisions changed mid-plan.
4. **The dev bypass is live and must be deleted, not left dormant.** Its guard covers **three**
   entry points and coverage is per-entry-point, not automatic: any new module importing
   `apps/web/lib/dev-identity.ts` directly must call `assertBypassNotInProduction` itself. Three
   successive claims that coverage was complete turned out to be false during Plan 3 — treat any
   such claim as needing a check.
5. **Waiting on Damian**, none of it blocking: the Entra directory (§3, and his work account has no
   Entra admin access); an elevated `winget install -e --id Microsoft.AzureCLI` on machine 2;
   registering the four Azure resource providers; whether the GHCR packages are public or private
   (`docs/manual-setup-steps.md` §1.5); and the batched mentor message in §3 of that file — O-10,
   O-11 and O-12 still need sign-off, and O-12 (Next.js 16) is now well past free reversal.
6. **Correction, updated 2026-08-01:** the 2026-07-29 note here said `scripts/sdd-workspace` ignores
   its argument and always returns the flat `.superpowers/sdd/` path. That is now known to be wrong
   on this installation — it resolved `.superpowers/sdd/2026-07-31-plan-4b-infra-deploy-observability/`
   for Plan 4B. Do not assume either behaviour without checking; whichever it is, the ledger itself
   is **git-ignored and does not travel with a clone or a push** — it must never be treated as an
   authoritative resume map. If the per-plan path is not resolving, fall back to `CLAUDE.md`'s manual
   archiving convention: move everything except `progress.md` and `.gitignore` into
   `.superpowers/sdd/plan-<N>/` before the first task of a new plan, then reset `progress.md`.

### Local environment facts that cost real debugging time

Verified on the development machine on 2026-07-28. These are environment-specific, not
repository rules, but rediscovering them is expensive.

| Fact | Consequence |
|---|---|
| **The Bash tool is network-sandboxed** — it cannot open a TCP connection to a localhost port | Every database command must run through **PowerShell**. Prisma fails `P1001: Can't reach database server` from Bash even with a healthy container and a port provably open from the host. This looks exactly like a broken database and is not |
| **`localhost` resolves to `::1`** | Use `127.0.0.1` in connection strings |
| **Host port 5432 is held by an unrelated project's container** (`designer-postgres-1`) | `apps/api/docker-compose.yml` parameterises the host port as `${IRP_DB_PORT:-5432}`; local runs use **5433**. CI is unaffected — a GitHub runner's service container binds 5432 with nothing to conflict. **Do not "fix" the workflow to 5433** |
| Local connection string | `postgresql://irp:irp@127.0.0.1:5433/irp?schema=public` |
| `docker info` hung past 120s once, mid-session | Probe with `docker version --format '{{.Server.Version}}'` under a timeout instead |
| **Docker Desktop is a per-user install**, at `$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe` | Not `C:\Program Files\Docker\Docker\Docker Desktop.exe` — that path does not exist on this machine. `docker.exe` still resolves (`…\Programs\DockerDesktop\resources\bin`), so the CLI works and only the *engine* is missing: the tell is `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`. Start the app, then poll `docker version` until it answers — the engine was ready within 5s of launch on 2026-08-04, but do not assume it |

### Hard-won constraints discovered *during* Plan 2B

New, and all of them cost a round trip or a corrected plan. Formal doc/spec reconciliation is
**Task 10's** job — this table is the raw record so nothing is lost first.

| Constraint | Why it matters |
|---|---|
| **Prisma 7 removed `url` from the schema's `datasource` block** | `prisma validate`/`migrate`/`generate` all fail `P1012` before touching a database. The URL now lives in `apps/api/prisma.config.ts` via `defineConfig`/`env` from `prisma/config`. The `datasource` block carries `provider` only |
| **Prisma 7 removed `datasourceUrl` from `PrismaClientOptions`** | It is now a union of `{ adapter }` \| `{ accelerateUrl }` — a **driver adapter is required** for a direct connection. We use `@prisma/adapter-pg` (**ADR-0008**), which brings `pg` and `@types/pg` as its own dependencies, so it is one line in `package.json`. `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` |
| **A gate-proof is itself a gate** | Task 9's "prove `migrate deploy` fails" test pointed at a nonexistent database on a *reachable* host and expected non-zero. It exits **0**: the `postgres:16` image's `POSTGRES_USER` is a superuser with `CREATEDB`, so Prisma silently creates the database and applies migrations. CI uses the same image, so the test would have passed everywhere while proving nothing. Point at an **unreachable host:port** instead |
| **`describe.skipIf(!dbUrl)` exits 0 on a skip** | A database suite with no `DATABASE_URL` vanishes and the run reports green. `apps/api/test/helpers/require-db.ts` is now the single source of truth for `dbUrl` and throws when `process.env.CI` is set without it. **Every database suite must import `dbUrl` from there**, never read `process.env` directly, or it is silently unguarded |
| **`res.json()` returns `unknown`** | Reading a field off it trips `@typescript-eslint/no-unsafe-member-access`, and the repo lints at zero warnings. Use `res.json<T>()` with a local shape interface; bare `res.json()` only when handing the whole body to a validator or `toEqual`/`toMatchObject`. This broke the plan's verbatim test code twice |
| **Plugin composition order is structurally enforced, not merely conventional** | `tracing` → `problem-details` → `auth` are `fastify-plugin`-wrapped with declared `dependencies`, so a wrong order in `server.ts` **throws at boot** and fails the composition test. Order is guaranteed by fp's dependency graph, not by the test's assertions |
| **`vitest.config.ts` sets `fileParallelism: false`** | Both database suites `TRUNCATE` the same table. Enabling parallelism would make them race. Load-bearing |
| **The generated Prisma client lives in `apps/api/src/generated/prisma/`** | A **third** git-ignored, eslint-ignored generated directory — same discipline as `@irp/types`/`@irp/client`: never committed, regenerated by `prisma generate`, and CI must generate it **before** typecheck |

### Carried forward — open items created by Plan 2B (all four now closed)

**All four are closed as of Plan 4A.** Kept with their original reasoning because each explains
*why* the fix takes the shape it does.

- ~~**No `SIGTERM`/`SIGINT` handler exists anywhere in `apps/api`.**~~ — **closed in Plan 4A.**
  Container Apps sends `SIGTERM` on scale-down and redeploy, so in-flight requests were dropped on
  every deploy, against NFR-2's "200 RPS burst, zero 5xx". `apps/api/src/shutdown.ts` now drains
  via `app.close()`, disconnects Prisma, and force-exits non-zero if the drain overruns. CI asserts
  `docker compose stop api` yields exit code 0, not 137.
- ~~**The auth plugin's `catch` around `jwtVerify` is unconditional**~~ — **fixed in Plan 3.**
  A wrapper around the key-getter records whether retrieval itself failed, so a JWKS outage now
  returns **503** while an unverifiable token still returns 401.
- ~~**`index.ts` only `$disconnect()`s Prisma inside the `catch` around `app.listen`.**~~ —
  **closed in Plan 4A** by `apps/api/src/bootstrap.ts`. If `buildServer` itself rejected, the
  client leaked; low stakes since the process exits, but now handled.
- ~~**`middleware.ts` → `proxy.ts` migration, owed an ADR.**~~ — **closed in Plan 4A, ADR-0013.**
  It was **not a rename**: per `next/dist/build/entries.js:231-243`, `isProxyFile` routes to
  `onServer()` unconditionally, while `isMiddlewareFile` routes to `onEdgeServer()` unless
  `runtime === "nodejs"` — so adopting `proxy.ts` moved the auth guard from the **Edge** runtime to
  **Node**, a behavioural change on the auth path, not a cosmetic one. Next hard-errors if both
  files exist, so there was no incremental path; it was one atomic swap. `apps/web/middleware.ts`
  no longer exists — **do not reintroduce a reference to it.**

### Superseded constraints from Plan 2A (kept for context)

These still hold, but are no longer the newest thing to know.

| Constraint | Why |
|---|---|
| **`ajv/dist/2020`, not Fastify's default ajv** | The spec is OpenAPI 3.1, so its schemas are JSON Schema 2020-12. Fastify's default is draft-07 and will *silently* misinterpret them — the worst failure mode for the one mechanism keeping spec and service aligned |
| **`ajv-formats` is mandatory** | The document uses `format: uri-reference`, `uuid`, `email`. Ajv implements no formats, and in strict mode an unknown format **throws at schema-compile time** — the API fails at boot, not on a bad request. See ADR-0006 |
| **`@irp/client` is bundler-only** | It ships runtime code as raw TypeScript with `noEmit`. Plan 3 needs `transpilePackages: ['@irp/client']` in Next.js. `apps/api` cannot load it |
| **Relax strictness only in a generated package's own tsconfig** | Never `tsconfig.base.json`. `packages/client` sets `lib: ["ES2023","DOM"]` and `exactOptionalPropertyTypes: false` because its `include` covers only generated files |
| **New generated dirs go in `eslint.config.mjs` ignores** | Package-specific patterns only. A broad `**/src/**` would silence real source |
| **A partial OpenAPI document cannot lint clean** | `no-unused-components` warns on anything unreferenced, so schemas and the operations using them must land in one task. This forced a plan restructure |

### The `DayStatus` design risk — resolved as a Plan 6 obligation

`@irp/core` hand-writes `DayStatus` as an eight-value union, and the concern was that the first
domain endpoint would generate a **second** one from the spec with nothing linking them.

**It does not materialise in Plan 2B.** This slice's spec surface is `User`, `Role`, `Problem` and
`HealthStatus` — no day-status schema exists to collide with, so core's union has no generated
counterpart yet. The decision (derive core's unions from `@irp/types`, or assert set-equality in a
test) is **deferred to Plan 6**, where the first domain endpoint lands, and Task 10 records it as a
Plan 6 obligation.

A related but weaker case *did* appear and was judged acceptable: `UserRecord.role` in
`apps/api/src/db/user-repo.ts` hand-writes `"ADMIN" | "STUDENT"` against Prisma's generated `Role`
enum. Unlike `DayStatus`, this one is **compiler-checked** — `role: u.role` is assigned against the
interface, so a third `Role` member fails typecheck rather than drifting silently. The file carries
a comment saying so.

### What still governs the order

Execution runs under `superpowers:subagent-driven-development`: a fresh implementer subagent
per task, an independent reviewer after each, fixes looped until the review is clean, then a
whole-branch review before the PR.

**What still governs the order:**

- The cycle/date engine comes before anything else touching dates. Late, absent and grace
  logic is where this project would quietly go wrong, and every downstream feature depends
  on it. It is Plan 1 for that reason.
- Nothing in `apps/` is written before `spec/openapi.yaml` covers it. Deliverable 2 is scored
  on the spec.
- The mentor dashboard (T-14) is the stakeholder's stated must-have if only one thing ships,
  so it lands as early as its dependencies allow — Plan 7, immediately after the flows it
  reads from.
- T-17 waits on O-5. Everything else routes around it.

**Open points blocking future plans:** O-5 (AI provider) blocks Plan 9. O-6 (rubric wording)
blocks the evaluation schema. O-10 to O-13 need mentor sign-off but block nothing — all are
implemented behind stated assumptions and marked in code. **The Azure account blocks Plans 3
and 4 and is the only genuinely blocking item.**

### Gates that exist, and what each actually catches

Worth knowing because one of them was silently broken until the whole-branch review found it.

- **`redocly lint` under `recommended-strict`** — the plain `recommended` preset exits **0 on warnings** and there is no `--fail-on-warnings` flag, so the zero-warning bar was unenforced for most of Plan 2A. `recommended-strict` promotes warnings to errors. Verified by deliberate failure.
- **A custom Redocly assertion** enforces all four of `200`/`400`/`401`/`500`. The built-in `operation-4xx-response` only requires *at least one* 4xx — deleting a `401` used to lint clean.
- **The determinism gate** regenerates and diffs checksums, catching a non-deterministic generator. "Never hand-edited" is enforced by `.gitignore` plus a `git status --porcelain` check, not by the diff.
- **The three-timezone CI matrix** (UTC, America/New_York, Pacific/Kiritimati) brackets Asia/Colombo both ways, so an off-by-one-day error from reading server local time cannot pass.

**Added in Plan 2B Task 9:**

- **A Postgres 16 service plus `prisma generate` and `prisma migrate deploy` steps** in the `verify`
  job, so the database tests actually run in CI — **demonstrated red** against an unreachable
  host:port (see "a gate-proof is itself a gate" above; a same-host nonexistent-database target
  does not fail, since the image's superuser silently creates it). `prisma generate` runs
  **before** the tracked-output porcelain check — the check is whole-repo and unfiltered, so
  generating after it would leave the Prisma client permanently unexamined. That ordering was
  corrected during review; the plan's original instruction had it backwards.
- **A CI skip guard** (`apps/api/test/helpers/require-db.ts`) that turns a missing `DATABASE_URL`
  into a hard failure when `CI` is set, closing the `skipIf` false-green. Both database suites
  import `dbUrl` from it.

If you add a gate, prove it fails when it should. Two of the original four looked correct and did
nothing — and in Plan 2B a *gate-proof* turned out to be the thing that could not fail, so apply
the same skepticism one level up.

---

## 4. Things not to re-litigate

- The stack is fixed by the programme (Fastify / Postgres 16 / Prisma / Azure Container Apps / Bicep / GitHub Actions). **One row has moved:** the frontend is Next.js **16**, not the pinned 15 — [ADR-0004](docs/adr/0004-nextjs-16-over-pinned-15.md), mentor sign-off pending as O-12. Exact version pins live in `CLAUDE.md`.
- There is **no reject state** in review, no configurable rubric, no file uploads, no student-visible scores or ranks, no mobile layout, no data migration, no admin date-correction. Full list in `CLAUDE.md` under "Hard boundaries".
- Grading and rubric language was deliberately kept out of `docs/stakeholder-interview.md` — that document is requirements input, not a graded exercise. Don't re-add it.
- The five-whys chain did **not** land on fairness or dispute-resolution; the stakeholder rejected that framing outright. The driver is evaluation cost and handover legibility. Don't design for dispute-proofing.

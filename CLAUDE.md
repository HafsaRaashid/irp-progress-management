# CLAUDE.md — IRP Progress Management System

Guidance for Claude Code working in this repository. These rules override default behaviour.

---

## What this is

A progress-tracking and evaluation system for the Bistec Hearts Academy **Industry Readiness Programme (IRP)**. Students submit a short text update each working day; mentors review, record attendance, and evaluate monthly against a fixed rubric with AI-produced scoring. Built as the Month 2 Internal Project Sprint deliverable of the IRP itself.

**Source of truth for requirements:** `docs/interview-and-prd.md`. Every functional requirement is numbered `FR-n` and every non-functional one `NFR-n` — reference those IDs in commits, PRs, stories, and ADRs. If a change maps to no FR, it does not belong in this repo.

**Supporting docs**
| File | What it's for |
|---|---|
| `ONBOARDING.md` | How to get this running locally from nothing — prerequisites, generated packages, env files, Postgres, the seed, the dev identity picker, and a troubleshooting table keyed by exact error text. **Run its §3 and §5 on a returning clone too, not just a fresh one** — all **five** generated trees are git-ignored and survive a `git pull` stale, and nothing invalidates them |
| `docs/interview-and-prd.md` | Requirements, personas, non-goals, NFR targets, team contract, open points |
| `docs/stakeholder-interview.md` | Raw stakeholder answers — the primary record; consult when a requirement's intent is unclear |
| `docs/IRP_Progress_Management_System_Brief.pdf` | Original brief (v1.0 draft) |
| `docs/month-2-challenge-context.md` | Programme constraints: stack, deploy target, deliverables, load-test criteria. **A source record — do not edit it.** It is the evidence any deviation is measured against |
| `docs/design-system.md` | Visual system, verified colour tokens, typography, motion, copy voice, a11y floor |
| `docs/adr/` | Architecture decisions. Read before proposing an alternative that one already rejected |
| `docs/superpowers/specs/` and `plans/` | Per-slice design specs and their task-by-task implementation plans |
| `handoff.md` §2a | **The build order.** The Phase 1–7 list in §2b is traceability only, superseded as sequence |

---

## Stack (fixed — do not substitute)

| Layer | Choice |
|---|---|
| Frontend | Next.js **16**, TypeScript strict — see [ADR-0004](docs/adr/0004-nextjs-16-over-pinned-15.md); the brief pins 15, **mentor sign-off pending (O-12)** |
| API | Fastify + TypeScript |
| Database | PostgreSQL 16 via Prisma |
| Auth | Azure AD SSO, Bistec training tenant |
| Deploy | Azure Container Apps |
| IaC | Bicep, committed in `infra/` |
| CI/CD | GitHub Actions only |
| Observability | Azure Application Insights via `@opentelemetry/api` |
| Load testing | k6 |
| Package manager | pnpm workspaces |

The stack is a programme constraint, not a preference. Swapping any row needs an ADR **and** stakeholder escalation.

### Pinned versions

Verified against the registry on 2026-07-28. **The rule is *newest version the surrounding ecosystem actually supports*, not *newest version published*** — see [ADR-0005](docs/adr/0005-typescript-6-for-eslint-compatibility.md).

| Tool | Pinned | Newest | Why not newest |
|---|---|---|---|
| Node | 24.x | — | — |
| pnpm | 11.17.0 | — | — |
| TypeScript | **6.0.3** | 7.0.2 | typescript-eslint requires `<6.1.0`, and it *is* ESLint's TypeScript parser — TS 7 means no linting at all. ADR-0005 |
| ESLint | 10.8.0 | — | — |
| typescript-eslint | 8.65.0 | — | — |
| Vitest | 4.1.10 | — | — |
| @redocly/cli | 2.x | — | Config uses `recommended-strict`; plain `recommended` exits 0 on warnings |
| openapi-typescript | 7.x | — | — |
| @hey-api/openapi-ts | 0.87.x | — | Needs `-i ./spec/openapi.yaml`; a bare two-segment path reads as a registry shorthand |
| OpenAPI | **3.1.0** | — | Brief says 3.0; ADR-0006. Requires `ajv/dist/2020` **and** `ajv-formats` |
| Next.js | 16.2.12 | — | Brief pins 15; ADR-0004, sign-off pending (O-12) |
| Fastify | 5.10.0 | — | — |
| Prisma | 7.9.1 | — | — |
| `@prisma/adapter-pg` | 7.9.1 | — | Prisma 7 removed `datasourceUrl` from `PrismaClientOptions`; a driver adapter is required for a direct connection (ADR-0008) |
| `ajv` | 8.20.0 | — | Exposes the `ajv/dist/2020` entry point we require for JSON Schema 2020-12, matching OpenAPI 3.1's schemas (ADR-0006) |
| `ajv-formats` | 3.0.1 | — | ajv implements no string formats itself; the spec uses `uri-reference`, `uuid`, `email` |
| `jose` | 6.2.4 | — | ESM-only; `createRemoteJWKSet` + `jwtVerify` for JWT validation against a JWKS endpoint |
| `@opentelemetry/api` | 1.9.1 | — | Stable API surface the Node SDK packages below implement against |
| `@opentelemetry/sdk-trace-node` | 2.10.0 | — | `NodeTracerProvider` + `SimpleSpanProcessor` backing the hand-written tracing plugin (ADR-0007) |
| `@opentelemetry/sdk-trace-base` | 2.10.0 | — | Dev-only; supplies `InMemorySpanExporter`, the test double injected into the exporter seam `createTracerProvider` exposes |
| `@opentelemetry/resources` | 2.10.0 | — | `resourceFromAttributes` sets the service name on the trace resource |
| `@opentelemetry/semantic-conventions` | 1.43.0 | — | `ATTR_SERVICE_NAME` constant, avoids a hand-typed attribute key |
| `@azure/monitor-opentelemetry-exporter` | **1.0.0-beta.43** | 1.0.0-preview.6 | Pinned **exactly, no caret**. This line has never had a stable release; `latest` is the *older* `1.0.0-beta.32`, and `1.0.0-beta.43` is what the GA `@azure/monitor-opentelemetry@1.18.2` depends on. **`^1.0.0-beta.43` resolves to `1.0.0-preview.6`** — semver compares prerelease identifiers alphabetically and `"preview" > "beta"` — which is a 2020 build requiring `@opentelemetry/api ^0.10.2`. ADR-0014 |
| `fastify-plugin` | ^5.1.0 | — | Declares plugin `dependencies` so `tracing` → `problem-details` → `auth` ordering is enforced at boot, not by convention |
| `tsx` | 4.23.1 | — | Dev-only; runs `src/index.ts` directly for `pnpm dev` without a separate build step |
| `next-auth` | **5.0.0-beta.32** | 4.24.15 (`latest`) | v5 is the only version with App Router support — Server Components, `middleware`, and the `handlers` export. v4 predates all of it. `latest` being an *older* major is why this row looks inverted. Shipping a beta is a deliberate exception to the pin rule; ADR-0010 |
| React | 19.2.8 | — | Required by Next.js 16 |
| Tailwind CSS | 4.3.3 | — | v4's CSS-first `@theme` config takes the OKLCH tokens directly; ADR-0001 |
| `@playwright/test` | 1.62.0 | — | Dev-only. The end-to-end smoke test is the only thing proving the whole sign-in chain |
| `server-only` | 0.0.1 | — | Makes "the token never reaches the browser" a build-time error rather than a convention |

Before bumping anything, check the peer ranges of what depends on it. The TypeScript 7 case is the worked example of why.

---

## Repository layout

```
irp-progress-management/
├── spec/
│   └── openapi.yaml          hand-written, source of truth for the API
├── apps/
│   ├── web/                  Next.js 16
│   └── api/                  Fastify
├── redocly.yaml              recommended-strict + a custom four-response assertion
├── eslint.config.mjs         type-aware; generated dirs ignored
├── packages/
│   ├── core/                 pure domain logic — the cycle/date engine. Builds to dist/
│   ├── types/                GENERATED, git-ignored, never committed or hand-edited
│   └── client/               GENERATED SDK, git-ignored. Bundler-only — ships raw TS
├── infra/
│   └── main.bicep
├── tests/
│   └── load/                 k6 scripts
├── docs/
│   ├── interview-and-prd.md
│   ├── stakeholder-interview.md
│   ├── month-2-challenge-context.md
│   ├── design-system.md      visual system, tokens, copy voice
│   ├── adr/                  NNNN-title.md
│   └── superpowers/
│       ├── specs/            YYYY-MM-DD-<topic>-design.md
│       └── plans/            YYYY-MM-DD-<feature>.md
├── .github/workflows/
├── CLAUDE.md
└── handoff.md
```

---

## House rules

**Spec-first, always.** `spec/openapi.yaml` is hand-written and changes *before* any handler. Types and the client SDK are generated from it in CI. Never hand-edit `packages/types/` or `packages/client/` — if the shape is wrong, fix the spec and regenerate.

**API contract rules** (these are graded, and they are also just correct):
- Every endpoint defines `200`, `400`, `401`, and `500` responses. No exceptions.
- Every schema carries example values; every parameter carries a description.
- Request bodies are `additionalProperties: false`. Validate strictly, reject loudly.
- Errors use RFC 7807 Problem Details as the response body shape.
- `pnpm spec:lint` must pass with **zero warnings**, not just zero errors. This is enforced by `extends: [recommended-strict]` in `redocly.yaml` — **plain `recommended` exits 0 on warnings and there is no `--fail-on-warnings` flag**, so the bar was unenforced until a review caught it.
- The four-response rule is enforced by a **custom Redocly assertion**, not by `operation-4xx-response` — that built-in only requires *at least one* 4xx, so a missing `401` lints clean under it.
- **A partial OpenAPI document cannot lint clean.** `no-unused-components` flags anything unreferenced, so a schema and the operation using it must land in the same task. Plan a spec change as one unit.

**Generated packages.** `packages/types` and `packages/client` are git-ignored and regenerated by `pnpm generate`; a fresh clone must run it before typecheck will pass. `apps/api/src/generated/prisma` is a **third** such directory — git-ignored, eslint-ignored, and regenerated by `prisma generate` (`pnpm --filter @irp/api exec prisma generate`); CI runs it *before* the generated-output check, since that check is whole-repo and unfiltered. That check is **two** conditions, because one does not cover the other: `git ls-files` over the three generated directories catches force-committed output, and `git status --porcelain` catches a `.gitignore` regression that leaves generated files untracked-and-unignored. **`git status --porcelain` alone cannot detect a force-committed generated file** — the determinism gate guarantees regeneration is byte-identical, so a tracked copy leaves the tree clean and the check exits 0. It said otherwise until a whole-branch review ran it against a force-added `packages/types/src/schema.ts`. Never commit generated output — a tracked copy is a second version of the contract that can drift. New generated directories go in `eslint.config.mjs`'s `ignores` with **package-specific** patterns; a broad `**/src/**` would silence real source. Strictness may be relaxed for generated code **only in that package's own tsconfig**, never in `tsconfig.base.json`.

**Prisma 7 datasource config.** The schema's `datasource` block carries `provider` only — Prisma 7 removed `url` from it, and `prisma validate`/`migrate`/`generate` fail `P1012` before touching a database if it's still there. The connection URL lives in `apps/api/prisma.config.ts` via `defineConfig`/`env` from `prisma/config`. Likewise, `PrismaClientOptions` no longer accepts `datasourceUrl` — it is a union of `{ adapter }` | `{ accelerateUrl }`, so a driver adapter is required for a direct connection: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` via `@prisma/adapter-pg` ([ADR-0008](docs/adr/0008-prisma-driver-adapter-over-accelerate.md)).

**Prove a gate fails before trusting it.** Two of this project's four CI gates looked correct and did nothing until a review tested them with a deliberately broken input. Adding a gate means demonstrating it goes red.

**No hand-written fetch in the frontend.** `apps/web` imports only from `packages/client`. A raw `fetch()` to our own API is a bug.

**Local ports: web on 3100, API on 3001, Postgres on 5433.** The web app moved off 3000 on
2026-08-18 for the same reason Postgres moved off 5432 — those defaults are routinely already held
by something else on a developer machine. **3100 is not a single setting.** Changing it means
changing, together: `apps/web/package.json`'s `dev` and `start` scripts, `AUTH_URL` (yours and
`.env.example`), `JWKS_URI` and `JWT_ISSUER` in `apps/api/.env`, `DEV_ISSUER` in
`apps/web/lib/dev-identities.ts`, five values in `apps/web/playwright.config.ts`, and five in
`.github/workflows/ci.yml`. `DEV_ISSUER` is the one that bites: it is a **hardcoded constant, not
derived from `AUTH_URL`**, so moving the port without it leaves the API string-comparing an `iss`
claim that no longer matches — it boots clean and 401s every request, which presents as "my
session expired", not as a config error.

**Container-internal ports stay 3000**, deliberately: `Dockerfile`'s `web` stage `PORT`/`EXPOSE`,
`compose.yaml`'s `PORT` and healthcheck, and `infra/main.bicep`'s ingress `targetPort` — which
**must equal the image's `PORT`** or Container Apps routes to a port nothing listens on. The
collision 3100 avoids is host-side; nothing competes for a port inside a container. `compose.yaml`
publishes `3100:3000`, so nothing a developer runs binds 3000 either way. Do not "tidy" those
three 3000s to match.

**The dev auth bypass is temporary and must be deleted, not left dormant.**
`AUTH_DEV_BYPASS=true` makes `apps/web` mint tokens with a local key. It swaps
the token *issuer* — `apps/api` still validates every token with its real `jose`
path — so it is not an auth skip. Two guards keep it out of production: a
startup throw when the flag meets `NODE_ENV=production` (matched
case-insensitively, so the guard fires more often, not less — a container
that sets `NODE_ENV=Production` must still trip it); and `apps/web/lib/dev-identity.ts`
never being **evaluated** in production, because the dynamic import that
loads it is gated on the same flag. **This second guard is not bundle
exclusion** — a dynamic `await import()` with a literal specifier is
statically analyzable, and Turbopack still emits it as a lazy chunk rather
than removing it from the production bundle; do not write or repeat the
claim that it is excluded from the bundle. The startup throw
(`assertBypassNotInProduction`, in `apps/web/auth.config.ts`) is the guard
that structurally enforces the block, but its coverage is **per entry
point, not automatic**. There are **four**, and each one was discovered the
hard way rather than reasoned about correctly in advance:

1. `apps/web/auth.ts` — covered transitively; it imports `auth.config.ts`.
2. `apps/web/proxy.ts` — covered directly. It imports `auth.config.ts`
   itself rather than going through `auth.ts`. (Until Plan 4A this was
   `middleware.ts`, and the reason was that it had to be edge-safe; ADR-0013
   moved the guard to Node, and `middleware.ts` no longer exists. Do not
   reintroduce a reference to it.)
3. `apps/web/app/api/dev-jwks/route.ts` — its **own explicit call**. It
   imports `apps/web/lib/dev-identity.ts` directly and pulls in
   `auth.config.ts` by no other path. A Plan 3 whole-branch review proved the
   gap before the fix: a production `next start` with the flag on correctly
   500'd on `/` and `/api/auth/session` but served a live, freshly generated
   JWKS with 200 from `/api/dev-jwks`.
4. `apps/web/instrumentation.ts` — its **own explicit call**, added in Plan
   4A. Next calls `register()` once per runtime at **server boot**, and that
   is the only hook that runs when no request ever arrives. A containerised
   `next start` does not import route modules at boot: `server.js` reads
   `required-server-files.json` and opens a socket, and route modules load
   lazily on the first matching request. So with the flag on, the container
   started, reported "Ready", stayed Up indefinitely, and 500'd every
   request. That is still fail-closed and no bypass session was reachable,
   but "refuses to start" is a materially stronger guarantee than "serves
   errors" — and a container sitting Up while failing everything reads as
   healthy to any orchestrator without a route-level probe. It **catches and
   calls `process.exit(1)` rather than just throwing**, because throwing out
   of `register()` does not stop the server: Next wraps the hook and
   surfaces the failure as an unhandledRejection, for which it has installed
   its own listener that pre-empts Node's crash-on-unhandled-rejection. This
   was measured, not assumed.

**The rule going forward: any new module that imports `lib/dev-identity`
directly, or that is a new process-level entry point, must call the guard
itself** — do not assume importing something that imports `auth.config.ts`
is enough, and do not assume the guard's coverage is exhaustive just because
it is described as "the same call." Four successive claims that coverage was
complete have now been false. Note the shape: **four entry points, three call
sites** — the count of calls has never equalled the count of things needing
cover, which is exactly why "it's the same call" keeps being wrong.
**Never weaken any of these guards**, and
never loosen the exact-match comparison on `AUTH_DEV_BYPASS` or the
case-insensitivity of the `NODE_ENV` comparison — the two checks are
intentionally asymmetric, one narrow and one broad, and both directions
matter. Once the Entra directory exists, perform the cutover in the Plan 3
spec §7 and remove the bypass. ADR-0012.

**Hard-won facts from Plan 3, worth not rediscovering:**

- **`pnpm typecheck` is not sufficient for `apps/web`.** Plain `tsc` does not run Next's own
  checks: it missed a `typedRoutes` error and an export-shape error in the then-`middleware.ts`
  (now `proxy.ts`, ADR-0013) that broke the production build for four tasks before a reviewer ran
  the real build. `pnpm --filter @irp/web build` is part of the required verification set for any
  change touching `apps/web`.
- **It is also not *trustworthy* for `apps/web` without a preceding `next build`** — it can be
  **falsely red**, which is the more confusing direction. `apps/web/tsconfig.json` includes
  `.next/types/**/*.ts`, and `typedRoutes` puts the route union in `.next/types/routes.d.ts` —
  written by **`next build`**. `next dev` writes its own copy to **`.next/dev/types/routes.d.ts`**,
  which `tsconfig` does not include. So the file `tsc` actually reads is a snapshot from whenever
  `next build` last ran, it is git-ignored, and nothing invalidates it: on 2026-08-04 it was three
  days old, listed only `"/" | "/not-registered" | "/signin"`, and produced **nine** `TS2322`
  errors of the form `Type '"/roster"' is not assignable to type 'Route'` against code that was
  entirely correct and running fine in the browser. Running `pnpm --filter @irp/web build`
  regenerated it and typecheck went clean with no source change. **Do not "fix" a `Route`/
  `RouteImpl` assignability error by casting or by widening the `Link` href type** — rebuild first
  and confirm the error survives. Visiting the pages in `next dev` does not help; it refreshes the
  `.next/dev` copy `tsc` never reads.
- **Next canonicalises loopback hostnames to the literal string `localhost`**
  (`NextURL.parseURL` / `REGEX_LOCALHOST_HOSTNAME` in `next/dist/server/web/next-url.js`).
  Driving a browser at `127.0.0.1` breaks two things: the dev server 403s `/_next/*` as
  cross-origin (its allowlist is `localhost`/`*.localhost`), killing the HMR upgrade Next
  connects *before* hydrating — so React never hydrates, no click handler is attached, the page
  renders perfectly via SSR and nothing throws; and Auth.js computes its base origin as
  `localhost` regardless of `AUTH_URL`, so a callback redirect lands on an origin without the
  cookie. **The `::1` hazard that motivates `127.0.0.1` elsewhere applies to servers we bind
  ourselves** — Fastify listens IPv4-only, Next's dev server listens on both. So `apps/api` is
  addressed as `127.0.0.1` and the browser as `localhost`.
- **`JWT_ISSUER` is string-compared against the token's `iss` claim; `JWKS_URI` is fetched.**
  They need not match and here deliberately do not.
- **jose 6.2.4 ships a single WebCrypto build with no `node` export condition**, and jsdom's VM
  realm fails jose's `instanceof Uint8Array` check — `// @vitest-environment node` is the
  established fix. Its error classes live under `jose.errors`, **not** as top-level exports; a
  top-level import is `undefined` and `instanceof undefined` throws.
- **Vitest orders test files by cached duration then file size, not filename.** Any test relying
  on execution order is unstable across machines. Every database test must create the rows it
  needs in-file, because the `apps/api` suites `TRUNCATE` the `User` table.
- **`pnpm --filter @irp/web build` fails locally unless you pass `AUTH_DEV_BYPASS=false`**, and
  that is the guard working, not a bug. `next build` sets `NODE_ENV=production`, and Next loads
  `apps/web/.env.local` — which sets the bypass flag for development — into `process.env`, so
  `assertBypassNotInProduction` correctly refuses to build. Set the flag explicitly to `false`
  for a local build; an explicit value wins because Next does not override an already-set
  variable. **CI is unaffected**: `.env.local` is git-ignored and CI never sets the flag, which
  is why the CI build step deliberately runs with it absent. If a local `next build` ever
  succeeds with `AUTH_DEV_BYPASS=true`, guard one has broken — investigate immediately.
- **`next/image` cannot infer `height` from a static import under Vitest, even though it can in
  production.** In production, omitting `height` and supplying only `width` against a statically
  imported image is sound: `next/dist/shared/lib/get-img-props.js` computes
  `height = round(staticImageData.height * width / staticImageData.width)` because
  `isStaticImport(src)` is true for the object a static import resolves to. Under Vitest it is
  **not** — Vite resolves a PNG import to a plain URL **string**, not a `{src, width, height}`
  object, so `isStaticImport(src)` is false, the inference branch never runs, and all four
  `brand-mark.test.tsx` cases fail with *"Image with src … is missing required `height`
  property."* This was measured (Plan 7B's whole-branch review), not theorised. Adopting the
  inference would need a Vitest asset stub for PNG imports first; until then, declare both
  `width` and `height` explicitly on every statically imported `next/image`, and do not "simplify"
  one by dropping `height` on the assumption Next will infer it — the test suite exercises the
  string-`src` path, not the static-import path, so that regression would only surface here, not
  in production.
- **A local `pnpm typecheck` cannot see a missing `next-env.d.ts`, and CI has none.** That file is
  generated and git-ignored (`.gitignore:6`), so it is present on any machine where `next dev` or
  `next build` has ever run and absent in a fresh clone — and it is what carries
  `/// <reference types="next/image-types/global" />`, the declaration that makes
  `import mark from "@/assets/x.png"` resolve. CI runs `Typecheck` **before** `Build @irp/web`
  (deliberately — see the step's comment), so the first static image import in the repo made all
  three timezone legs fail `TS2307: Cannot find module '@/assets/hearts-academy-mark.png'` on a
  branch that was green locally and had passed a full `next build`. The reference is now committed
  as `apps/web/types/static-image-assets.d.ts`, so it no longer depends on generated output. **Do
  not "fix" a future instance by committing `next-env.d.ts` itself** — it carries
  `import "./.next/types/routes.d.ts"`, a path written by `next build` into another git-ignored
  tree, so committing it trades one `TS2307` for another. **When adding the first import of a new
  non-code asset type, verify with `next-env.d.ts` moved aside** — a warm working tree cannot
  reproduce what CI does.

**Container facts from Plan 4A:**

- **`node:24-slim`, never alpine.** Debian/glibc matches Prisma's `debian-openssl-3.0.x` binary
  target. Alpine is musl, needs a different target, and fails at *runtime* rather than at build
  time.
- **The generated Prisma client is pure TypeScript** (no engine binaries — Prisma 7 with a driver
  adapter, ADR-0008), so `tsc` compiles it into `dist/generated/prisma/` and the API runtime image
  needs `apps/api/dist` **only**. Do not copy `src/generated` into an image.
- **`prisma generate` in a Docker build needs a throwaway `DATABASE_URL` build arg.** It must
  parse; it never connects.
- **`outputFileTracingRoot` must be the repository root.** Tracing from `apps/web` misses workspace
  dependencies and yields an image that builds and then fails at runtime on a missing module.
- **`.next/static` is not traced into `.next/standalone`** and must be copied separately, or every
  `/_next/static` request 404s and the page renders unstyled — which no status-code check catches.
- **`node:24-slim` ships neither `curl` nor `wget`.** Container healthchecks use `node -e` with
  `fetch`.
- **Copy the whole `prod-deps` stage, not individual `node_modules` paths.** A path-by-path copy
  breaks pnpm's relative symlinks, and `packages/core/node_modules` does not exist under `--prod`
  (it has devDependencies only), so a `COPY` of it fails the build.
- **`apps/web/public/` does not exist.** A `COPY` of it fails the build.
- **A containerised `next start` is a distinct entry point for the dev-bypass guard.** CI asserts
  the web container exits non-zero with `AUTH_DEV_BYPASS=true`, *and* that it does so with the
  guard's own error string — a bare non-zero exit proves nothing, since a missing env var or a bad
  `CMD` also exits non-zero.
- **CI runs on `pull_request` and pushes to `main` only.** A bare push to a feature branch triggers
  **nothing**. Push the branch *and* open the PR, or you are reading stale checks.
- **The Playwright suite must run against `next dev`**, because the sign-in chain needs
  `AUTH_DEV_BYPASS=true` and that cannot exist in a production build. On-demand Turbopack
  compilation is therefore inherent to the suite, and its cost lands inside the first test's first
  assertion — two cold compiles, ~4.9s. `playwright.config.ts` budgets for it explicitly
  (`expect: { timeout: 20_000 }`); the default 5000ms made that gate a coin flip. **Do not "tidy"
  those timeouts back down.**
- **`fullyParallel: false` is not "run serially", and `workers` must stay pinned to 1.**
  `fullyParallel` only orders tests *within* a file; Playwright still distributes *files* across
  workers. `workers` controls that, and its default is 1 **only when `process.env.CI` is set** —
  otherwise half the logical cores. So one config ran **serially in CI and 4-way parallel locally**,
  which is why the suite was green on every CI run and scored 24/24, 23/24 then 19/24 across three
  local runs of the same commit. The four spec files share one database and one dev server and
  mutate them — `mentor-flows`' archive test calls `reseed()`, a full `db:seed` that wipes and
  rebuilds every persona **mid-run**, while other files are asserting on today's figures. There is
  no safe parallelism to recover; `workers: 1` is pinned so local and CI run the identical schedule.
  A gate that fails only where nobody is watching teaches the reader to re-run instead of to read.

**Infrastructure facts from Plan 4B:**

- **`az bicep lint` needs no Azure credentials** and does full semantic analysis, so the template is
  gated in CI before any subscription is ready. **`az deployment ... what-if` and `validate` DO call
  ARM** and cannot be gates — they are runbook procedures, not CI checks. Do not "upgrade" the gate
  to `what-if`.
- **`az bicep lint` exits 0 on WARNINGS**, and `BCP053` (reading a property a resource type does not
  have) is a warning — so an exit-code-only gate is hollow. This is the Redocly
  `recommended`-exits-0-on-warnings trap in a different tool. `bicepconfig.json` cannot fix it,
  because `BCP053` is a core compiler diagnostic, not a configurable rule. `infra/lint.mjs` fails on
  any Error **or** Warning diagnostic, and it also asserts the config file was actually loaded —
  Bicep resolves `bicepconfig.json` by walking up the directory tree and silently falls back to
  defaults if it never finds one.
- **`ManagedEnvironmentProperties@2024-03-01` exposes no outbound/egress property** — only
  `staticIp`, which is INBOUND. ADR-0009 D2's "static outbound IP" for the Postgres firewall
  allowlist is not expressible in the template, so the runbook (§4.2) discovers it empirically:
  with `ALLOWED_CLIENT_IPS` still `[]`, deliberately attempt a connection (the migration job, or
  `psql`) and read the address Postgres's own rejection message names — that is the Container
  Apps environment's egress address, not the developer's IP. The developer's own IP is only an
  optional addition in §4.3, for direct `psql` access alongside the discovered address.
- **A wrong Postgres firewall allowlist is silent.** The apply succeeds and `/health` succeeds
  because it never touches the database, so only data reads fail — which reads as an application bug
  rather than a network one.
- **Never set `APP_VERSION` as a container-app runtime env var.** The Dockerfile bakes it as a build
  arg, and the `/health` assertion only proves the arg reached the image *because* no runtime copy
  exists.
- **A rollback must not rebuild.** `workflow_dispatch` checks out the branch tip, not the commit named
  by `imageTag` — the input only ever names an image tag. Building unconditionally made a "rollback"
  overwrite the known-good image in GHCR with a freshly built copy of current (broken) code while
  `/health` still reported the old SHA, because `APP_VERSION` is baked from the same input. Build
  steps are gated on `steps.tag.outputs.mode == 'build'`, which is set only when `imageTag` is empty.
- **`az monitor app-insights query` and `az monitor log-analytics query` are preview extensions** in
  CLI 2.88.0; auto-install needs `az config set extension.dynamic_install_allow_preview=true` or the
  command fails asking for confirmation it cannot get non-interactively.
- **PowerShell 5.1 quirks that bit this plan:** `--query "length(@)"` fails outright — use
  `(expr | Measure-Object).Count` or a different JMESPath shape instead. And `Select-String` is
  **case-insensitive by default**, which miscounts case-sensitive markers (e.g. `MEASURE` vs
  `measure`) unless `-CaseSensitive` is passed.

**Time handling.** Store every timestamp in UTC. Evaluate every deadline, late flag, and cycle boundary in **Asia/Colombo (UTC+05:30)**. Never rely on the server's local timezone — the deploy region is not Sri Lanka. Cycles run the 10th → the 9th of the following month.

**Weekdays are required; weekends are optional extra work.** A weekday with no entry and no absence, past the grace window, is **Missed**. A weekend day can hold entries and they count as **Extra** — but a weekend is *never* missed, *never* late, and never appears in a compliance denominator. Any date arithmetic over *required* days must skip weekends; arithmetic over *recorded activity* must not.

**No deploys outside CI.** No shell scripts checked in, no portal clicks, no `az` commands run by hand for anything that should be Bicep.

**How work is executed.** Every slice runs the same loop: `brainstorming` → a spec in
`docs/superpowers/specs/` → `writing-plans` → a plan in `docs/superpowers/plans/` →
`subagent-driven-development` to execute it, one fresh subagent per task with an independent
reviewer after each. **One plan, one branch, one PR, merged before the next plan starts.**

When a subagent finds a defect in the plan's own code, fix the plan at source and commit that
correction alongside the code fix. A plan that has silently diverged from the codebase is
worse than no plan.

**Archive the SDD scratch directory between plans.** `subagent-driven-development` writes
task briefs, implementer reports, review diffs and the progress ledger to `.superpowers/sdd/`
under fixed names — `progress.md`, `task-1-brief.md`, and so on. Those names repeat every
plan, so starting a new plan silently overwrites the last one's record. The directory is
gitignored, so nothing recovers it.

**Before the first task of a new plan:** move everything except `progress.md` and `.gitignore`
into `.superpowers/sdd/plan-<N>/`, then reset `progress.md` for the incoming plan. Plan 1's
ledger was lost to exactly this before the convention existed.

**Git discipline** (solo sprint — see the team contract in `docs/interview-and-prd.md` §4.3):
- No direct commits to `main`. One branch and one PR per plan.
- PR description names the FR(s) it implements.
- Conventional commits.
- Any decision with a plausible rejected alternative gets an ADR first, naming at least two rejected alternatives.

---

## Domain glossary

Read this before writing schema or naming anything.

| Term | Meaning |
|---|---|
| **Batch** | A cohort of students with its own start and end dates. Two run concurrently; calendars are independent. |
| **Cycle** | A monthly evaluation window, 10th → 9th, anchored to the batch's admission date, in Asia/Colombo. The unit of scoring. |
| **Entry** | One text submission by a student. Multiple entries per day are allowed. |
| **Daily report** | All of a student's entries for one date, rolled up. The reviewable unit. |
| **States** | `In Review → Evaluated`. A report is **born In Review** the instant a student submits — there is no earlier state and no "start review" step ([ADR-0028](docs/adr/0028-a-report-is-born-in-review.md), ASSUMPTION: O-19; FR-18 still says three, and its wording is the stakeholder's to change). There is **no Rejected state** — do not add one. |
| **Required day** | A weekday. Carries a submission obligation and counts in compliance denominators. |
| **Optional day** | A Saturday or Sunday. May hold entries, carries no obligation, never counts in a denominator. |
| **Late** | An entry for a required day, submitted after that day ended but inside the grace window. Flagged, still accepted. Optional days are never late. |
| **Absent** | A **weekday** a student explicitly marked as absent with a reason. Distinct from a missed submission. Absence does not apply to weekends — there is nothing to be absent from. |
| **Missed** | A **weekday** with no entry and no absence record, past the grace window. Final. A weekend is never missed. |
| **Extra** | An entry on a Saturday or Sunday. Recorded, surfaced to the mentor, and fed to the AI summary as positive context. Never required, never penalised by its absence. |
| **Rubric** | Five fixed criteria, weights **20 / 25 / 25 / 10 / 20**. Not configurable at runtime — no admin UI for weights. |
| **Performance index** | The AI-produced weighted score for a cycle. The score of record; a mentor may override it. |
| **Override** | A mentor-set score that supersedes the AI's. Stores the new score, the original AI score, and the mentor's reason. |
| **Admin** | A mentor. Every mentor is an Admin; there is no super-admin tier. Admins share access across all batches in v1. |

---

## Hard boundaries — do not build these

Confirmed non-goals. If a task seems to require one of these, stop and re-read `docs/interview-and-prd.md` §3.3.

- File or attachment uploads — submissions are **text only**
- Task assignment or project management — the system records work, never assigns it
- Leave-request or approval workflow — absence is recorded, not requested
- Mobile app or responsive mobile layout — desktop only, min 1280px
- Configurable rubric weights
- Any student-visible score, rank, or leaderboard; any student-to-student visibility or messaging
- Cross-batch comparison or analytics
- Data migration or import — the system starts empty
- Admin date-correction / back-dating — wrong-date submission is prevented by construction instead
- A reject-and-resubmit review flow
- Editing the AI summary text
- Payroll, stipend, or HR integration

Deferred to v2: quarterly evaluation, automated emailing of the monthly report.

---

## NFR targets to build against

| Target | Value |
|---|---|
| API p95 | < 250 ms at 50 RPS sustained |
| Burst | 200 RPS for 30 s, zero 5xx |
| Auth-gated | 10 RPS for 5 min, zero token failures |
| Memory drift | < 50 MB over 30 min idle |
| Deploy pipeline | under 8 minutes |
| Trace visibility | in App Insights within 60 s of a request |
| OpenAPI lint | zero errors, zero warnings |

---

## Open points — ask, don't assume

Listed in full as `O-1`..`O-9` in `docs/interview-and-prd.md` §5. The ones that block code:

- **O-2** — whether the monthly report PDF is emailed in v1 or download-only. Currently assumed **download-only**.
- **O-3** — winner tie-break rule. Currently assumed: weighted score → submission compliance → earliest average submission time.
- **O-5** — AI provider is undecided, and student submissions are personal data. Needs an ADR and leadership escalation **before** any AI call is implemented. Do not wire a third-party model API without it.
- **O-6** — exact wording of the five rubric criteria, needed before the schema hardens.
- **O-7** — whether absence and lateness carry an automatic score penalty. Currently assumed **no** — context for the AI summary only.

When work depends on one of these, implement behind the stated assumption, mark it `// ASSUMPTION: O-n` in code, and log it. Do not silently pick a different answer.

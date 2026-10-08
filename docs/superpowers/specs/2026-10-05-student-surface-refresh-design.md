# Design — the student surface refresh

**Date:** 2026-10-05
**Status:** approved
**Branch:** `feat/ui-ux-improvements`
**Closes:** `docs/design-system.md` §13's first row — "**Bistec brand colour** — `--primary` is a placeholder"
**Serves:** FR-29 (student dashboard), FR-30 (no score, no rank, no peer data — must not weaken)
**Needs:** ADR-0030, ADR-0031, ADR-0032

---

## Goal

The student side of the app is monotonous. It opens on a bare `Today` heading, every surface is the
same restrained grey-and-indigo as the mentor's dense roster, submitting succeeds **silently**, and
the one colour carrying the brand is a placeholder indigo that was never Bistec's.

This slice makes the student surfaces warmer and more legible without touching the status vocabulary,
the accessibility floor, or the mentor's view — and it closes the brand-colour open item that has sat
in §13 since the design system was written.

**Two registers.** The mentor dashboard stays dense and restrained. Student surfaces become warmer.
The mechanism is opt-in behaviour on shared components, defaulted off, so the mentor frame comes out
of this slice byte-for-byte unchanged (D6).

---

## Why this is a slice and not a set of tweaks

Every item lands on the same four files — `globals.css`, `student-today.tsx`, `my-month/page.tsx`,
and the `components/ui/*` primitives — so shipping them separately means editing and re-reviewing
the same surfaces five times.

They also share one spine: **the colour swap forces the contrast gate**, the contrast gate protects
every subsequent visual change, and the page move is what makes the feedback band worth keeping at
all. Split them and the gate lands after the colour it was built to verify.

---

## What changed during design

Four things in the agreed direction were **wrong on measurement** and are recorded here so they are
not reintroduced. Everything in this section was measured against the real assets and the real
stylesheet, not reasoned about.

### The proposed brand blue fails the text floor

The direction named `#1C8FD1` ≈ `oklch(0.55 0.13 238)`, sampled by eye from
`apps/web/assets/hearts-academy-lockup.png`.

`--primary` is not only a fill. It renders as **text** in four places:

| Where | File |
|---|---|
| `.nav-item[data-active] { color: var(--primary) }` | `globals.css:251` |
| `.chip[aria-current="page"] { color: var(--primary) }` | `globals.css:280` |
| `.text-link:hover { color: var(--primary) }` | `globals.css:292` |
| `StatusPill`'s `--st-review` → "· In review" | `status-pill.tsx` |

So it carries 4.5:1, not 3:1. Measured against `--bg`:

| Candidate | OKLCH | vs `--bg` | |
|---|---|---|---|
| `#1C8FD1` (the eyeballed value) | `0.622 0.137 241` | **3.56:1** | fails |
| `#0188c5` (the logo's mid blue) | `0.596 0.133 239` | **3.94:1** | fails |
| `oklch(0.55 0.13 238)` as written | — | out of sRGB gamut; clamps to 4.42:1 vs `--surface` | fails |

The instinct was right and the lightness was not. A second constraint compounds it: at hues 232–244
with chroma 0.13, **almost nothing in the usable lightness range is in sRGB gamut at all**.

### The logo is a gradient, not a colour

Sampling `hearts-academy-mark.png` (8-connected clusters, alpha ≥ 200, quantised to 16 levels per
channel) shows the heart runs **253° → 223°**, with a teal tail:

| Hex | Share of mark | OKLCH |
|---|---|---|
| `#045aa9` | **15.2%** | `0.469 0.145 253.6` |
| `#0462ae` | 14.3% | `0.492 0.143 251.4` |
| `#0367b3` | 12.5% | `0.507 0.144 250.4` |
| `#0389c4` | 7.1% | `0.598 0.131 237.8` |
| `#01a7d8` | 4.4% | `0.680 0.132 227.9` |
| `#12d7a6` | 0.3% | `0.782 0.155 **168.6**` |

Taking the gradient's **deep end** where ink is needed is therefore faithful to the asset, not a
compromise with it — and it is the single largest cluster in the mark.

That last row is also the reason the gradient needs a clamp: `168.6°` is **inside** the 140–170°
band §3.4 reserves for `--st-ok`. A gradient that follows the heart honestly to its end would run
into the status-green fence.

### The wordmark green is not fenced out — it is merely too close

The direction stated the brand green "collides with the 140–170° fence". It measures **135.3°**
(`#163301`, `oklch(0.287 0.083 135.3)`), which is *outside* it. The conclusion stands — green stays
in the logo — but for the correct reason: 135° sits ~20° from `--st-ok` at 155° at comparable
lightness, which is not enough separation for a decorative green beside a semantic one. The ADR must
state that reason, not the fence.

### There is no contrast script

The direction assumed pairs would be "added to `test/theme-tokens.test.ts` and must pass". That file
asserts only that the two dark token blocks stay byte-identical and that `--brand-card` is never
overridden. **Nothing in the repository computes luminance** — verified by grep across all `.ts`,
`.tsx`, `.mjs` and `.js` outside `node_modules`.

§3's "35 pairs across both themes pass" is a one-off claim with no enforcement behind it. The file
even names the risk in a comment — *"a copy that drifts breaks AUDITED contrast silently"* — and then
guards only against the copies drifting **from each other**, not against either being wrong. Edit a
colour consistently in both blocks and every test stays green.

So the gate must be **built**, not extended (D2).

---

## Decisions

### D1 — `--primary` becomes the sampled Bistec cerulean

Four tokens change. The two weak variants are re-derived per §3.4's instruction ("re-derive
`--primary-weak` at roughly `L 0.95 / C 0.022` on the same hue").

| Token | From | To | OKLCH |
|---|---|---|---|
| light `--primary` | `#3c4ba2` | **`#045aa9`** | `0.469 0.145 253.6` |
| light `--primary-weak` | `#e9eefe` | **`#e5f0fd`** | `0.950 0.022 253.4` |
| dark `--primary` | `#8a9ff0` | **`#6da8ee`** | `0.720 0.120 253.5` |
| dark `--primary-weak` | `#262c45` | **`#1d2f44`** | `0.300 0.046 253.4` |

Measured, both themes:

| Pair | Light | Dark | Floor |
|---|---|---|---|
| `--primary` on `--bg` | 6.91:1 | 7.57:1 | 4.5 |
| `--surface` on `--primary` (`.btn-primary` label) | 6.45:1 | 6.74:1 | 4.5 |
| `--primary` on `--primary-weak` (active nav, chip) | 5.99:1 | 5.50:1 | 4.5 |

Hue ~253° is clear of both reserved bands (20–70°, 140–170°), in sRGB gamut, and the **same hue in
both themes** (253.6 / 253.5, within rounding) — matching the existing system, where light and dark
primaries share hue 272.

**`#045aa9`, not `#035baa`.** The two differ by ΔL 0.003 and ΔH 0.27° — perceptually the same colour,
0.09:1 apart in contrast — but only one of them supports the claim made for it. `#045aa9` is the
**mark's** largest cluster at 15.2%; `#035baa` is the **lockup's** third cluster at 9.5%, behind the
green wordmark's 20.1%. An earlier draft of this spec shipped the lockup value while citing the
mark's provenance for it. Recorded because the two are indistinguishable by eye, so nothing but this
note would stop the swap being made back.

**Rejected** (ADR-0030 records these): the bright cerulean `#1C8FD1` — fails the text floor at
3.56:1; the logo's own mid-blue `#0188c5` — 3.94:1, same defect; keeping the placeholder indigo —
leaves §13's open item open and the product unbranded; re-scoping `--primary` to fills only so a
lighter blue could be used — would mean inventing a second "primary text" token and rewriting four
call sites in `globals.css` to carry a distinction the design system does not have.

**The dark block is duplicated** in `globals.css` (once inside `@media (prefers-color-scheme: dark)`,
once under `:root[data-theme="dark"]`). Both copies must change. `theme-tokens.test.ts` already fails
if they drift — that gate works and needs no change.

### D2 — A contrast gate, proven red before it is trusted

A new test computes WCAG 2.x contrast ratios **from the token values parsed out of `globals.css`**,
not from a hand-maintained copy of them. A hard-coded second list would be one more thing to drift.

**30 pairs per theme, 60 total**, derived from what the code actually renders — not from §3's prose.
Text pairs at 4.5:1; control borders, focus rings and the today ring at 3:1 (WCAG 1.4.11).

Measured now, before any change: **all 60 pass**, under both the current and the proposed tokens. So
the gate lands green and the colour swap does not move it.

Two pairs sit at **101% of floor** and are the reason this is worth building:

| Pair | Theme | Ratio | Floor |
|---|---|---|---|
| `--st-absent` on `--surface` | light | 4.55:1 | 4.5 |
| `--line-strong` on `--surface` | dark | 3.03:1 | 3.0 |

Any future nudge to either breaks a real accessibility guarantee, and today nothing would notice.

Per `CLAUDE.md` — *"Prove a gate fails before trusting it … adding a gate means demonstrating it goes
red"* — the implementing task must show the gate red against a deliberately broken token and record
the output in its report. **A task that adds this test without that evidence is not complete.**

**Rejected:** a standalone `scripts/contrast.mjs` run by hand — it is the thing that already failed,
since an unrun script is indistinguishable from no script; a CI-only step — it would not fail on a
developer machine, where colours are actually edited; asserting the §3 prose table instead of the
stylesheet — it would verify the documentation against itself and never read the shipped CSS.

This decision is the enforcement arm of D1 and is recorded **inside ADR-0030** rather than taking an
ADR of its own.

### D3 — Two pages, not three; feedback moves to My progress

The original direction split the student surfaces three ways: a scan-only dashboard, a `/daily`
action page, and a history page. **It is two.**

| Route | Label | Holds |
|---|---|---|
| `/` | **Today** | greeting · ribbon · counts · streak · composer · recent days · mark absent |
| `/my-progress` *(renamed from `/my-month`)* | **My progress** | "Month N of 6" pips · day-by-day history · strengths & areas |

The composer is a `<select>`, a four-row `<textarea>` and a button. "Recent days" is a short list,
not a history: `submissionWindow()` returns today plus the previous weekday — **two** panels Tuesday
through Saturday.

**Monday is the exception and it is the sizing case.** Friday, Saturday and Sunday all have Monday as
their next weekday, so all three stay inside grace until Monday night and `targetDates` carries
**four** entries (`submission-window.test.ts:30`). Home is therefore roughly 940px most days and
~1340px on a Monday, against a 1280px viewport.

Either way the scan — greeting, ribbon, counts, streak, ~290px — sits above the fold, and the work
sits below it. A Monday costs one screen of scroll through content the student is there to act on.
That is the correct trade: a third route would cost a click **every** day to save scrolling on one.

**This is the cheaper decision and it removes risk.** Moving the composer off home would have put a
student's daily action one click deeper, and daily submission is **SC-4**, the must-ship. It also
means **§8.2 is not reversed** — that section places the composer "immediately below" the ribbon,
which is exactly what stays. The only deviation left is the feedback band moving off home.

**Why feedback goes to My progress rather than its own page:** `strengthsAndWeaknesses` is `null` for
every student in this release — the spec says so outright, because **O-5** blocks the AI provider
decision and no evaluation exists. A top-level destination whose only content is an empty state
teaches the student the app is empty. It belongs with the history it describes.

**Rejected** (ADR-0031): three pages with `/daily` — content does not fill it, and it deepens SC-4's
path; four pages with a separate Feedback route — the same objection, twice over; leaving feedback on
home — home is then three unrelated bands and the history page has no reason to exist.

**`/my-month` → `/my-progress` is a route rename, not a label change.** FR-29 defines this page as
"own submission history, programme progress … and the current strengths-and-weaknesses summary" —
"progress" is the only word covering all three. It touches `sidebar.tsx`, the page directory,
`test/my-month-page.test.tsx` and the student e2e spec. `typedRoutes: true` fails the **build** on any
path missed, which is the good kind of failure — but note `pnpm typecheck` alone will not catch it
(see Testing).

### D4 — The streak chip is month-scoped, and its denominator is days elapsed

The chip reads **"12 of 14 days submitted"**. It names no window.

**It cannot say "days in a row."** `StudentDashboard.days` carries "every required day in the
**current cycle**" and nothing earlier. A client-derived run therefore resets to zero on the 10th of
every month — a student with a 40-day streak would be told they have none. Not fixable client-side,
and this slice adds no API surface.

**The denominator is required days *elapsed*, not the cycle total.** On day 3 of a 22-day month a
perfect student seeing "3 of 22" reads 14% and feels like failure; "3 of 3" is both honest and
motivating. Derived from `dashboard.days` by counting days whose status has settled.

**It names no window because it does not need to.** The ribbon directly above already renders
`cycleHeading()` — *"Month 3 of 6 · 10 July – 9 August"* — so the context is established one element
up. This also sidesteps the vocabulary problem in D5.

**Weekends cannot enter either side of it,** and this is safe by construction rather than by a filter:
the chip derives from `dashboard.days`, which the spec defines as "every **required** day in the
current cycle". Weekend work is reported separately through `extraAfter` and never appears there. Do
not re-derive the streak from `submissionWindow().targetDates` — that list **does** carry Saturday and
Sunday on a Monday, and a streak built from it would put optional work in a compliance denominator,
contradicting FR-12 and the glossary.

An **absence does not break the streak**. `// ASSUMPTION: O-7` — absence carries no penalty, so a day
excused with a reason is not a lapse. It counts toward neither numerator nor denominator.

FR-30-safe by construction: own data only, no peer, no rank, no score.

### D5 — "Cycle" never appears in student-facing copy

**Cycle** is internal domain vocabulary (the glossary: "a monthly evaluation window, 10th → 9th").
Student copy says **month**, or names the dates. `cycleHeading()` already gets this right.

**Two live strings break it today.** Pre-existing, fixed here because this slice rewrites both:

| File | Current | Becomes |
|---|---|---|
| `student-today.tsx:225` | "No evaluation yet — your first summary appears after your **cycle** closes." | "…after your **month** closes." |
| `my-month/page.tsx:123` | "Nothing recorded this **cycle** yet." | "Nothing recorded this **month** yet." |

Also in this pass: `cycleHeading()` renders date ranges through `formatCivilDateLabel`, which
includes weekday names — producing *"Month 3 of 6 · Friday 10 July – Saturday 9 August"*. The
weekdays are noise on a month boundary and are dropped **from this one line only**. Every other call
site keeps them: `formatCivilDateLabel` is correct everywhere a *single* day is named, which is what
§11's copy voice asks for.

### D6 — Expressive behaviour is opt-in, and named by behaviour

Every new treatment is a prop on the existing shared component, defaulted off. The mentor's
rendering is unchanged because the default path is unchanged.

**Props are named after what they do — never after who uses them.** No `studentMode`, no
student-scoped CSS, no student-only tokens. The mentor surfaces are due their own redesign on a later
branch; anything named or scoped "student" would have to be unpicked first.

| Component | Addition | Default |
|---|---|---|
| `EmptyState` | optional `icon` + CTA slot | none — renders exactly as today |
| `CycleRibbon` | `celebrate` | `false` |
| `StatusPill`, `CountsRow` | **nothing** | status is semantic |
| `Panel` | **nothing this slice** | see below |

`Panel` gains no `elevated`/`tone` prop. §5 already couples `sunk` to density ("rhythm **is** the
density signal"), and a third surface mode with no stated job is decoration. If the greeting band
needs a distinct surface it gets one locally, and a prop is proposed when a second caller exists.

**Rejected** (ADR-0032): a scope attribute on the student layout plus CSS descendant rules — makes a
component's appearance depend on an invisible ancestor and is untestable in
`test/ui-primitives.test.tsx`, which renders primitives in isolation; separate student-only
components — violates §9's "one button vocabulary across every screen" and doubles the surface to
maintain; making the treatments always-on — changes the mentor view, which this slice's whole premise
forbids.

### D7 — No student accent token

The direction called for a new accent, scoped to student surfaces, with a dark re-tune and its own
verified pairs.

**Dropped.** Once `--primary` *is* the brand cerulean, the primary button already carries the warmth
the accent was for. A second bright colour has no job description, and it is the most expensive item
in the slice — a scoped token needs its own pairs in both themes, doubling D2's matrix for a surface
that has no use for it. It would also be precisely the thing blocking the later mentor redesign (D6).

Folded into ADR-0030 as a rejected alternative rather than taking its own ADR.

### D8 — The greeting lives in the page, not the frame

A greeting band replaces `<PageTitle>Today</PageTitle>` on `/`: time-of-day salutation plus the
Colombo civil date.

It is rendered **by the page**, not by `Topbar` or `AppFrame`. The frame is shared with the mentor,
and §6 fixes the topbar's contract at "brand and name, nothing else". Putting a greeting there would
change the mentor's frame and reopen a settled decision.

**Both halves resolve in Asia/Colombo, and neither comes from the browser.**

- The **date** is `dashboard.today` — the server's current Colombo civil date, which the spec says is
  supplied precisely "so the interface can ring today on the ribbon without deriving a
  timezone-sensitive date in the browser".
- The **salutation** needs an hour, which `today` does not carry. It is derived server-side from
  `new Date()` formatted through `Intl.DateTimeFormat` with `timeZone: "Asia/Colombo"` — the same
  pattern `student-today.tsx`'s three existing formatters already use. This is **not** "the server's
  local timezone": the zone is named explicitly, which is the rule (§12, and `CLAUDE.md`'s time
  handling).

A `<p>` is a Server Component here, so both are evaluated at request time and no clock reaches the
client. Do not reach for `useEffect` or `new Date()` in a client component to get a "live" greeting —
it would render one zone on the server and another in the browser, and hydrate mismatched.

### D9 — One gradient, on the greeting band, clamped 215–240°

A blue→teal gradient drawn from the heart, as a background on the greeting band only.

- **Clamped to 215–240°.** The real heart runs to 168.6°, inside the `--st-ok` band. The clamp is
  load-bearing, not stylistic.
- **No gradient text, ever.** §2 bans it and it cannot be contrast-verified — a ratio against a
  gradient has no single value.
- Any text over the band is measured against **both** stops, which enter D2's matrix as ordinary
  pairs.

**It ships as two tokens, not a literal.** The repo's standing convention is that every colour
resolves through a token — no hex literal, no Tailwind colour utility, anywhere in `apps/web`. A
gradient written inline would be the first exception, and it would not re-theme. The risk the
original "not a token" instinct was guarding against — reuse with no rules — is handled by naming
instead: `--greeting-from` / `--greeting-to` cannot plausibly be read as general-purpose, and §3.3
records them as belonging to that one element.

Measured, both themes, with the real text colours that sit on the band:

| Token | Light | Dark | `--ink` on it | `--ink-muted` on it |
|---|---|---|---|---|
| `--greeting-from` (hue 253.4, matching `--primary`) | `#e4f0ff` | `#1c2f45` | 14.27 / 12.27 | 5.21 / 5.87 |
| `--greeting-to` (hue 225) | `#def2fb` | `#0c3340` | 14.26 / 12.11 | 5.21 / 5.79 |

Both land inside the 215–240° clamp at the far end and on `--primary`'s own hue at the near end, so
the band reads as the brand colour opening out, not as a second palette.

**They go inside the `dark-tokens` markers**, which raises `theme-tokens.test.ts`'s declaration count
from **13 to 15** and adds two rows to §3.3's table. That is the correct place: outside the markers
they would escape the byte-identity check, and two un-checked copies of a themed value is exactly the
drift that check exists to prevent.

The band occupies roughly 80px of a ~940px page — about 9%, inside §3's "accent ≤10% of surface".

### D10 — Deferred and out of scope

**The sparkline is deferred.** A student has no per-day numeric — only a categorical status — so a
sparkline is the ribbon again at lower resolution, duplicating §7's signature element on the page
directly beneath it. The "Month N of 6" pips deliver the programme-position win instead, which
nothing currently renders visually.

**Mentor day-notes are out of scope.** `DayRecordUpsert.note` exists (FR-19, 500 chars, any day) and
`DaySummary` — what `/me/days` returns — is `additionalProperties: false` with no `note` field, so
nothing a mentor writes reaches a student. Routing it through would be an API change this slice does
not make, and a consent question besides: the field is labelled "Note (optional)" with nothing
indicating a student reads it, so notes already written were written privately. **Being taken to the
stakeholder on a separate branch** — deliberately not logged as an open point here.

---

## Implementation

### 1. Tokens and the gate

`app/globals.css` — four values (D1), both dark blocks. Update the `:root` comment, which currently
reads "a placeholder indigo until the brand hex arrives" and names the old fence.

`test/theme-tokens.test.ts` — the 60-pair matrix (D2). Parses `globals.css`; asserts both themes.
Ships with evidence of a red run.

**Order matters: the gate lands first, in its own task, against the current tokens.** It must be
shown green on today's palette and red on a broken one *before* the colour changes, or it proves
nothing about the change it exists to verify.

### 2. The student home

`app/(app)/student-today.tsx`
- Greeting band replaces `PageTitle` (D8), with the gradient (D9).
- Streak chip beside `CountsRow` (D4).
- Composer, recent days and absence all stay exactly where they are (D3).
- Strengths band **removed** — moves to §3.
- Empty-state copy fixed (D5).

`app/(app)/entry-composer.tsx` + `entry-actions.ts`
- `submitEntry` returns `{ ok: true }` on success instead of `null`, and the composer renders
  **"Submitted."** via `role="status"` in `--st-ok`.
- This mirrors `saveDayRecord` in `review/[studentId]/review-actions.ts:91` and its consumer at
  `day-record-form.tsx:130` exactly — established pattern, not a new one. The mentor side already
  carries the comment explaining why `null` is wrong here: *"resolving to nothing here would look
  identical to the pre-fix bug."*
- `markAbsent` and `removeAbsence` keep returning `null` on success: the absence state is **visibly**
  different afterwards (the panel re-renders as "Marked absent — …"), so silence is not ambiguous
  there. Only the entry submission is silent today.

`components/cycle-ribbon/cycle-ribbon.tsx` + `globals.css`
- `celebrate` prop (D6), off by default; the student instance sets it.
- A gentle overshoot on the day mark. The remount machinery already exists — the `<ol>` is keyed on
  the marks it draws, precisely so a CSS animation replays after a submission.
- `prefers-reduced-motion: reduce` → instant, via the existing block at `globals.css:336`.
- §10 budgets the load stagger at ≤250ms total; the celebration is a **separate moment** and must not
  extend it.

### 3. My progress

Rename `app/(app)/my-month/` → `app/(app)/my-progress/`; update `sidebar.tsx`'s
`STUDENT_DESTINATIONS`, `test/my-month-page.test.tsx`, and the student e2e spec.

- "Month N of 6" as pips (D10) — derived from `programmeMonths` and `cycle.seq`, both already on the
  dashboard. **`seq` can be `null`** for a mid-cycle joiner (FR-27); `cycleHeading()` already handles
  all three branches and the pips must render nothing rather than "Month null of 6".
- Strengths & areas band arrives from home.
- Empty-state copy fixed (D5).

### 4. Shared primitives

`components/ui/empty-state.tsx` — optional `icon` and CTA slot, both omitted by default.

No change to `status-pill.tsx`, `counts-row.tsx`, `panel.tsx`, `button.tsx`.

---

## Documentation to update

| File | Change |
|---|---|
| `docs/design-system.md` §3.1, §3.3 | The four token values and their measured ratios |
| §3.4 | "The Bistec slot" — the placeholder is filled; keep the hue constraints, record the new hue |
| §8.2 | The student home gains a greeting and a streak; the strengths band moves to My progress |
| §10 | The submit celebration, as an addition to the existing "submission lands" moment |
| §13 | **Close** the "Bistec brand colour" row |
| §14 | Add ADR-0030, 0031, 0032 |
| `docs/adr/0030-…` | Brand colour, its gate, and the rejected accent (D1, D2, D7) |
| `docs/adr/0031-…` | Two student pages; feedback with the history (D3) |
| `docs/adr/0032-…` | Opt-in expressive props, named by behaviour (D6) |
| `handoff.md` §2a | A row for this slice, following the UI-follow-up precedent (PRs #13–#17) |

---

## Testing

**`pnpm typecheck` is not sufficient for `apps/web`, and is not trustworthy without a preceding
build.** The route rename in §3 makes this acute: `typedRoutes` writes its route union to
`.next/types/routes.d.ts` from **`next build`**, `apps/web/tsconfig.json` includes that file, and
nothing invalidates it. A stale copy produces `TS2322: Type '"/my-progress"' is not assignable to
type 'Route'` against code that is entirely correct. **Rebuild before believing any `Route`
assignability error, and never fix one by casting.**

Required for this slice:

| Check | Why |
|---|---|
| `pnpm --filter @irp/web build` | The only thing that validates `typedRoutes` after the rename. Pass `AUTH_DEV_BYPASS=false` locally — `next build` sets `NODE_ENV=production` and `.env.local` would otherwise trip the guard, correctly |
| `pnpm --filter @irp/web test` | Unit + the new contrast matrix |
| `pnpm lint` · `pnpm typecheck` | Repo-wide |
| Playwright, `workers: 1` | `student-flows.spec.ts` and `dashboard-flows.spec.ts` both touch the renamed route. **Do not raise `workers`** — `fullyParallel: false` orders tests within a file only, and the suites share one database |

New coverage:

- 60-pair contrast matrix, both themes, parsed from `globals.css` (D2) — **plus a recorded red run**.
- `EmptyState` renders identically with no `icon`/CTA — the opt-in default (D6).
- `CycleRibbon` renders identically with `celebrate` unset (D6).
- Streak: zero submissions, a full month, and a **mid-cycle joiner with `seq: null`** (D4).
- Streak denominator counts elapsed days, not cycle length (D4) — the regression that makes "3 of 22"
  appear.
- Streak on a **Monday**: no weekend day reaches either side of it, and an absence does not break it
  (D4). Monday is the only day whose submission window carries weekend dates, so it is the case a
  wrong implementation passes every other day of the week.
- `submitEntry` returns `{ ok: true }` and the composer shows "Submitted." (§2).
- No student-facing string contains "cycle" (D5).

**Every database test creates its own rows.** The `apps/api` suites `TRUNCATE` the `User` table, and
Vitest orders files by cached duration then file size — never filename.

---

## Risks

| Risk | Handling |
|---|---|
| The colour swap silently breaks a pair nobody measured | D2 lands **first**, in its own task, green on the current palette |
| Two pairs sit at 101% of floor and are unrelated to this slice | They are in the matrix. If either goes red, it is a real pre-existing defect surfacing — fix it, do not relax the floor |
| The route rename misses a reference | `typedRoutes` fails the **build**. The build is in the required set precisely for this |
| Celebration motion reads as noise on a dense ribbon | Opt-in, student instance only; reduced-motion honoured; ≤250ms load budget unchanged |
| A reviewer reads the gradient as reintroducing §3.2's rejected teal | D9 states the distinction: that rejection concerned a **status colour adjacent to `--st-ok` in a dense ribbon**, not a decorative band — and the 215–240° clamp keeps it out of the fenced hue range regardless |
| The streak reads as a score and brushes FR-30 | Own data only, no peer, no rank, no number that ranks. Wording is a count with its denominator, never a rate or a grade |

---

## Open items carried

| # | Effect on this slice |
|---|---|
| **O-5** | AI provider undecided, so `strengthsAndWeaknesses` is `null` for every student. The feedback band ships as a designed empty state — this is the reason it does not get its own page (D3) |
| **O-6** | Rubric wording — untouched here; no evaluation surface in this slice |
| **O-7** | Absence carries no penalty. `--st-absent` stays neutral slate and the streak must **not** treat an absence as a break |

**Not logged as an open point:** mentor day-notes reaching students (D10). Going to the stakeholder on
a separate branch, by decision.

---

## Non-goals

- Any API or `spec/openapi.yaml` change. The streak is derived from data the dashboard already returns.
- Any change to `StatusPill`, `CountsRow`, or the four status colours.
- Any change to the mentor surfaces. Their redesign is a later branch (D6).
- Mobile or responsive layout. Desktop only, min 1280px (NFR-13).
- Any student-visible score, rank, leaderboard, or other student's data (FR-30).
- A sparkline (D10).
- Mentor notes surfaced to students (D10).
- Real auth / Teams — `feat/entra-auth-cutover`.

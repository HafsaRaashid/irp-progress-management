# Design System — IRP Progress Management

**Status:** direction approved pending sign-off · no code written yet
**Register:** product (design serves the task) — not marketing
**Applies to:** `apps/web` only
**Related:** `CLAUDE.md` · `docs/interview-and-prd.md` (FR-28, FR-29, FR-30, NFR-13)

---

## 1. The thesis

**This system is a register.**

Not a dashboard, not an analytics product. The Academy's real artifact is a roll book: a
row per student, a mark per working day, a page per month. Every hard rule in the domain is
a register rule — weekdays only, one mark per day, a grace window for a late mark, a
distinction between *absent with reason* and *missed*, a page that closes on the 9th.

The interface makes that artifact legible rather than replacing it with generic SaaS
furniture. Where a decision is open, the register answer wins.

**Direction:** warm academic, delivered through colour temperature, surface hierarchy,
spacing rhythm and motion — carried on a geometric sans with monospaced figures.

**Scene sentence** (the basis for light-default): *a mentor in a Colombo office at 9:40am,
bright tropical daylight through the window, checking who has submitted before standing up
for the daily check-in.*

---

## 2. What this deliberately is not

Recorded so these don't get reintroduced later as "improvements."

| Rejected | Why |
|---|---|
| Cream / parchment / `#F4F1EA` body background | The single most saturated AI-design default. "Warm academic" is delivered by accent, surface tint and type — **not** by tinting the canvas beige. Stripe is warm on a pure-white canvas; so is this. |
| Crimson as the brand primary | The palette seed suggested it. Rejected: red already means **missed** here. Colliding the brand colour with the most alarming status in a status-legibility system is a usability fault, not a style choice. The seed's hue survives — reserved exclusively for `missed`. |
| A row of three identical stat cards | The hero-metric template. FR-28's three figures are carried by the cycle calendar (§7) instead, which shows the same numbers plus the shape of the whole cycle. |
| Red for `absent` | Absence is recorded with a reason and carries **no** score penalty (`// ASSUMPTION: O-7`). Colouring it as a fault would contradict the policy the system implements. `absent` is neutral slate. |
| A sixth status colour for `extra` | Tried and measured. A teal at hue 200 lands within **1.01:1 luminance** of the `ok` green at hue 155 — indistinguishable for a colour-vision-deficient user with the two marks adjacent in a dense ribbon. No lightness in the usable range separated them adequately, because both are mid-luminance hues. Extra is also not a compliance *outcome*, so it does not belong in the compliance ramp. **Distinguished by form instead** — see §3.2. |
| Charts in v1 | Deferred. Numbers, status and the calendar carry the dashboard. Revisit once real data exists. |
| Border-radius above 16px, gradient text, glassmorphism, side-stripe borders, decorative grid backgrounds | House bans. |

---

## 3. Colour

OKLCH throughout. Strategy: **restrained** — tinted neutrals plus one accent, accent ≤10% of surface.

Every pair below was verified with a WCAG contrast script against the sRGB conversion.
**35 pairs across both themes pass; every token is in gamut.**

### 3.1 Light (default)

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| `--bg` | `oklch(1 0 0)` | `#ffffff` | Content canvas. Pure white, chroma 0 — no hidden warmth. |
| `--surface` | `oklch(0.976 0.006 272)` | `#f6f7fb` | Panels, sidebar, table header. Second neutral layer. |
| `--surface-sunk` | `oklch(0.988 0.004 272)` | `#fafbfe` | The dense roster zone. |
| `--line` | `oklch(0.912 0.010 272)` | `#dfe2e9` | Decorative hairlines, table dividers. No contrast requirement. |
| `--line-strong` | `oklch(0.64 0.015 272)` | `#898c96` | **Control borders** — inputs, selects, checkboxes. Meets 1.4.11 at 3.37:1. |
| `--ink` | `oklch(0.24 0.022 272)` | `#1b1f2a` | Primary text — 16.48:1 |
| `--ink-muted` | `oklch(0.50 0.018 272)` | `#5f636e` | Labels, secondary text, placeholders — 6.01:1 |
| `--primary` | `oklch(0.45 0.14 272)` | `#3c4ba2` | **Bistec slot.** Indigo ink. Primary actions, selection, focus — 7.71:1 |
| `--primary-weak` | `oklch(0.95 0.022 272)` | `#e9eefe` | Selected rows, active nav, primary-tinted fills. |
| `--brand-card` | — | `#ffffff` | The card behind the Bistec Hearts Academy logo. **Theme-invariant** — see below. |

`--brand-card` is the only token that is **identical in light and dark**, by never being
overridden. **Why:** the brand lockup is a supplied asset whose own internal contrast is not
ours to re-verify, and it carries near-black text on a light field — a card that followed the
theme would put that wordmark on `#1c1e23` and erase it. It therefore sits outside the
`dark-tokens` markers in `globals.css`, and `apps/web/test/theme-tokens.test.ts` enforces that.
It is **not** a general-purpose surface — it exists for the brand card and nothing else.

**Derivation of the two brand assets** (`apps/web/assets/hearts-academy-{mark,lockup}.png`, from
the supplied `hearts-academy.png`, 1080×1031 RGBA with an **opaque** near-white field —
`(248,249,250)`, not `#ffffff` and not transparent). A plain rectangular `extract()` of the mark
**cannot work**: the heart is an L-shaped silhouette (two circles above a diagonal paddle) and
"BISTEC" sits in the notch of that L, so every rectangle wide and tall enough to hold the whole
heart also holds part of the "B" — do not "simplify" the mark back to a rectangular crop, that
regresses this defect. `hearts-academy-mark.png` is instead an 8-connected flood-fill mask (seed at
pixel `(300,400)`, inside the paddle; background threshold `|Δr|,|Δg|,|Δb| ≤ 8` from the field
colour), bbox `104,106`–`610,546`, padded 10px on every side and composited onto a **transparent** canvas — never
the source's own field colour — before a `fit:"contain"` resize to 64px. `hearts-academy-lockup.png`
keeps the whole asset (resized to 320px wide) but runs the *same* field threshold over the whole
image first: the field is opaque, and 16px of `--brand-card` white around an opaque near-white
asset reads as a faint rectangle in both themes, since the card never re-themes. Both files are
transparent-background PNGs for this reason. The lockup additionally requires
`png({ palette: true })` — a plain (non-palette) encode measured **~50 KB against the 40 KB
ceiling**; without `palette: true` it silently blows the budget.
Anything else needing a fixed light surface is a new design decision, not a reuse of this.

### 3.2 Status vocabulary

Load-bearing. These are the system's core semantic language.

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--st-ok` | `#267b4c` · 5.22:1 | `#65c98c` · 9.24:1 | Submitted on time |
| `--st-late` | `#9f5c0c` · 5.24:1 | `#eeac53` · 9.54:1 | Submitted in the grace window. Burnt ochre — accepted, flagged, not punished. |
| `--st-absent` | `#6d717e` · 4.86:1 | `#9a9eaa` · 7.03:1 | Explicitly marked absent with a reason. **Neutral by design.** |
| `--st-missed` | `#be2132` · 6.09:1 | `#ed7473` · 6.58:1 | No entry, no absence, grace window closed. Final. The only true red. |
| `--st-review` | `--primary` | `--primary` | In Review |
| `--st-evaluated` | `--ink` + lock glyph | `--ink` + lock glyph | Evaluated — terminal, locked |

There is no `rejected` token. There is no rejected state.

### Extra — distinguished by form, not colour

Weekend work (FR-33) is **not** a compliance state and gets **no status colour**. It is drawn
differently instead:

- **In the calendar (§7, current)** — a full-width weekend cell in `--ink-muted` carrying a `+`
  glyph, distinguished by form from a compliance-marked weekday cell rather than by colour.
- **In the ribbon (historical — superseded by the calendar, ADR-0030)** — a half-width slot in
  `--ink-muted` carrying a `+` glyph, inserted between the Friday and Monday it sits between.
  Narrower than a required day, so the weekday rhythm still read at a glance.
- **In the roster** — a count, not a pill: `+2 extra`. A student can have several extra days
  in a cycle, which a single status pill cannot express.

This is deliberate on three grounds. Extra is a different *kind* of thing from
submitted/late/absent/missed, so putting it in the same ramp would misrepresent it. Form
survives colour-vision deficiency where a fifth hue does not. And the compliance palette is
already carrying four semantic colours — a fifth degrades all of them.

### 3.3 Dark

Light is the default; dark is supported. Canvas is chroma-0 near-black — surfaces lift
toward indigo, they do not warm.

| Token | OKLCH | Hex |
|---|---|---|
| `--bg` | `oklch(0.18 0 0)` | `#121212` |
| `--surface` | `oklch(0.235 0.010 272)` | `#1c1e23` |
| `--surface-sunk` | `oklch(0.205 0.008 272)` | `#16171b` |
| `--line` | `oklch(0.32 0.012 272)` | `#313339` |
| `--line-strong` | `oklch(0.52 0.018 272)` | `#656974` |
| `--ink` | `oklch(0.965 0.004 272)` | `#f2f3f6` |
| `--ink-muted` | `oklch(0.74 0.014 272)` | `#a7aab4` |
| `--primary` | `oklch(0.72 0.12 272)` | `#8a9ff0` |
| `--primary-weak` | `oklch(0.30 0.045 272)` | `#262c45` |

Status colours are **re-tuned, not reused** — see §3.2.

Dark is user-reachable as of ADR-0021, selected by `data-theme` on `<html>`:

- `data-theme="dark"` forces dark; `data-theme="light"` forces light; **no attribute means
  follow the OS**.
- The CSS applies three rules, in this order: the light `:root` first (the base), then
  `@media (prefers-color-scheme: dark)` scoped with `:not([data-theme="light"])` (follow the
  OS, unless the user explicitly chose light), then `:root[data-theme="dark"]` (an explicit
  dark choice). The load-bearing part is the `:not([data-theme="light"])` guard on the second
  rule — that is what lets an explicit light choice suppress a dark OS; deleting it would make
  OS-dark plus an explicit light choice render dark, a real bug. The order of the second and
  third rules is **not** load-bearing: both selectors carry equal specificity (`:root` plus one
  pseudo-class or attribute selector each), so source order decides an outcome only when *both*
  match at once — OS-dark **and** `data-theme="dark"` together — and in that case the two blocks
  are identical (see the parity test below), so the result is the same regardless of which one
  wins. Rule three coming after rule two is therefore defensive rather than load-bearing: it
  costs nothing and only matters if the two blocks are ever edited to legitimately diverge.
- The token block above is duplicated verbatim in `globals.css`, once inside the media query
  and once under `:root[data-theme="dark"]`, because CSS cannot combine a media query with a
  selector list and this project uses no preprocessor. `apps/web/test/theme-tokens.test.ts`
  keeps the two copies honest — it fails if they ever drift apart.
- Each theme rule also sets the CSS `color-scheme` property (`light` on the base `:root`,
  `dark` in both dark rules) alongside its tokens. This is the one declaration that reaches
  **native** controls — the `type="date"` calendar indicator, scrollbars, `<select>`
  dropdowns — which are drawn by the browser, not by us, and so are not reachable by any
  token. Without it, dark mode paints a dark calendar icon on a dark field. It sits outside
  the `dark-tokens:start`/`:end` markers, since those are asserted to hold exactly the 13
  tokens above.

### 3.4 The Bistec slot

`--primary` is a placeholder pending the actual brand value. To swap: replace the single
`--primary` token, re-derive `--primary-weak` at roughly `L 0.95 / C 0.022` on the same hue,
and re-run the contrast check. Nothing else in the system references a brand colour directly.

**Constraint on any replacement:** the hue must stay clear of 20–70° (red/amber — reserved
for `missed`/`late`) and 140–170° (green — reserved for `ok`).

---

## 4. Typography

Geometric sans for text, monospace for every figure. Pairing works on a genuine contrast
axis (geometric vs. mono), not two similar sans.

| Role | Face | Notes |
|---|---|---|
| UI, headings, body, labels | **Plus Jakarta Sans** (variable, OFL) | Geometric skeleton with warm details — open apertures, soft terminals. Economical enough for a dense roster. Not Inter (the reflex), not Poppins (too wide for tables). |
| All figures and data | **IBM Plex Mono** (OFL) | Scores, streaks, `N of M`, dates, times, day marks, IDs. Academic-technical warmth. |

**Rules**

- Fixed rem scale, not fluid. No `clamp()` on headings — product UI is viewed at consistent DPI.
- Scale ratio ~1.2: `12 / 13 / 14 / 16 / 20 / 24 / 32`.
- Base UI 14px · roster table 13px · prose (AI summaries, entry text) 16px.
- Prose caps at 70ch. Tables may run to full width.
- `font-variant-numeric: tabular-nums` everywhere a figure appears, mono or not.
- Display letter-spacing floor `-0.03em`. Never tighter.
- `text-wrap: balance` on headings; `text-wrap: pretty` on summary prose.
- No display face in labels, buttons or data.

---

## 5. Space, radius, elevation

- **Grid:** 4px base. Scale `4 / 8 / 12 / 16 / 24 / 32 / 48`.
- **Rhythm is the density signal.** The warm zone uses 24–32px padding. The roster uses
  8–12px row padding. That contrast *is* the "warm shell, dense core" decision.
- **Radius:** cards and panels **12px**. Inputs and buttons 8px. Status pills and tags full. Nothing above 16px.
- **Elevation:** borders over shadows. Never `1px solid` and a ≥16px blur shadow on the same
  element. Overlays (dropdown, dialog, toast) may use a single defined shadow at ≤8px blur.
- **Z-index scale:** `dropdown 10 → sticky 20 → modal-backdrop 30 → modal 40 → toast 50 → tooltip 60`. No arbitrary values.

---

## 6. Layout frame

Desktop only, minimum 1280px (NFR-13). No mobile layout is provided or tested. Responsive
behaviour is structural (sidebar collapse below 1440px), never fluid typography.

```
┌────────────────────────────────────────────────────────────────────────┐
│  ❤ Hearts Academy · IRP                              Damian            │  56px  --surface
├────────────┬───────────────────────────────────────────────────────────┤
│            │                                                           │
│ ▪ Today    │                                                           │
│ ▪ Roster   │                  content · --bg                           │
│ ▪ Review 3 │                                                           │
│ ▪ Cycles   │                                                           │
│ ▪ Students │                                                           │
│            │                                                           │
│ ─────────  ← border-top rule, --line                                   │
│ ▪ Settings │                                                           │
│ ▪ Sign out │                                                           │
│            │                                                           │
│ 216px      │                                                           │
│ --surface  │                                                           │
└────────────┴───────────────────────────────────────────────────────────┘
```

The topbar mark is `BrandMark` (`variant="mark"`) on the theme-invariant `--brand-card` card,
replacing the placeholder diamond a `◆` used to stand in for — see §3.1 and
`apps/web/components/app-frame/brand-mark.tsx`. **The topbar now holds only the brand and the
user's name**: no dropdown chevron, no batch switcher. Every sidebar row carries a hand-drawn
`currentColor` icon before its label (`▪` above is a stand-in for the real glyph — calendar,
table, check-in-circle, circular arrow, two people, sliders, door-with-arrow — see
`apps/web/components/ui/icons.tsx` for the actual set), so the icon column, not just the label,
now carries the active-row colour change.

**`Batch 12 ▾` is gone from this mock, not merely left unbuilt-but-drawn.** The previous version
of this mock showed a switcher in the topbar that was never built and never will be under the
current data model: `User` (`spec/openapi.yaml`) carries no batch, a mentor holds several, and
batch selection already happens per-page via the Roster and Cycles chips (§13 keeps the full
record of that decision — it is not repeated or removed here). Drawing an unbuilt control in a
mock captioned "the app frame" reads as a description of the running app, which it would not be;
now that the topbar's contract is "brand and name, nothing else," showing the switcher here would
directly contradict the sentence above it. If a global batch context is ever built, this mock
gets a third element and §13's entry is closed, not reopened.

Settings sits pinned to the bottom of the 216px column with `mt-auto`, separated from the primary
destinations above it by a `border-top` rule (`--line`) — never appended to the destination list
itself, which would sit it directly under the last primary item instead. **Sign out is pinned
below Settings inside that same divider group** — a peer of Settings, not a stray button loose in
the frame — rather than living in the topbar it occupied before this slice (O-15). Settings
appears on **both** roles' frames: appearance (theme) is a personal preference, not a mentor
privilege. The page it links to gates its own sections rather than the route bouncing a Student
away — Settings shows Appearance to everyone and **Register** only to a mentor (ADR-0022);
**Create batch** lives on Students instead, per **ADR-0023**, which supersedes that part of
ADR-0022's scope.

---

## 7. The signature: the cycle calendar

**The one element this system is remembered by.** It replaces the stat-card row and answers
FR-28 in a single component. As of ADR-0030 (O-17) this is a month-grid calendar, superseding
the cycle ribbon ADR-0003 introduced — the ribbon's own design record stays in `docs/adr/0003-*`
as history, not as the current surface.

A standard 7-column week grid, one row per week the current cycle touches — **every** calendar
day renders a cell, weekday and weekend alike, unlike the ribbon's total omission of empty
weekends. A weekday cell is filled by that day's batch (or, on the student's own view, personal)
compliance, with today ringed and future weekdays drawn as outlines. Leading and trailing days
from the adjacent months fill out the first and last rows, shown dimmed and non-interactive —
they carry no compliance mark, since they fall outside the cycle being viewed.

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│  Batch Aurora · Cycle 2 · Day 12 of 22                                │
│                                                                        │
│   Mon   Tue   Wed   Thu   Fri   Sat   Sun                              │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐                            │
│  │ 6 │ │ 7 │ │ 8 │ │ 9 │ │10 │ │11 │ │12 │   ← dimmed: last month     │
│  └───┘ └───┘ └───┘ └───┘ └───┘ └───┘ └───┘                            │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐                            │
│  │▓13│ │▓14│ │▒15│ │▓16│ │▓17│ │ + │ │   │   ← ring on today (14)     │
│  └───┘ └───┘ └───┘ └───┘ └───┘ └18─┘ └19─┘       + on a worked weekend │
│                                                                        │
│  8 of 10 submitted today          2 late · 1 absent · 0 missed         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
   ↑ --surface, radius 12px, padding 24–32px — the warm zone
```

**A weekend cell renders present, not omitted (FR-12/FR-33).** A grid cannot skip calendar days
the way the ribbon's linear strip could without breaking the week-row structure, so every
Saturday and Sunday gets a cell — marked `extra` (a `+` glyph, distinguished by form not colour,
same reasoning as the ribbon's Extra slot in §3.2) when worked, otherwise blank. **This reopens
ADR-0003 Amendment 1's reasoning about weekend visibility deliberately, not as a regression.**

**Extra days never enter the compliance figures.** The "8 of 10 submitted today" line and the
late/absent/missed counts are computed over required days only (FR-12) — unchanged from the
ribbon.

**Why this over stat cards**

- It is the subject's own artifact — a register page.
- It shows the *shape* of the cycle, not a single day's snapshot. A mentor sees Tuesday's dip.
- It satisfies FR-28 as one element instead of a card grid.
- It serves both audiences from one component: the mentor sees batch compliance per day,
  the student sees their own marks.

**Batch selector (D3, ADR-0030).** The mentor's home shows **one** calendar for a selected
batch, not one stacked per batch — a month-grid is 5-6 rows tall where the ribbon was one row,
and stacking two risked the NFR-13 no-scroll budget. A chip row above the calendar switches the
selected batch, matching the existing pattern on the Cycles page (`aria-current` on the selected
chip); it appears only when the mentor has more than one batch.

**Day mark states:** full (all submitted) · partial (proportional fill) · ochre notch (late)
· slate (absent) · red (missed) · outline (not yet reached) · ringed (today) · a weekend's `+`
(extra) or blank.

**The mentor-only key (ADR-0020) is a known gap, not carried forward.** `RibbonKey` named the
ribbon's eight states on screen; the calendar has no equivalent yet. Every cell still carries a
full text accessible name (§4), so the accessibility floor is not regressed, but the visible
on-screen legend is gone pending a design pass. Flagged here rather than silently dropped —
revisit before the next stakeholder demo if a legend is wanted back.

**A pre-enrolment weekday reads as `future`, indistinguishable from a genuinely not-yet-reached
day, carried over unchanged from the ribbon.** `batchDayMark`'s `enrolled === 0` branch returns
the same outline as a day nobody has reached yet, so a student who transferred out mid-cycle
shows PAST days on the batch calendar as if they had not happened yet, rather than as "no one was
enrolled that day." Pre-existing, not introduced by this ADR, and the spec's own §5 edge case
calls for dimmed pre-enrolment cells specifically — recorded here as a known gap rather than
invented a new visual treatment without design sign-off (whole-branch review finding I-3).

**Weekend extra resolution differs by audience, and this is a real, documented data limit, not
an inconsistency to "fix" by inventing a heuristic.** The batch-level `extraAfter` field names
only the Friday before a worked weekend, one flag per weekend pair — it cannot say whether
Saturday, Sunday, or both were worked, so a mentor's calendar marks both cells of a flagged
weekend identically. The student's own calendar resolves this per day, because `listMyDays`
(unlike the batch aggregate) already returns one row per calendar date with a real status.

**Batch aggregation (unchanged from the ribbon).** A batch day holds a mix of outcomes and the
calendar draws one mark per weekday cell, so precedence is fixed: **missed → late → absent →
partial → ok**, with an outline for a day nobody has reached. The failure outranks the warning,
the warning outranks the excused absence, and `partial` sits below all three because pending
work is an unfinished afternoon, not a problem. Only `partial` is filled proportionally
(`submitted / enrolled`). Implemented once, in `apps/web/lib/ribbon.ts`; a page that re-derives
a mark is a bug.

---

## 8. Screens

### 8.1 Mentor dashboard — FR-28, must-ship (SC-4)

```
┌────────────────────────────────────────────────────────────────────────┐
│  [ cycle calendar — the warm zone, §7 ]                                │
├────────────────────────────────────────────────────────────────────────┤
│  Roster                                     Search  [        ]  Filter │
│  ──────────────────────────────────────────────────────────────────────│
│  Student           Today          Streak   Compliance   Index          │
│  A. Perera         ● Submitted        12       96%       84.2          │
│  N. Silva          ◐ In review         9       91%       78.5          │
│  R. Fernando       ✕ Missed            0       74%       71.0          │
│  S. Jayasuriya     ▲ Late              6       88%       80.1          │
│  K. Bandara        ○ Absent            4       85%       76.8          │
│                                                        ↓ scrolls       │
└────────────────────────────────────────────────────────────────────────┘
```

FR-28's required figures live entirely in the warm zone above the fold at 1280px. The roster
scrolls — permitted, since FR-28 names the summary and counts, not the full roster.

Every status carries **a glyph and a word**, never colour alone.

### 8.2 Student home — FR-29, FR-30

Same calendar, personal marks. The submission box is the primary action and sits immediately
below it. No score, no rank, no other students, anywhere on this surface.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Month 2 of 6 · Cycle 2 · 10 Jul – 9 Aug                               │
│  ▓ ▓ ▓ ▓ ▒ ▓ ▓ ▓ ░ ▓ ▓ ▓ ▓ ▉ · · ·                                     │
├────────────────────────────────────────────────────────────────────────┤
│  Today · Tuesday 29 July                                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ What did you work on today?                                      │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  [ Submit today's update ]        Mark today as absent                 │
├────────────────────────────────────────────────────────────────────────┤
│  Strengths and areas to develop                                        │
│  ...current cycle summary, prose, no score...                          │
└────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Review — FR-18 to FR-20

Daily report as the reviewable unit, entries rolled up. `Submitted → In Review → Evaluated`,
one direction. Evaluated is terminal and visibly locked. No reject control exists anywhere in
the UI.

---

## 9. Components

shadcn/ui on Tailwind, **retuned to these tokens** — shadcn's defaults are the quiet-operator
look this project did not choose. Retuning means radius, spacing scale, type and colour, not
just a primary swap.

Every interactive component ships all seven states: default, hover, focus, active, disabled,
loading, error. Half a component is not a component.

- Skeletons for loading, never a centred spinner.
- Empty states teach the interface. "No entries yet" is a failure; see §11.
- One button vocabulary across every screen.
- Modals are a last resort — exhaust inline and progressive alternatives first.
- No custom scrollbars, no reinvented form controls.

---

## 10. Motion

Restrained, with a few deliberate moments. 150–250ms, ease-out-quart. No bounce, no elastic.

| Moment | Behaviour |
|---|---|
| Ribbon load (historical) | Marks filled left→right, staggered, **≤250ms total** — the register drawing its own marks. **Not carried over to the calendar (O-17):** `CycleCalendar` reuses the same `.ribbon-mark` 160ms rise animation per cell but does not compute a per-cell stagger delay, so a calendar's marks rise simultaneously on load rather than sweeping left-to-right. Documented gap, not a bug — revisit if the delight moment is wanted back. |
| Submission lands | The student's day mark fills. The action visibly enters the register. This is the one delight moment in the system. |
| Review state change | 180ms crossfade on the status pill. |
| Everything else | 150ms, state only. |

`prefers-reduced-motion: reduce` → all of the above become instant or a plain crossfade.
Content is never gated behind a reveal transition: default state is visible, motion enhances it.

---

## 11. Copy

Plain verbs, sentence case, active voice. An action keeps its name through the whole flow —
"Submit today's update" produces "Submitted."

| Situation | Write | Not |
|---|---|---|
| Dashboard count | "8 of 10 submitted today" | "Submission rate: 80%" |
| Student, nothing yet | "No entry for today yet. You can still submit for Monday until 5:00 pm tomorrow." | "Nothing here" |
| Late | "Submitted late — Monday's entry, filed Tuesday." | "⚠ LATE" |
| Absent | "Marked absent — medical." | "Absent (unexcused?)" |
| Missed | "Missed — the grace window closed on 22 July." | "Failed to submit" |
| Wrong-date attempt | "You can submit for today or the previous working day. Older dates are closed." | "Invalid date" |
| Evaluated | "Evaluated on 9 August. This cycle is closed." | "Locked 🔒" |

Errors don't apologise and are never vague about what happened. Empty states are invitations.

---

## 12. Accessibility floor

Non-negotiable, verified rather than assumed.

- **Status is never colour alone.** Glyph plus text label, always. Load-bearing in a system whose whole job is status.
- Body text ≥4.5:1, non-text UI boundaries ≥3:1. Verified above for both themes.
- Placeholder text meets 4.5:1 — it uses `--ink-muted`, not a lighter grey.
- Visible keyboard focus: 2px `--primary` ring at 2px offset. Never `outline: none` without a replacement.
- Full keyboard path through submit and review — the two flows that matter.
- Roster table uses real `<table>` semantics with scope'd headers.
- `prefers-reduced-motion` honoured throughout.
- Timestamps render in Asia/Colombo with the zone named in the UI, never bare local time.

---

## 13. Open items

| # | Item | Effect |
|---|---|---|
| — | **Bistec brand colour** | `--primary` is a placeholder. One-token swap; see §3.4 for hue constraints. |
| — | **§6's topbar batch switcher is not built** | `Batch 12 ▾` would have appeared in the §6 frame with no data behind it: `User` in `spec/openapi.yaml` carries no batch, and a mentor holds several, so one name in a global slot would be wrong for the primary audience. Batch selection is per-page instead, via the Roster and Cycles chips. Revisit only if a global batch context is ever genuinely needed; it would need a spec change first. |
| O-6 | Rubric criteria wording | Blocks the evaluation surface layout — five criteria need real labels before that screen is designed. |
| O-7 | Absence/lateness penalty | `--st-absent` is neutral on the stated assumption. If leadership rules that absence penalises the score, this token and its copy change. |
| O-5 | AI provider | Blocks every evaluation-output surface. Nothing here depends on it yet. |

---

## 14. Governing ADRs

Each names at least three rejected alternatives:

| ADR | Decision |
|---|---|
| [0001](adr/0001-tailwind-and-shadcn-for-web-ui.md) | Tailwind CSS + shadcn/ui, retuned token-first |
| [0002](adr/0002-light-default-with-dark-support.md) | Light default, dark supported, both contrast-verified |
| [0003](adr/0003-cycle-ribbon-as-fr-28-summary.md) | Cycle ribbon as the FR-28 summary surface — **superseded by 0030** |
| [0020](adr/0020-collapsed-ribbon-key-on-the-mentor-dashboard.md) | A collapsed, mentor-only key for the cycle ribbon — historical; the calendar has no equivalent key yet (§7) |
| [0021](adr/0021-theme-persistence-by-cookie.md) | Theme persistence by server-readable cookie; dark becomes user-reachable (§3.3) |
| [0030](adr/0030-month-grid-calendar-over-cycle-ribbon.md) | Month-grid calendar over the cycle ribbon for the FR-28/29 summary surface (§7) |

Changing anything in §3–§7 means amending the ADR that governs it, not just this file.

# ADR-0030: Bistec cerulean as the brand colour

## Status
Accepted (2026-10-05). Fills the slot `docs/design-system.md` §3.4 describes and closes the
**Bistec brand colour** row in §13. Records **D1**, **D2** and **D7** of
`docs/superpowers/specs/2026-10-05-student-surface-refresh-design.md`. Relates to
[ADR-0002](0002-light-default-with-dark-support.md) — every value here is measured in both themes.

## Context
`--primary` has been `#3c4ba2` (`oklch(0.45 0.14 272)`) since the design system was written, listed
in §3.1 as the **Bistec slot** and in §13 as "a placeholder. One-token swap; see §3.4 for hue
constraints." While the slot stays open the product renders in a colour nobody chose.

The direction for this slice named `#1C8FD1` ≈ `oklch(0.55 0.13 238)`, sampled by eye from
`apps/web/assets/hearts-academy-lockup.png`. Four things in that direction were **wrong on
measurement**, and all four are recorded here so they are not reintroduced. Everything below was
measured against the real assets and the real stylesheet, not reasoned about.

### `--primary` is drawn as text, so it carries 4.5:1

This is the whole reason the bright blue fails, and it is the single fact worth carrying forward.
`--primary` is not only a fill. It renders as **text** in four places:

| Where | File |
|---|---|
| `.nav-item[data-active] { color: var(--primary) }` | `globals.css:251` |
| `.chip[aria-current="page"] { color: var(--primary) }` | `globals.css:280` |
| `.text-link:hover { color: var(--primary) }` | `globals.css:292` |
| `StatusPill`'s `--st-review` → "· In review" | `status-pill.tsx` |

Four text call sites means WCAG AA's **4.5:1** floor applies to this token, not the 3:1 non-text
floor of 1.4.11. Measured against `--bg`:

| Candidate | OKLCH | vs `--bg` | |
|---|---|---|---|
| `#1C8FD1` (the eyeballed value) | `0.622 0.137 241` | **3.56:1** | fails |
| `#0188c5` (the logo's mid blue) | `0.596 0.133 239` | **3.94:1** | fails |
| `oklch(0.55 0.13 238)` as written | — | out of sRGB gamut; clamps to 4.42:1 vs `--surface` | fails |

The instinct was right and the lightness was not. A second constraint compounds it: at hues 232–244
with chroma 0.13, **almost nothing in the usable lightness range is in sRGB gamut at all**.

### The logo is a gradient, not a colour

Sampling `apps/web/assets/hearts-academy-mark.png` (8-connected clusters, alpha ≥ 200, quantised to
16 levels per channel) shows the heart runs **253° → 223°**, with a teal tail:

| Hex | Share of mark | OKLCH |
|---|---|---|
| `#045aa9` | **15.2%** | `0.469 0.145 253.6` |
| `#0462ae` | 14.3% | `0.492 0.143 251.4` |
| `#0367b3` | 12.5% | `0.507 0.144 250.4` |
| `#0389c4` | 7.1% | `0.598 0.131 237.8` |
| `#01a7d8` | 4.4% | `0.680 0.132 227.9` |
| `#12d7a6` | 0.3% | `0.782 0.155 **168.6**` |

There is therefore no single "brand blue" to adopt, and the bright end of the gradient is the end
that fails the text floor. Taking the gradient's **deep end** where ink is needed is faithful to the
asset, not a compromise with it — and it is the single largest cluster in the mark.

That last row is also why any gradient drawn from the heart needs a clamp: `168.6°` is **inside**
the 140–170° band §3.4 reserves for `--st-ok`. A gradient that followed the heart honestly to its
end would run into the status-green fence.

### The wordmark green is not fenced out — it is merely too close

The direction stated the brand green "collides with the 140–170° fence". It measures **135.3°**
(`#163301`, `oklch(0.287 0.083 135.3)`), which is **outside** it. The conclusion stands — the green
stays in the logo and becomes no token — but the correct reason is separation, not the fence: 135°
sits ~20° from `--st-ok` at 155° at comparable lightness, which is not enough separation for a
decorative green beside a semantic one. The reason is recorded in its correct form because a wrong
reason on file is the kind of thing that gets re-derived into a bad decision later.

### Nothing in the repository computes luminance

§3 claims "35 pairs across both themes pass WCAG AA". It is a one-off claim with no enforcement
behind it — verified by grep across every `.ts`, `.tsx`, `.mjs` and `.js` outside `node_modules`.
`apps/web/test/theme-tokens.test.ts` asserts only that the two dark token blocks stay byte-identical
and that `--brand-card` is never overridden. It even names the risk in a comment — *"a copy that
drifts breaks AUDITED contrast silently"* — and then guards only against the two copies drifting
**from each other**, not against either being wrong. Edit a colour consistently in both blocks and
every test in that file stays green.

So a colour swap made against §3's prose would be unverified, in precisely the way the swap this
decision makes needs verifying.

## Decision
`--primary` becomes the cerulean sampled from the mark's deep end. Four tokens change;
`--primary-weak` is re-derived per §3.4's instruction ("re-derive `--primary-weak` at roughly
`L 0.95 / C 0.022` on the same hue").

| Token | From | To | OKLCH |
|---|---|---|---|
| light `--primary` | `#3c4ba2` | **`#045aa9`** | `0.469 0.145 253.6` |
| light `--primary-weak` | `#e9eefe` | **`#e5f0fd`** | `0.950 0.022 253.4` |
| dark `--primary` | `#8a9ff0` | **`#6da8ee`** | `0.720 0.120 253.5` |
| dark `--primary-weak` | `#262c45` | **`#1d2f44`** | `0.300 0.046 253.4` |

`#045aa9` is that deep end: the largest single cluster in the mark, **15.2% of its opaque pixels**.

Measured, both themes:

| Pair | Light | Dark | Floor |
|---|---|---|---|
| `--primary` on `--bg` | 6.91:1 | 7.57:1 | 4.5 |
| `--surface` on `--primary` (`.btn-primary` label) | 6.45:1 | 6.74:1 | 4.5 |
| `--primary` on `--primary-weak` (active nav, chip) | 5.99:1 | 5.50:1 | 4.5 |

Hue **~253°** is clear of both reserved bands (20–70° for `missed`/`late`, 140–170° for `ok`), in
sRGB gamut, and the **same hue in both themes** (253.6 light / 253.5 dark, within rounding; the two
`--primary-weak` tokens sit at 253.4) — matching the existing system, where the light and dark
primaries share hue 272.

**`#045aa9`, not `#035baa`.** The two differ by ΔL 0.003 and ΔH 0.27° — perceptually the same
colour, 0.09:1 apart in contrast — but only one supports the claim made for it. `#045aa9` is the
**mark's** largest cluster at 15.2%; `#035baa` is the **lockup's** third at 9.5%. A draft of this
slice's spec shipped the lockup value while citing the mark's provenance, and a draft of this ADR
repeated the confusion on `#0188c5` below. Recorded here, in the durable artifact rather than only
in the per-slice spec, because the two are indistinguishable by eye and nothing else would stop the
swap being made back. **The two assets are sampled separately — never quote a share from one against
a hex from the other.**

The dark block is duplicated in `globals.css`, once inside `@media (prefers-color-scheme: dark)` and
once under `:root[data-theme="dark"]`, because CSS cannot combine a media query with a selector list
and this project has no preprocessor. **Both copies change.** `theme-tokens.test.ts` already fails
if they drift from each other; that gate works and needs no change.

### The contrast gate is part of this decision
A gate computing WCAG 2.x contrast ratios across the palette is this decision's enforcement arm, and
is recorded here rather than taking an ADR of its own. A gate with no colour to protect is not a
decision, and a colour change with no gate is the condition §3's unenforced claim already documents.

It reads the token values **parsed out of `globals.css`**, never a hand-maintained copy: a second
list is one more thing to drift, and asserting §3's prose table instead would verify the
documentation against itself and never read the shipped stylesheet. It lives in
`apps/web/test/theme-tokens.test.ts` rather than in a standalone `scripts/contrast.mjs` run by hand
— an unrun script is indistinguishable from no script, which is exactly what §3's claim is today —
and in the unit suite rather than in a CI-only step, because colours get edited on a developer
machine.

**30 pairs per theme, 60 in total**, derived from what the code actually renders rather than from
§3's prose, so every pair traces back to a call site. Text pairs carry 4.5:1; control borders, focus
rings and the ribbon's today ring carry 3:1 (WCAG 1.4.11).

All 60 pass under **both** the current and the new tokens, so the gate lands green and this colour
swap does not move it. Two pairs sit at **101% of floor**, and they are why it is worth building:

| Pair | Theme | Ratio | Floor |
|---|---|---|---|
| `--st-absent` on `--surface` | light | 4.55:1 | 4.5 |
| `--line-strong` on `--surface` | dark | 3.03:1 | 3.0 |

Any future nudge to either breaks a real accessibility guarantee, and today nothing would notice.
Per `CLAUDE.md` — *"prove a gate fails before trusting it"* — the gate must be shown red against a
deliberately broken token before it is trusted, and the swap must be shown red against `#1c8fd1`,
the value this decision rejects. A gate never seen to fail is not a gate.

### No student accent token
The direction also called for a second accent, scoped to the student surfaces, with a dark re-tune
and its own verified pairs. It is dropped. Once `--primary` *is* the brand cerulean, the primary
button already carries the warmth that accent was for, so a second bright colour has no job
description. It is folded in below as a rejected alternative rather than taking its own ADR, because
it stops being a live question the moment this decision is made.

## Consequences
- §13's "Bistec brand colour" row is **removed**, not annotated: the slot is filled. §3.4 keeps its
  hue constraints and its swap procedure verbatim, and gains the fact that `--primary` is drawn as
  text, so any replacement carries 4.5:1.
- **Any future brand tweak is a 4.5:1 decision, not a 3:1 one.** That one fact is what made the
  obvious bright blue wrong, and the gate now enforces it instead of a sentence in §3 asking to be
  believed.
- The teal tail at 168.6° is inside the `--st-ok` fence, so any gradient drawn from the heart must
  be clamped short of it. The greeting band's 215–240° clamp exists for that reason and is
  load-bearing, not stylistic.
- The wordmark green stays in the logo and acquires no token, so nothing in the palette needs
  re-checking against it.
- The gate is the first thing in this repository that computes luminance. §3's "35 pairs" stops
  being a claim and becomes 60 assertions on every run.
- The two 101%-of-floor pairs are now visible. Neither floor is relaxed to accommodate them, and a
  future nudge to either fails loudly rather than silently.

## Rejected alternatives
1. **`#1C8FD1` — the cerulean the direction named.** The value this slice started from, and the one
   that looks most like the lockup at a glance. Rejected on measurement: **3.56:1** against `--bg`,
   against the 4.5 floor `--primary`'s four text call sites impose. It is not a near miss that a
   slightly darker neighbour fixes, either — at hues 232–244 with chroma 0.13 almost nothing in the
   usable lightness range is in sRGB gamut at all, so the whole neighbourhood is unavailable.
2. **`#0188c5` — the logo's own mid-blue.** Defensible on the strongest possible grounds: it is
   literally in the asset — the largest *blue* cluster in `hearts-academy-lockup.png` at 9.7%,
   behind only the green wordmark's 20.1%. (It is **not** a mark cluster; the mark's 7.1% band is
   `#0389c4`, a different colour. The two assets are sampled separately and their shares are not
   interchangeable — see the note under the decision table.) Rejected for the same defect one step along —
   **3.94:1** against `--bg`, still short of 4.5. Being in the logo does not make a value legible as
   ink, which is the thing being chosen here.
3. **Keep the placeholder indigo.** Zero work, and `#3c4ba2` passes contrast comfortably at 7.71:1.
   Rejected because it leaves §13's open item open indefinitely and ships the product in a colour
   chosen as a stand-in, on surfaces the stakeholder sees. The slot was always going to be filled;
   the only question was whether it was filled with something measured.
4. **A separate student-scoped accent token.** The direction's own proposal: a second bright colour,
   scoped to the student surfaces, re-tuned for dark. Rejected on three counts. It has no job once
   `--primary` is the brand colour — the primary button already carries the warmth it was for. It is
   the most expensive item in the slice, because a scoped token needs its own verified pairs in both
   themes and so doubles the contrast matrix, for a surface that has no use for it. And it is
   precisely the kind of role-scoped thing that would have to be unpicked before the later mentor
   redesign ([ADR-0032](0032-opt-in-expressive-props.md)).
5. **Re-scope `--primary` to fills only, so a lighter blue could be used.** This is the alternative
   that would make `#1C8FD1` viable: if the token were never text, 3:1 would be the floor and
   3.56:1 would pass. Rejected because it is not one edit but a new concept — a second "primary
   text" token would have to be invented and four call sites in `globals.css` rewritten, to carry a
   distinction between brand-as-fill and brand-as-ink that the design system does not have and has
   no other use for. Adding a token so that a rejected colour can be adopted inverts the order of
   the decision.

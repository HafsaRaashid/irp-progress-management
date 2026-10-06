// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES, THEME_COOKIE, parseTheme } from "@/lib/theme";

describe("parseTheme", () => {
  it("accepts exactly the three offered values", () => {
    expect(THEMES).toEqual(["light", "dark", "system"]);
    for (const theme of THEMES) {
      expect(parseTheme(theme)).toBe(theme);
    }
  });

  it("degrades anything else to system, so a malformed cookie cannot reach a DOM attribute", () => {
    for (const bad of [undefined, "", "purple", "DARK", "light ", "system;", "<script>"]) {
      expect(parseTheme(bad)).toBe("system");
    }
  });

  it("names the cookie once, so the layout and the action cannot disagree", () => {
    expect(THEME_COOKIE).toBe("irp-theme");
  });
});

/**
 * The dark token block appears TWICE in globals.css — once inside
 * `@media (prefers-color-scheme: dark)` for "follow the OS", once as
 * `:root[data-theme="dark"]` for an explicit choice. CSS cannot combine a media
 * query with a selector list and this project has no preprocessor, so the
 * duplication is inherent.
 *
 * It is also dangerous. design-system §3 states 35 pairs pass WCAG AA and "do
 * not substitute values": a copy that drifts breaks AUDITED contrast silently —
 * nothing renders visibly wrong, the numbers simply are no longer the ones that
 * were checked. This test is why the duplication is acceptable.
 */
describe("globals.css dark token blocks", () => {
  const css = readFileSync(
    path.join(import.meta.dirname, "..", "app", "globals.css"),
    "utf8",
  );

  function darkBlocks(source: string): string[] {
    const blocks = [...source.matchAll(/\/\* dark-tokens:start \*\/([\s\S]*?)\/\* dark-tokens:end \*\//g)];
    // Whitespace-normalised so indentation differences between the two nesting
    // depths (inside a media query vs at top level) are not treated as drift.
    return blocks.map((m) => m[1]!.replace(/\s+/g, " ").trim());
  }

  it("has exactly two marked dark blocks", () => {
    expect(darkBlocks(css)).toHaveLength(2);
  });

  it("keeps the two blocks byte-identical after whitespace normalisation", () => {
    const [mediaQuery, explicit] = darkBlocks(css);
    expect(explicit).toBe(mediaQuery);
  });

  it("actually carries the §3.3 tokens, so an empty pair cannot pass vacuously", () => {
    const [block] = darkBlocks(css);
    expect(block).toContain("--bg: #121212");
    expect(block).toContain("--st-missed: #ed7473");
    // 13 declarations in §3.3's dark table.
    expect(block!.match(/--[a-z-]+:/g)).toHaveLength(13);
  });
});

/**
 * --brand-card is the ONLY token that is deliberately the same in light and
 * dark. The logo's wordmark is near-black green on a light field, so the card
 * behind it must not follow the theme — if it did, the wordmark would sit on
 * #1c1e23 and disappear.
 *
 * It achieves that by being declared once in the base :root and NEVER
 * overridden, which is also why it must stay OUTSIDE the dark-tokens markers:
 * inside them it would break the 13-declaration count and the byte-identity
 * check. This test is what stops someone "fixing the inconsistency" by adding
 * a dark value.
 */
describe("--brand-card is theme-invariant", () => {
  const css = readFileSync(
    path.join(import.meta.dirname, "..", "app", "globals.css"),
    "utf8",
  );

  it("is declared exactly once in the whole stylesheet", () => {
    expect(css.match(/--brand-card:/g)).toHaveLength(1);
  });

  it("is white", () => {
    expect(css).toMatch(/--brand-card:\s*#ffffff;/);
  });

  it("is not inside either dark token block, so it is never overridden", () => {
    const blocks = [
      ...css.matchAll(/\/\* dark-tokens:start \*\/([\s\S]*?)\/\* dark-tokens:end \*\//g),
    ];
    expect(blocks).toHaveLength(2);
    for (const [, body] of blocks) {
      expect(body).not.toContain("--brand-card");
    }
  });
});

/**
 * The contrast gate. design-system §3 claims "35 pairs across both themes pass
 * WCAG AA" and "do not substitute values" — and until this existed, nothing
 * checked it. The duplication test above catches the two dark blocks drifting
 * FROM EACH OTHER; it cannot catch both being wrong together. Edit a colour
 * consistently in both places and every other test in this file stays green.
 *
 * Pairs are derived from what the code ACTUALLY renders, not from §3's prose,
 * so a pair here can always be traced to a call site. Two pairs currently sit
 * at ~101% of their floor (--st-absent on --surface, 4.55:1; --line-strong on
 * --surface in dark, 3.03:1) — they are why this is worth having.
 */
describe("WCAG contrast", () => {
  const css = readFileSync(
    path.join(import.meta.dirname, "..", "app", "globals.css"),
    "utf8",
  );

  function tokensIn(block: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
      out[m[1]!.toLowerCase()] = m[2]!.toLowerCase();
    }
    return out;
  }

  // The FIRST :root block is the light base. The dark block overrides a subset
  // of it — so dark is light-with-overrides, which is what the cascade does and
  // is why --brand-card stays white in dark without a dark entry.
  const lightBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];
  const darkBlock = /\/\* dark-tokens:start \*\/([\s\S]*?)\/\* dark-tokens:end \*\//.exec(css)?.[1];

  it("parses both token sets out of the stylesheet", () => {
    expect(lightBlock).toBeDefined();
    expect(darkBlock).toBeDefined();
  });

  const light = tokensIn(lightBlock ?? "");
  const dark = { ...light, ...tokensIn(darkBlock ?? "") };

  /** WCAG 2.x relative luminance, sRGB. */
  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function ratio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  }

  /** [foreground, background, floor, the call site it comes from] */
  const PAIRS: readonly (readonly [string, string, number, string])[] = [
    // Body text — §12's 4.5:1 floor.
    ["ink", "bg", 4.5, "body copy on the canvas"],
    ["ink", "surface", 4.5, "copy inside a Panel"],
    ["ink", "surface-sunk", 4.5, "copy in the dense zone"],
    ["ink", "primary-weak", 4.5, "copy on a primary-tinted fill"],
    ["ink-muted", "bg", 4.5, "labels, hints, placeholders"],
    ["ink-muted", "surface", 4.5, "SectionLabel inside a Panel"],
    ["ink-muted", "surface-sunk", 4.5, "muted copy in the dense zone"],
    // --primary is TEXT in four places — this is why it carries 4.5, not 3.
    ["primary", "bg", 4.5, ".text-link:hover on the canvas"],
    ["primary", "surface", 4.5, "StatusPill's --st-review inside a Panel"],
    ["primary", "primary-weak", 4.5, ".nav-item[data-active], .chip[aria-current]"],
    ["surface", "primary", 4.5, ".btn-primary label on its own fill"],
    // The status vocabulary, on every surface it is drawn on.
    ["st-ok", "bg", 4.5, "on-time count"],
    ["st-ok", "surface", 4.5, "on-time pill in a Panel"],
    ["st-ok", "surface-sunk", 4.5, "on-time in the dense zone"],
    ["st-late", "bg", 4.5, "late count"],
    ["st-late", "surface", 4.5, "late pill in a Panel"],
    ["st-late", "surface-sunk", 4.5, "late in the dense zone"],
    ["st-absent", "bg", 4.5, "absent count"],
    ["st-absent", "surface", 4.5, "absent pill in a Panel"],
    ["st-absent", "surface-sunk", 4.5, "absent in the dense zone"],
    ["st-missed", "bg", 4.5, "missed count"],
    ["st-missed", "surface", 4.5, "missed pill, role=alert copy"],
    ["st-missed", "surface-sunk", 4.5, "missed in the dense zone"],
    ["st-missed", "primary-weak", 4.5, "error copy on a tinted fill"],
    // Non-text UI boundaries — WCAG 1.4.11, 3:1. primary/bg and primary/surface
    // repeat above at a lower floor on purpose: they document a separate
    // requirement (focus ring, today ring) that survives if the text use goes.
    ["line-strong", "bg", 3, ".control borders on the canvas"],
    ["line-strong", "surface", 3, ".control borders inside a Panel"],
    ["line-strong", "surface-sunk", 3, ".control borders in the dense zone"],
    ["primary", "bg", 3, ":focus-visible ring"],
    ["primary", "surface", 3, "the ribbon's today ring"],
    ["st-missed", "surface", 3, ".btn-danger border"],
  ];

  /**
   * --st-review is rendered as TEXT (StatusPill's "· In review") but is NOT in
   * PAIRS, because it is an ALIAS: `--st-review: var(--primary)`. It is covered
   * transitively by every --primary pair above -- but only while it stays an
   * alias. Give it a literal hex and it would escape the matrix entirely, since
   * tokensIn() only parses hex and PAIRS never names it. This is what keeps that
   * from happening silently.
   */
  it("keeps --st-review an alias of --primary, so the primary pairs cover it", () => {
    expect(css).toMatch(/--st-review:\s*var\(--primary\)\s*;/);
    expect(light["st-review"]).toBeUndefined();
  });

  it("covers 30 pairs per theme", () => {
    expect(PAIRS).toHaveLength(30);
  });

  for (const [themeName, tokens] of [["light", light], ["dark", dark]] as const) {
    describe(themeName, () => {
      for (const [fg, bg, floor, where] of PAIRS) {
        it(`--${fg} on --${bg} meets ${String(floor)}:1 (${where})`, () => {
          const f = tokens[fg];
          const b = tokens[bg];
          // A missing token is a failure, not a skip — otherwise a renamed
          // token silently removes its own coverage.
          expect(f, `--${fg} not found in the ${themeName} tokens`).toBeDefined();
          expect(b, `--${bg} not found in the ${themeName} tokens`).toBeDefined();
          expect(ratio(f!, b!)).toBeGreaterThanOrEqual(floor);
        });
      }
    });
  }
});

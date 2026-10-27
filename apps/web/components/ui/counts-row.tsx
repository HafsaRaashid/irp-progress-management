/**
 * The compliance counts strip — "8 of 10 submitted today · 2 late · 1 absent ·
 * 0 missed" (docs/design-system.md §7, §11).
 *
 * Three pages carried three different hand-rolled markups for this one idea:
 * mentor-today's batch figures, my-month's personal figures, and the Cycles
 * table's per-student cell. Each retyped `var(--st-ok)`, `var(--st-late)` and
 * the rest inline, so the status vocabulary had four separate definitions
 * (this file plus StatusPill's) instead of one.
 *
 * `inline` selects the compact middot-separated form the Cycles table cell
 * needs; the default is the full-width baseline-aligned strip. Extra is
 * `muted`, never a status colour — §3.2's "distinguished by form, not colour".
 */
import { Fragment } from "react";

const TONE = {
  ok: "var(--st-ok)",
  late: "var(--st-late)",
  absent: "var(--st-absent)",
  missed: "var(--st-missed)",
  muted: "var(--ink-muted)",
  ink: "var(--ink)",
} as const;

export interface CountItem {
  tone: keyof typeof TONE;
  /**
   * The figure the text states, when it states one. Supplied, a ZERO drops
   * the item to muted regardless of `tone`: "0 late" in ochre and "0 missed"
   * in red were three coloured figures competing for attention on a page
   * where nothing had gone wrong, which is the opposite of what the status
   * ramp is for. A compliant month should read as one green figure among
   * quiet ones. Optional, so a caller with no figure (or one that wants a
   * zero coloured anyway) is unchanged.
   */
  count?: number;
  /** Already-composed copy — "2 late", "8 of 10 submitted". §11 wants the
   *  noun, not a bare figure, so the caller owns the wording. */
  text: string;
  testId?: string;
  strong?: boolean;
}

/** Muted when the figure is zero -- see CountItem.count. */
function toneFor(item: CountItem): string {
  return item.count === 0 ? TONE.muted : TONE[item.tone];
}

export function CountsRow({
  items,
  inline = false,
  testId,
}: {
  items: CountItem[];
  inline?: boolean;
  testId?: string;
}) {
  if (inline) {
    return (
      <span data-testid={testId}>
        {items.map((item, i) => (
          <Fragment key={item.text}>
            {i > 0 && " · "}
            <span className="tabular" style={{ color: toneFor(item) }}>
              {item.text}
            </span>
          </Fragment>
        ))}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-6 text-sm" data-testid={testId}>
      {items.map((item) => (
        <span
          key={item.text}
          className={item.strong === true ? "tabular font-semibold" : "tabular"}
          data-testid={item.testId}
          style={{ color: toneFor(item) }}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

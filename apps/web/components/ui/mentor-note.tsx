"use client";

import { useState } from "react";

/**
 * The mentor's note for one day (FR-19), behind a disclosure.
 *
 * ## Why a disclosure, not an always-visible panel
 *
 * The content stays inline on the day it is about (see mentor-note.tsx's
 * original design note on why this is not a "feedback section"), but a
 * day-by-day history is a SCAN surface — the student reading it is checking
 * what they submitted and how it went, not expecting to stop and read a
 * paragraph of prose on every card. An always-open note competes with the
 * entry text for attention on every single card, most of which have none.
 * Hidden behind a one-line "View feedback" prompt, a day WITH a note still
 * announces itself (unlike doing nothing at all, which is indistinguishable
 * from no feedback existing) without forcing a read.
 *
 * ## Why this is still not a "feedback section"
 *
 * It renders NOTHING when there is no note — not a collapsed empty
 * disclosure, not a greyed-out button. A feedback *panel* has to say
 * something when it is empty, which is exactly the apology-on-every-day
 * problem this component exists to avoid. No note, no button, no trace.
 *
 * `mentorNote` is null (not "") when a mentor recorded attendance without
 * writing anything — "no feedback" and "feedback that happens to be blank"
 * must stay distinguishable, because the interface renders nothing for both,
 * and only a real, non-blank string earns the button.
 */
export function MentorNote({ note }: { note: string | null | undefined }) {
  const [open, setOpen] = useState(false);

  // Total on purpose, same as before: a student-facing surface should not
  // crash because a day arrived without the field (a stale cached response,
  // or an older client against a newer API). Nothing is the correct output
  // for every falsy case.
  if (note === null || note === undefined || note.trim() === "") return null;

  return (
    <div className="mt-3">
      {/*
        A CHIP (rounded-full, filled), not bare link text. A day already
        carries other small coloured text in its header -- StatusPill's own
        "· In review" suffix renders in this same --primary, and a plain text
        trigger sitting right beside it read as one more status annotation
        rather than a separate, clickable thing. The fill is what makes the
        two readable as different KINDS of element without touching
        StatusPill itself (untouched, per ADR-0032) or inventing a new
        colour: --primary on --primary-weak is already one of the pairs
        test/theme-tokens.test.ts verifies (5.99:1 light, 5.50:1 dark).
      */}
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); }}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium"
        style={{ color: "var(--primary)", background: "var(--primary-weak)" }}
      >
        <ChevronIcon open={open} />
        {open ? "Hide feedback" : "View feedback"}
      </button>

      {open && (
        <div
          className="mt-2 rounded-[var(--radius-control)] border-l-2 py-2 pl-3"
          style={{ borderColor: "var(--primary)", background: "var(--primary-weak)" }}
        >
          <p
            className="text-xs uppercase tracking-[0.08em]"
            style={{ color: "var(--primary)", fontFamily: "var(--font-mono)" }}
          >
            From your mentor
          </p>
          <p className="prose mt-1" style={{ color: "var(--ink)" }}>{note}</p>
        </div>
      )}
    </div>
  );
}

/**
 * A rotating chevron, matching the house convention for a small inline glyph
 * (status-pill.tsx's LockGlyph): stroke-only, inherits currentColor, no icon
 * library — this repo hand-draws its handful of small glyphs rather than
 * taking a dependency for them.
 *
 * aria-hidden: the button's own text ("View feedback" / "Hide feedback")
 * already names the state change, and `aria-expanded` on the button carries
 * it for assistive technology — the glyph is decoration, not a second,
 * wordless state indicator (§12: never colour or a glyph alone).
 */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 10"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 chevron-rotate"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <path d="M3.2 1.8 6.8 5l-3.6 3.2" />
    </svg>
  );
}

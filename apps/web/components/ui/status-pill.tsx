/**
 * The compliance status vocabulary — docs/design-system.md §3.2, §12.
 * Status is never colour alone: every state renders a glyph AND a text
 * label, so colour-vision deficiency and colour-stripped contexts (print,
 * high-contrast mode) still read correctly.
 *
 * `extra` is deliberately rendered in `--ink-muted`, not a status colour —
 * §3.2's "Extra — distinguished by form, not colour": weekend work is not a
 * compliance state and gets no place in the four-colour ramp.
 *
 * ONE colour per pill (2026-10-09). The report-state suffix used to paint
 * itself `--st-review` (an alias of --primary) while the status word beside
 * it carried the ramp, so "On time · In review" was a green word and a blue
 * word inside one chip, and "· Saved" was a near-black one. Two saturated
 * colours in a 60-pixel chip read as a rendering fault, not as two facts.
 * The outcome keeps the colour because it is the thing being scanned for;
 * the report state is secondary and goes muted. This deviates from §3.2's
 * "Evaluated as --ink + lock glyph" on the colour only -- the glyph stays,
 * and --ink-muted is itself gated against every surface.
 */
const STATUS_RENDER = {
  onTime: { glyph: "●", label: "On time", color: "var(--st-ok)" },
  late: { glyph: "◐", label: "Late", color: "var(--st-late)" },
  absent: { glyph: "○", label: "Absent", color: "var(--st-absent)" },
  missed: { glyph: "✕", label: "Missed", color: "var(--st-missed)" },
  pending: { glyph: "·", label: "Open", color: "var(--ink-muted)" },
  extra: { glyph: "+", label: "Extra", color: "var(--ink-muted)" },
  // `none` and `future` are not outcomes — they mean "nothing has happened
  // here yet". They render NOTHING (see the early return below), not a pill.
  // They stay in the map because DayStatus includes them and callers pass a
  // day's status straight through; the map is what makes that total.
  none: { glyph: "—", label: "—", color: "var(--ink-muted)" },
  future: { glyph: "—", label: "—", color: "var(--ink-muted)" },
} as const;

/** The two statuses that describe an absence of anything, not an outcome. */
const NOT_AN_OUTCOME = new Set<PillStatus>(["none", "future"]);

export type PillStatus = keyof typeof STATUS_RENDER;
export type PillReportStatus = "InReview" | "Evaluated" | null;

/**
 * §3.2 specifies Evaluated as "`--ink` + lock glyph" and it was rendering the
 * ink without the glyph. Drawn rather than typed: U+1F512 is an emoji and
 * paints in its own colours, which a restrained four-colour status palette
 * cannot absorb. This inherits `currentColor`, so it stays --ink in both
 * themes. `aria-hidden` because the word "Saved" beside it already says
 * so — §12 wants glyph AND text, never a glyph carrying meaning alone.
 */
function LockGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <rect x="2.2" y="5.2" width="7.6" height="5.6" rx="1.2" />
      <path d="M4.2 5.2V3.8a1.8 1.8 0 0 1 3.6 0v1.4" />
    </svg>
  );
}

export function StatusPill({
  status,
  reportStatus = null,
  saved = false,
  crossfade = false,
}: {
  status: PillStatus;
  reportStatus?: PillReportStatus;
  /**
   * The mentor has stored a record for this day but it is not locked
   * (Evaluated is the locked one). Reads "· Saved" without the lock, in place
   * of "· In review".
   */
  saved?: boolean;
  /**
   * §10's "review state change — 180ms crossfade on the status pill". Opt-in,
   * because the animation replays on mount and a page rendering thirty pills
   * at once should not flicker all of them. The review page sets it and keys
   * the pill on its status so a transition actually remounts it.
   */
  crossfade?: boolean;
}) {
  // A pill reading "— —" is not a status, it is furniture. On the review page
  // every not-yet-reached day carried one, so a mentor scrolling a cycle saw a
  // column of empty pills that meant nothing. §3.2's vocabulary has five
  // statuses and Extra; "nothing yet" is not among them, so it draws nothing.
  // A reportStatus can still be worth showing on its own (a day may be In
  // review before its own outcome settles), so that is the one exception.
  if (NOT_AN_OUTCOME.has(status) && reportStatus === null) return null;

  const r = STATUS_RENDER[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs${
        crossfade ? " pill-crossfade" : ""
      }`}
      style={{ color: r.color, borderColor: "var(--line)" }}
      data-status={status}
    >
      <span aria-hidden="true">{r.glyph}</span>
      {r.label}
      {reportStatus === "InReview" && !saved && (
        <span style={{ color: "var(--ink-muted)" }}>&middot; In review</span>
      )}
      {saved && reportStatus !== "Evaluated" && (
        <span style={{ color: "var(--ink-muted)" }}>&middot; Saved</span>
      )}
      {reportStatus === "Evaluated" && (
        <span className="inline-flex items-center gap-1" style={{ color: "var(--ink-muted)" }}>
          &middot; Saved <LockGlyph />
        </span>
      )}
    </span>
  );
}

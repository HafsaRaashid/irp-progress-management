/**
 * The surface card wrapper — docs/design-system.md §5.
 *
 * `quiet` is opt-in (ADR-0032), named for what it does, never for who uses
 * it. A day card with nothing on it used the exact same solid --surface panel
 * as a day full of real content, so a history of mostly-empty cards gave
 * every blank the same visual weight as the days a student actually wrote
 * on. `quiet` drops the fill and dashes the border instead -- reads as "a
 * slot waiting to be filled", not as a smaller or lesser card, and nothing
 * changes for a caller that never passes it.
 *
 * `sunk` selects the denser roster-zone surface (`--surface-sunk`) AND its
 * padding. §5 is explicit that the two travel together: "Rhythm **is** the
 * density signal. The warm zone uses 24–32px padding. The roster uses 8–12px
 * row padding. That contrast **is** the 'warm shell, dense core' decision."
 * Panel was a flat `p-6` in both modes, so the dense core sat in the same warm
 * box as everything else and the intended contrast never appeared. `sunk` is
 * already documented as "the dense roster zone" in §3.1, so coupling padding
 * to it needs no second prop.
 *
 * `title`/`aside` render the header row that student-today, my-month and the
 * review page each hand-rolled identically as `mb-3 flex items-center
 * justify-between` around a SectionLabel and a StatusPill.
 */
import type { ReactNode } from "react";
import { SectionLabel } from "./section-label";

export function Panel({
  children,
  sunk = false,
  quiet = false,
  title,
  aside,
}: {
  children: ReactNode;
  sunk?: boolean;
  /** A placeholder slot, not a smaller card -- see the note above. */
  quiet?: boolean;
  title?: ReactNode;
  aside?: ReactNode;
}) {
  const hasHeader = title !== undefined || aside !== undefined;

  return (
    <div
      className={`rounded-[var(--radius-panel)] border ${sunk ? "p-3" : "p-6"} ${quiet ? "border-dashed" : ""}`}
      style={{
        background: quiet ? "transparent" : sunk ? "var(--surface-sunk)" : "var(--surface)",
        borderColor: "var(--line)",
      }}
    >
      {hasHeader && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {/* An empty span rather than a conditional, so an `aside` with no
              `title` still lands right where justify-between puts child two. */}
          {title === undefined ? <span /> : <SectionLabel>{title}</SectionLabel>}
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

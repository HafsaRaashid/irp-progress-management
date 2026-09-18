/**
 * The sidebar's icon set. Hand-drawn rather than a dependency: no icon library
 * exists in this repo, the only other SVG is hand-drawn in status-pill.tsx, and
 * the stack is a fixed programme constraint — adding a package for seven glyphs
 * would need an ADR and stakeholder escalation for no real gain.
 *
 * Every icon is stroke-only with `stroke="currentColor"` and no fill, so it
 * inherits .nav-item's resting, hover and [data-active] colour automatically.
 * That is what makes dark work here with no new tokens and no dark-specific
 * rules.
 *
 * Every icon is aria-hidden. The text label beside it is the accessible name,
 * so these add no meaning a screen reader would miss — which is also what keeps
 * design-system §12 satisfied (nothing conveys meaning by colour or glyph
 * alone).
 */
import type { ReactElement, ReactNode } from "react";

function Icon({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** A calendar — one day. */
export function TodayIcon(): ReactElement {
  return (
    <Icon>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v2M10.5 2v2" />
    </Icon>
  );
}

/** A table: header row plus a divided column. */
export function RosterIcon(): ReactElement {
  return (
    <Icon>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M6.5 6.5v7" />
    </Icon>
  );
}

/** A circular arrow — the monthly cycle. */
export function CyclesIcon(): ReactElement {
  return (
    <Icon>
      <path d="M13.4 8a5.4 5.4 0 1 1-1.9-4.1" />
      <path d="M13.5 2.3v2.6h-2.6" />
    </Icon>
  );
}

/** Two people. */
export function StudentsIcon(): ReactElement {
  return (
    <Icon>
      <circle cx="6.2" cy="6" r="2.3" />
      <path d="M2.6 13.3c0-2 1.6-3.6 3.6-3.6s3.6 1.6 3.6 3.6" />
      <path d="M10.9 4.2a2 2 0 0 1 0 3.7M11.3 10c1.2.4 2.1 1.6 2.1 3.3" />
    </Icon>
  );
}

/** Sliders — settings. */
export function SettingsIcon(): ReactElement {
  return (
    <Icon>
      <path d="M2.5 5.2h11M2.5 10.8h11" />
      <circle cx="6" cy="5.2" r="1.7" />
      <circle cx="10" cy="10.8" r="1.7" />
    </Icon>
  );
}

/** An arrow leaving an open door. */
export function SignOutIcon(): ReactElement {
  return (
    <Icon>
      <path d="M6.5 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5h2.5" />
      <path d="M10.2 5.4L12.8 8l-2.6 2.6M12.8 8H6.2" />
    </Icon>
  );
}

/**
 * docs/design-system.md §11: empty states teach the interface and are
 * invitations, never "Nothing here" — callers supply that invitation copy
 * via `title`/`hint`, this component only supplies the layout.
 *
 * `icon` and `action` are OPT-IN and default to nothing, per
 * docs/adr/0032-opt-in-expressive-props.md. The mentor's rendering is
 * unchanged because the default path is unchanged — a surface that passes
 * neither gets byte-for-byte what it got before these existed, which
 * ui-primitives.test.tsx characterises so it cannot drift.
 *
 * They are named for what they ARE, never for who uses them. There is no
 * `studentMode` here and must not be: the mentor surfaces get their own
 * redesign on a later branch and will turn these on, so anything scoped to
 * a role would have to be unpicked first.
 */
import type { ReactNode } from "react";

export function EmptyState({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  /**
   * Decorative only. Wrapped in `aria-hidden` below, because §12 does not let
   * a glyph carry meaning alone — it sits beside copy that already says the
   * same thing, and announcing it would just repeat the message wordlessly.
   */
  icon?: ReactNode;
  /** A call to action — typically a Button or a Link. Rendered below the hint. */
  action?: ReactNode;
}) {
  return (
    <div className="py-8 text-center">
      {icon !== undefined && (
        <div aria-hidden="true" className="mb-3 flex justify-center" style={{ color: "var(--ink-muted)" }}>
          {icon}
        </div>
      )}
      <p style={{ color: "var(--ink)" }}>{title}</p>
      {hint !== undefined && (
        <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>{hint}</p>
      )}
      {action !== undefined && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

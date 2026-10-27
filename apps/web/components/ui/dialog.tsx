"use client";

import { useRef, type ReactElement, type ReactNode } from "react";
import { Button } from "./button";
import { Panel } from "./panel";

/**
 * A modal dialog behind a button trigger (2026-10-09, the mentor Users-page
 * redesign) -- replaces the `<details>` disclosures that same page shipped
 * initially for Add student/Create batch/Transfer, which read as dropdowns
 * rather than actions.
 *
 * The native `<dialog>` element, not a hand-rolled overlay div: `showModal()`
 * gives focus trapping, Escape-to-close, and top-layer stacking (the rest of
 * the page becomes genuinely inert, not just visually dimmed) for free --
 * the same "no reinvented form controls" reasoning `RibbonKey` already
 * applied to `<details>` (docs/design-system.md §9). Backdrop-click-to-close
 * is the one thing the element does not do on its own, so it is wired by
 * hand below.
 *
 * The trigger and the dialog are siblings in one fragment, not the dialog
 * nested inside the trigger -- a `<dialog>` is valid anywhere in the DOM and
 * does not need to be adjacent to what opens it, and nesting would make the
 * trigger part of the dialog's own content once rendered.
 */
export function Dialog({
  triggerLabel,
  triggerVariant = "quiet",
  title,
  children,
}: {
  triggerLabel: string;
  triggerVariant?: "primary" | "quiet" | "danger";
  title: string;
  children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      {/* type="button" explicitly -- a bare <button> defaults to "submit",
          and this trigger must never be mistaken for one even though it
          currently never lands inside a <form> of its own. */}
      <Button type="button" variant={triggerVariant} onClick={() => ref.current?.showModal()}>
        {triggerLabel}
      </Button>
      <dialog
        ref={ref}
        className="modal"
        aria-label={title}
        // A click lands on the <dialog> element ITSELF only when it hits the
        // backdrop -- a click anywhere inside the Panel below hits that
        // Panel (or one of its children) instead, never bubbling up with
        // the dialog as e.target. This is what makes backdrop-click close
        // the dialog without a second listener on the content to stop
        // propagation.
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <Panel
          title={title}
          aside={
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Close"
              className="rounded-[var(--radius-control)] p-1 focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              style={{ color: "var(--ink-muted)" }}
            >
              <CloseIcon />
            </button>
          }
        >
          {children}
        </Panel>
      </dialog>
    </>
  );
}

/** Hand-drawn, matching mentor-note.tsx's ChevronIcon stroke treatment --
 * stroke-only, inherits currentColor, no icon library dependency. */
function CloseIcon(): ReactElement {
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
    >
      <path d="M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5" />
    </svg>
  );
}

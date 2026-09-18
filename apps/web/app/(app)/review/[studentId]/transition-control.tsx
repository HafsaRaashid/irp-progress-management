"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { transitionReport } from "./review-actions";

/**
 * FR-18's forward-only transition to Evaluated -- from either Submitted or
 * InReview. There is no separate "Start review" step any more: the backend
 * never actually required a day to be InReview before it could be scored
 * (entry-repo.ts's reviewEntry only ever blocked on Evaluated) or evaluated
 * (transition() now accepts Submitted -> Evaluated directly, backfilling
 * inReviewAt itself) -- exposing the InReview step as a mandatory manual
 * click was pure ceremony the domain never enforced. Saving a review still
 * advances a Submitted day to InReview on its own, as a side effect of
 * scoring, not a precondition for it.
 *
 * Never rendered for an Evaluated day -- the page (page.tsx) only mounts
 * this for "Submitted"/"InReview", and FR-20 locks the day once Evaluated
 * (no buttons, no record form). page.tsx keys this by `reportStatus` so a
 * status change (e.g. a review save flipping Submitted -> InReview) still
 * remounts it and resets useActionState, even though both statuses now
 * render the identical control.
 *
 * A client component driven by useActionState, mirroring absence-toggle.tsx:
 * `transitionReport.bind(null, studentId, reportId, "Evaluated")` fixes the
 * three leading args, leaving the (prevState, formData) pair useActionState
 * supplies on every dispatch as the bound function's (ignored) remaining
 * parameters. Binding into a plain server-component <form action> instead
 * would await and discard the `{ error } | null` return -- see
 * review-actions.ts's comment on transitionReport for why that shape was
 * rejected.
 */
export function TransitionControl({
  studentId,
  reportId,
}: {
  studentId: string;
  reportId: string;
}) {
  const [state, action, pending] = useActionState(
    transitionReport.bind(null, studentId, reportId, "Evaluated"),
    null,
  );

  return (
    <form action={action} className="mt-3 flex items-center gap-2">
      <Button type="submit" variant="quiet" loading={pending}>
        Mark evaluated
      </Button>
      {state !== null && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
          {state.error ?? "Something went wrong."}
        </p>
      )}
    </form>
  );
}

"use client";

import { useActionState } from "react";
import type { components } from "@irp/types";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { evaluateAction, overrideAction } from "@/app/(app)/cycles/evaluate-action";

type Evaluation = components["schemas"]["Evaluation"];

/**
 * The Cycles page's Evaluation column (FR-22/23/24): drives
 * evaluateAction/overrideAction through useActionState so a failing
 * generate/override call (409/502/503) surfaces to the mentor as an alert,
 * the same way AbsenceToggle drives markAbsent/removeAbsence -- see
 * entry-actions.ts and absence-toggle.tsx for the established pattern this
 * mirrors.
 *
 * Four states, matching evaluation-cell.test.tsx:
 *  - no evaluation yet, cycle still open  -> "Awaiting evaluation", no button
 *    (there is nothing to evaluate until the cycle closes -- FR-27).
 *  - no evaluation yet, cycle closed      -> an "Evaluate" button.
 *  - evaluated, no override               -> the AI performanceIndex, rounded,
 *    and an "Override" form.
 *  - evaluated, overridden                -> the override's newScore instead
 *    of performanceIndex, with the original score and reason underneath; no
 *    second override is offered (an override is a one-shot replacement, not
 *    an edit -- FR-24 names no "re-override" flow and the API exposes none).
 */
export function EvaluationCell({
  studentId,
  cycleSeq,
  evaluation,
  cycleIsClosed,
}: {
  studentId: string;
  cycleSeq: number;
  evaluation: Evaluation | null;
  cycleIsClosed: boolean;
}) {
  // Bound with no (prevState, formData) reducer pair of its own -- see
  // evaluate-action.ts's evaluateAction doc comment for why that's fine.
  const [evaluateState, evaluateFormAction, evaluatePending] = useActionState(
    evaluateAction.bind(null, studentId, cycleSeq),
    null,
  );
  // Bound with the evaluation's id so the (prevState, formData) pair
  // useActionState supplies on every dispatch carries only the form's own
  // fields, `newScore` and `reason`. Always called -- hooks can't be
  // conditional -- but only rendered into a form when evaluation !== null
  // and has no override yet.
  const [overrideState, overrideFormAction, overridePending] = useActionState(
    overrideAction.bind(null, evaluation?.id ?? ""),
    null,
  );

  if (evaluation === null) {
    if (!cycleIsClosed) {
      return <span style={{ color: "var(--ink-muted)" }}>Awaiting evaluation</span>;
    }
    return (
      <div className="flex flex-col gap-2">
        <form action={evaluateFormAction}>
          <Button type="submit" variant="quiet" loading={evaluatePending}>
            Evaluate
          </Button>
        </form>
        {evaluateState !== null && (
          <p role="alert" className="text-xs" style={{ color: "var(--st-missed)" }}>
            {evaluateState.error}
          </p>
        )}
      </div>
    );
  }

  const score = evaluation.override?.newScore ?? evaluation.performanceIndex;
  const scoreFieldId = `override-score-${studentId}-${String(cycleSeq)}`;
  const reasonFieldId = `override-reason-${studentId}-${String(cycleSeq)}`;

  return (
    <div className="flex flex-col gap-2">
      <span className="tabular" style={{ fontWeight: 600 }}>
        {Math.round(score)}
      </span>
      {evaluation.override !== null ? (
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          Overridden from {Math.round(evaluation.override.originalScore)} — {evaluation.override.reason}
        </p>
      ) : (
        <form action={overrideFormAction} className="flex items-end gap-2">
          <div>
            <FieldLabel htmlFor={scoreFieldId}>New score</FieldLabel>
            <input
              id={scoreFieldId}
              type="number"
              name="newScore"
              min={0}
              max={100}
              required
              className="control mt-1 block"
            />
          </div>
          <div>
            <FieldLabel htmlFor={reasonFieldId}>Reason</FieldLabel>
            <input
              id={reasonFieldId}
              type="text"
              name="reason"
              required
              maxLength={500}
              className="control mt-1 block"
            />
          </div>
          <Button type="submit" variant="quiet" loading={overridePending}>
            Override
          </Button>
        </form>
      )}
      {overrideState !== null && (
        <p role="alert" className="text-xs" style={{ color: "var(--st-missed)" }}>
          {overrideState.error}
        </p>
      )}
    </div>
  );
}

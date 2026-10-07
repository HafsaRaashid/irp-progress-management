"use server";

import { revalidatePath } from "next/cache";
import { generateEvaluation, overrideEvaluation } from "@irp/client";
import { apiClient } from "@/lib/api-client";

interface ProblemLike {
  detail?: string;
  title?: string;
}

function problemMessage(error: unknown, fallback: string): string {
  const p = error as ProblemLike | undefined;
  return p?.detail ?? p?.title ?? fallback;
}

/**
 * FormData.get() is typed `File | string | null` -- see entry-actions.ts's
 * formString for the full rationale. None of this page's fields are file
 * inputs, but the type system doesn't know that, and `String(File)` silently
 * stringifies to "[object Object]" instead of throwing --
 * @typescript-eslint/no-base-to-string is what catches a direct `String(...)`
 * on an unnarrowed FormDataEntryValue.
 */
function formString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/**
 * Bound with studentId and cycleSeq via
 * `evaluateAction.bind(null, studentId, cycleSeq)` in EvaluationCell, the
 * same way entry-actions.ts's removeAbsence binds its fixed `date` --
 * there is no form field for this action to read, so it takes no
 * (prevState, formData) reducer pair at all; useActionState still accepts
 * it because the extra (state, payload) arguments React supplies on every
 * dispatch are simply ignored.
 */
export async function evaluateAction(
  studentId: string,
  cycleSeq: number,
): Promise<{ error: string } | null> {
  const client = await apiClient();
  const { error } = await generateEvaluation({
    client,
    path: { id: studentId },
    query: { cycle: cycleSeq },
  });
  if (error !== undefined) {
    return { error: problemMessage(error, "The evaluation was not generated.") };
  }
  revalidatePath("/cycles");
  return null;
}

/**
 * Bound with the evaluation's id via `overrideAction.bind(null, evaluation.id)`
 * in EvaluationCell, leaving the (prevState, formData) reducer pair
 * useActionState supplies -- the override form's two fields, `newScore` and
 * `reason`, are read from that formData the same way saveDayRecord reads
 * its own fields in review-actions.ts.
 */
export async function overrideAction(
  evaluationId: string,
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const client = await apiClient();
  const newScore = Number(formString(formData.get("newScore")));
  const reason = formString(formData.get("reason"));
  const { error } = await overrideEvaluation({
    client,
    path: { id: evaluationId },
    body: { newScore, reason },
  });
  if (error !== undefined) {
    return { error: problemMessage(error, "The override was not accepted.") };
  }
  revalidatePath("/cycles");
  return null;
}

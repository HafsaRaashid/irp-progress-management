"use server";

import { revalidatePath } from "next/cache";
import {
  transitionDailyReport,
  upsertDayRecord,
  reviewEntry as reviewEntrySdk,
} from "@irp/client";
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
 * Driven by TransitionControl (a client component, day-record-form.tsx's
 * sibling) via `transitionReport.bind(null, studentId, reportId, to)` -- the
 * same fixed-leading-args shape as entry-actions.ts's removeAbsence.
 * useActionState calls the bound function with (prevState, formData); this
 * function ignores both, since studentId/reportId/to are already fixed by
 * bind before it's ever handed to useActionState.
 *
 * The brief's original wiring bound this straight into a plain server-
 * component `<form action={...}>`, which awaits and discards this function's
 * `{ error } | null` return -- the exact discarded-error defect Task 12's
 * review rejected for markAbsent/removeAbsence. Lifting the button into its
 * own client component (transition-control.tsx) driven by useActionState is
 * what lets a 409/404/500 actually reach the mentor.
 */
export async function transitionReport(
  studentId: string,
  reportId: string,
  to: "InReview" | "Evaluated",
): Promise<{ error: string } | null> {
  const client = await apiClient();
  const { error } = await transitionDailyReport({
    client,
    path: { id: reportId },
    body: { to },
  });
  if (error !== undefined) return { error: problemMessage(error, "The transition was rejected.") };
  revalidatePath(`/review/${studentId}`);
  return null;
}

/**
 * Driven by DayRecordForm (a client component) via plain useActionState --
 * this already has the (prevState, formData) reducer shape useActionState
 * requires, same as submitEntry/markAbsent in entry-actions.ts.
 *
 * Returns `{ ok: true }` rather than `null` on success -- unlike every other
 * action on this page, a successful save needs to say so. `upsertDayRecord`
 * is a full replace (one record per student-day), not a merge, so silently
 * resolving to nothing here would look identical to the pre-fix bug this
 * return shape exists to close off: reopening a recorded day, editing only
 * the note, and having attendance quietly revert to false/false with no
 * on-screen signal that anything happened at all. `null` remains the
 * *initial* state useActionState is seeded with (see day-record-form.tsx);
 * the action itself never returns it.
 */
export async function saveDayRecord(
  _prev: { ok: true } | { error: string } | null,
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const client = await apiClient();
  const studentId = formString(formData.get("studentId"));
  const date = formString(formData.get("date"));
  const note = formString(formData.get("note")).trim();
  const { error } = await upsertDayRecord({
    client,
    path: { id: studentId, date },
    body: {
      attended: formData.get("attended") === "on",
      tasksCompleted: formData.get("tasksCompleted") === "on",
      ...(note === "" ? {} : { note }),
    },
  });
  if (error !== undefined) return { error: problemMessage(error, "The record was not saved.") };
  revalidatePath(`/review/${studentId}`);
  return { ok: true };
}

/**
 * Driven by EntryReviewForm (a client component) via plain useActionState --
 * same shape as saveDayRecord. `reviewEntry` (the SDK call) is a full
 * replace, like `upsertDayRecord` -- score, feedback, and the
 * evaluation-inclusion flag are set together in one PUT, and a second write
 * fully replaces the first rather than merging (spec §3). Returns `{ ok:
 * true }` for the same reason saveDayRecord does: silently resolving to
 * nothing here would look identical to a reopen-and-resave quietly reverting
 * a field with no on-screen signal.
 *
 * ASSUMPTION: O-18 (Plan 9) -- this whole review surface rests on mentor
 * sign-off that hasn't happened yet.
 */
export async function reviewEntry(
  _prev: { ok: true } | { error: string } | null,
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const client = await apiClient();
  const studentId = formString(formData.get("studentId"));
  const entryId = formString(formData.get("entryId"));
  const score = Number(formString(formData.get("score")));
  const feedback = formString(formData.get("feedback")).trim();
  const { error } = await reviewEntrySdk({
    client,
    path: { id: entryId },
    body: {
      score,
      feedback,
      countsTowardEvaluation: formData.get("countsTowardEvaluation") === "on",
    },
  });
  if (error !== undefined) return { error: problemMessage(error, "The review was not saved.") };
  revalidatePath(`/review/${studentId}`);
  return { ok: true };
}

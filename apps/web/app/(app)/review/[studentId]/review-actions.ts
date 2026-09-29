"use server";

import { revalidatePath } from "next/cache";
import { transitionDailyReport, upsertDayRecord } from "@irp/client";
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

  // Saving a record for a day the student can no longer submit to also
  // finishes that day (FR-18/FR-20) -- this is what replaced the separate
  // "Mark evaluated" button. page.tsx decides `closesDay` server-side from
  // `canSubmitFor`, so a day still inside its submission window never gets
  // locked out from under the student.
  //
  // Two calls rather than one API endpoint doing both: `upsertDayRecord`
  // writes a MentorDayRecord and `transitionDailyReport` moves a
  // DailyReport, and those are deliberately independent resources
  // (schema.prisma says so -- a record must be able to exist for a day with
  // no report at all). The ordering matters more than the atomicity: if the
  // transition fails the record is still saved and the day stays OPEN,
  // which is the safe direction to fail in. A day wrongly left open can be
  // finished again; a day wrongly locked cannot be reopened (FR-20).
  const reportId = formString(formData.get("reportId"));
  if (formData.get("closesDay") === "yes" && reportId !== "") {
    const { error: transitionError } = await transitionDailyReport({
      client,
      path: { id: reportId },
      body: { to: "Evaluated" },
    });
    if (transitionError !== undefined) {
      revalidatePath(`/review/${studentId}`);
      return { error: problemMessage(transitionError, "The record saved, but the day was not finished.") };
    }
  }

  revalidatePath(`/review/${studentId}`);
  return { ok: true };
}

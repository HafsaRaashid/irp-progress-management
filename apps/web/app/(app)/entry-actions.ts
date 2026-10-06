"use server";

import { revalidatePath } from "next/cache";
import { createEntry, createAbsence, deleteAbsence } from "@irp/client";
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
 * FormData.get() is typed `File | string | null` because a form CAN carry a
 * file field. None of these forms do -- every field here is a text input or
 * textarea -- but the type system does not know that, and `String(File)`
 * silently stringifies to "[object Object]" instead of throwing. Narrowing
 * explicitly is what @typescript-eslint/no-base-to-string is catching.
 */
function formString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/**
 * Driven by useActionState in entry-composer.tsx (a client component), which
 * calls action(prevState, formData) itself. The two-argument reducer shape
 * is required for any of these three actions to be usable behind
 * useActionState — see markAbsent and removeAbsence below, which regained
 * this shape after a review caught that their earlier plain-form wiring
 * silently discarded the `{ error }` this function type promises to surface.
 *
 * Returns `{ ok: true }` rather than `null` on success, for the same reason
 * `saveDayRecord` in review/[studentId]/review-actions.ts does: resolving to
 * nothing is indistinguishable, on screen, from a click that never reached
 * the server. An entry is appended to a list the student cannot see from the
 * composer, so unlike markAbsent and removeAbsence below — whose result is
 * visible immediately, the panel re-renders as "Marked absent — …" or loses
 * it — a silent success here has no other evidence at all. `null` remains
 * the *initial* state useActionState is seeded with (see
 * entry-composer.tsx); the action itself never returns it.
 *
 * markAbsent and removeAbsence deliberately keep their `null` success: their
 * outcome is already on screen, so there is nothing ambiguous to confirm.
 */
export async function submitEntry(
  _prev: { ok: true } | { error: string } | null,
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const client = await apiClient();
  const { error } = await createEntry({
    client,
    body: {
      entryDate: formString(formData.get("entryDate")),
      body: formString(formData.get("body")),
    },
  });
  if (error !== undefined) return { error: problemMessage(error, "The entry was not accepted.") };
  revalidatePath("/");
  return { ok: true };
}

/**
 * Driven by useActionState in absence-toggle.tsx (a client component).
 *
 * (Review correction, supersedes an earlier single-argument version: this
 * function was briefly wired to a plain server-component <form
 * action={markAbsent}>, single-argument, to match that call site. The
 * review caught that the plain-form wrapper had to await and discard this
 * function's `{ error } | null` return -- a form action must itself return
 * void|Promise<void> -- which silently broke the "surfaces the RFC 7807
 * detail" contract the interface promises. The wiring was the defect, not
 * the signature: lifting the toggle into a client component and driving it
 * through useActionState is what lets the error actually reach the student,
 * and that requires this two-argument reducer shape back.)
 */
export async function markAbsent(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const client = await apiClient();
  const { error } = await createAbsence({
    client,
    body: {
      date: formString(formData.get("date")),
      reason: formString(formData.get("reason")),
    },
  });
  if (error !== undefined) return { error: problemMessage(error, "The absence was not recorded.") };
  revalidatePath("/");
  return null;
}

/**
 * Called from absence-toggle.tsx via `removeAbsence.bind(null, date)`, which
 * fixes `date` and leaves the (state, formData) pair useActionState
 * supplies on every dispatch as the function's remaining parameters --
 * ignored here, since only `date` matters, but present so the bound
 * function's signature still satisfies useActionState's reducer shape.
 */
export async function removeAbsence(date: string): Promise<{ error: string } | null> {
  const client = await apiClient();
  const { error } = await deleteAbsence({ client, path: { date } });
  if (error !== undefined) return { error: problemMessage(error, "The absence was not removed.") };
  revalidatePath("/");
  return null;
}

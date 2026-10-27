"use server";

import { revalidatePath } from "next/cache";
import { createUser, createBatch, transferStudent, archiveUser, restoreUser } from "@irp/client";
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
 * inputs, but the type system doesn't know that.
 */
function formString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/**
 * Driven by RegisterForm (a client component) via plain useActionState.
 *
 * UserCreate's `enrolment` is "required for Students, forbidden for Admins"
 * (spec) -- the API 400s if a Mentor registration carries the key at all, so
 * it is built conditionally and never spread as `enrolment: undefined`
 * (which would still serialize the key). RegisterForm only renders the
 * batch/startDate inputs when the role select is "Student", so those fields
 * are simply absent from formData for a Mentor registration -- this reads
 * that absence rather than re-deriving the role gate here.
 *
 * Returns `{ ok: true }` on success, matching saveDayRecord's shape
 * (review-actions.ts) -- a successful registration needs an on-screen
 * signal since the new row appears lower in the People panel, easy to miss.
 */
export async function registerUser(
  _prev: { ok: true } | { error: string } | null,
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const client = await apiClient();
  const role = formString(formData.get("role"));
  const batchId = formString(formData.get("batchId"));
  const startDate = formString(formData.get("startDate"));

  const { error } = await createUser({
    client,
    body: {
      // externalId is deliberately absent (ADR-0036): it binds itself to the
      // real Entra oid on this person's first successful sign-in, matched by
      // email. Nobody transcribes it at registration any more.
      email: formString(formData.get("email")),
      displayName: formString(formData.get("displayName")),
      role: role === "Admin" ? "Admin" : "Student",
      ...(role === "Student" ? { enrolment: { batchId, startDate } } : {}),
    },
  });
  if (error !== undefined) return { error: problemMessage(error, "The user was not registered.") };
  revalidatePath("/students");
  return { ok: true };
}

/**
 * Driven by CreateBatchForm (a client component) via plain useActionState.
 */
export async function addBatch(
  _prev: { ok: true } | { error: string } | null,
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const client = await apiClient();
  const { error } = await createBatch({
    client,
    body: {
      name: formString(formData.get("name")),
      startDate: formString(formData.get("startDate")),
      endDate: formString(formData.get("endDate")),
    },
  });
  if (error !== undefined) return { error: problemMessage(error, "The batch was not created.") };
  revalidatePath("/students");
  return { ok: true };
}

/**
 * Driven by TransferForm (a client component) via plain useActionState.
 */
export async function transferStudentAction(
  _prev: { ok: true } | { error: string } | null,
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const client = await apiClient();
  const studentId = formString(formData.get("studentId"));
  const { error } = await transferStudent({
    client,
    path: { id: studentId },
    body: {
      toBatchId: formString(formData.get("toBatchId")),
      effectiveDate: formString(formData.get("effectiveDate")),
    },
  });
  if (error !== undefined) return { error: problemMessage(error, "The student was not transferred.") };
  revalidatePath("/students");
  return { ok: true };
}

/**
 * Called from an ArchiveButton (a client component) via
 * `archiveUserAction.bind(null, userId)`, the same fixed-leading-arg shape as
 * entry-actions.ts's removeAbsence: useActionState still supplies the
 * (prevState, formData) pair on every dispatch, ignored here since only
 * `userId` matters.
 *
 * The API refuses self-archive with a 409 (SelfArchiveError, routes/admin-
 * actions.ts) -- that `detail` must reach the mentor, which is exactly what
 * the `{ error }` return here (rendered via role="alert" in ArchiveButton)
 * makes possible. The earlier plain-form-action shape this plan's review has
 * repeatedly rejected would await and discard it.
 */
export async function archiveUserAction(userId: string): Promise<{ ok: true } | { error: string }> {
  const client = await apiClient();
  const { error } = await archiveUser({ client, path: { id: userId } });
  if (error !== undefined) return { error: problemMessage(error, "The user was not archived.") };
  revalidatePath("/students");
  return { ok: true };
}

/**
 * The inverse of archiveUserAction (FR-5), bound the same way.
 *
 * `revalidatePath` matters more here than it looks: a restored user has to
 * disappear from the archive list AND reappear on the active one, and both
 * live under /students (the archive view is `?view=archived`, the same route).
 * One revalidation covers both.
 */
export async function restoreUserAction(userId: string): Promise<{ ok: true } | { error: string }> {
  const client = await apiClient();
  const { error } = await restoreUser({ client, path: { id: userId } });
  if (error !== undefined) return { error: problemMessage(error, "The user was not restored.") };
  revalidatePath("/students");
  return { ok: true };
}

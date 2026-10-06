"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { removeAbsence } from "./entry-actions";

/**
 * Shows a RECORDED absence and lets the student remove it.
 *
 * Marking absent lives in the composer now — it owns the date picker, and
 * "submit an update" and "I was absent" are two answers to the same question.
 * What stays here is the half that acts on something already recorded and
 * already visible on this card, where choosing a date again would make no
 * sense.
 *
 * The action is driven by useActionState so its `{ error } | null` return
 * actually reaches the student, in missed-red via role="alert". An earlier
 * version wired it through a plain server-component <form action={...}>
 * closure that awaited the action and discarded its result — silently
 * breaking the "surfaces the RFC 7807 detail" contract entry-actions.ts
 * promises. Lifting it into its own client component is what makes
 * useActionState available at all (it is a React hook; student-today.tsx
 * stays a server component).
 */
export function AbsenceToggle({
  date,
  absenceReason,
}: {
  date: string;
  /** Non-null by contract — the caller renders this only for a recorded absence. */
  absenceReason: string;
}) {
  // removeAbsence takes only `date`; binding it here is what lets a single
  // useActionState-compatible action carry the fixed date alongside the
  // (state, formData) pair React supplies on every dispatch.
  const [removeState, removeAction, removePending] = useActionState(
    removeAbsence.bind(null, date),
    null,
  );

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p style={{ color: "var(--ink-muted)" }}>Marked absent — {absenceReason}</p>
        <form action={removeAction}>
          <Button type="submit" variant="quiet" loading={removePending}>Remove</Button>
        </form>
      </div>
      {removeState !== null && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
          {removeState.error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { submitEntry } from "./entry-actions";
import { formatCivilDateLabel } from "./format-civil-date";

export function EntryComposer({ targetDates }: { targetDates: string[] }) {
  const [state, action, pending] = useActionState(submitEntry, null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <SectionLabel>Submit an update</SectionLabel>
      <select
        name="entryDate"
        // targetDates is most-recent-first, so index 0 is TODAY. Defaulting
        // to the last index (a review-caught defect) preselected the OLDEST
        // target -- yesterday on any normal Tue-Fri visit -- so the
        // untouched fast path filed today's work against yesterday and the
        // API flagged it Late.
        defaultValue={targetDates[0] ?? ""}
        aria-label="Entry date"
        className="control"
      >
        {targetDates.map((d) => (
          // The ISO value is the wire format the server action reads;
          // the label is student-facing copy, so it gets the weekday name.
          <option key={d} value={d}>{formatCivilDateLabel(d)}</option>
        ))}
      </select>
      <textarea
        name="body"
        required
        maxLength={4000}
        rows={4}
        placeholder="What did you work on?"
        aria-label="Entry text"
        className="control"
      />
      {/* Two narrowed branches rather than one `state !== null` test, the
          same shape review/[studentId]/day-record-form.tsx uses. The
          single-branch version rendered an EMPTY <p role="alert"> the
          moment the action started resolving to anything other than an
          error -- a blank live region announcing nothing. */}
      {state !== null && "error" in state && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>{state.error}</p>
      )}
      {state !== null && "ok" in state && (
        <p role="status" className="text-sm" style={{ color: "var(--st-ok)" }}>Submitted.</p>
      )}
      <div>
        <Button type="submit" loading={pending}>Submit update</Button>
      </div>
    </form>
  );
}

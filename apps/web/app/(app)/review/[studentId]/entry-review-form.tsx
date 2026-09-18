"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { reviewEntry } from "./review-actions";

export interface EntryReviewDefaults {
  score: number | null;
  mentorFeedback: string | null;
  countsTowardEvaluation: boolean;
}

/**
 * A mentor's review of one submission (FR-10/FR-11/FR-19, ASSUMPTION: O-18):
 * a 0-100 score, free-text feedback, and whether it counts toward the
 * monthly evaluation. `reviewEntry` fully replaces the entry's review fields
 * on every call -- there is no merge -- so this form prefills every field
 * from `defaults` (the entry's current values, null/false until first
 * reviewed) the same way DayRecordForm prefills from the stored day record:
 * an unprefilled reopen on a full-replace PUT would silently revert a field
 * that was already set.
 *
 * Never rendered for a locked (Evaluated) day -- page.tsx decides whether to
 * mount this component at all, the same gate DayRecordForm uses.
 */
export function EntryReviewForm({
  studentId,
  entryId,
  defaults,
}: {
  studentId: string;
  entryId: string;
  defaults: EntryReviewDefaults;
}) {
  const [state, action, pending] = useActionState(reviewEntry, null);

  return (
    <form
      action={action}
      className="mt-2 flex flex-col gap-2 border-t pt-2"
      style={{ borderColor: "var(--line)" }}
    >
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="entryId" value={entryId} />
      <SectionLabel>Review this submission</SectionLabel>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
          Score
          <input
            type="number"
            name="score"
            min={0}
            max={100}
            required
            defaultValue={defaults.score ?? ""}
            aria-label="Score, 0 to 100"
            className="control w-20"
          />
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
          <input
            type="checkbox"
            name="countsTowardEvaluation"
            defaultChecked={defaults.countsTowardEvaluation}
          />
          Counts toward evaluation
        </label>
      </div>
      <textarea
        name="feedback"
        required
        // EntryReview caps `feedback` at 500 -- without this the API 400s on
        // a longer note with no client-side signal (same reasoning as
        // day-record-form.tsx's note field).
        maxLength={500}
        rows={2}
        defaultValue={defaults.mentorFeedback ?? ""}
        placeholder="Feedback for the student"
        aria-label="Mentor feedback"
        className="control"
      />
      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
        Saving replaces the whole review for this submission — score, feedback, and the
        evaluation flag together.
      </p>
      {state !== null && "error" in state && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
          {state.error}
        </p>
      )}
      {state !== null && "ok" in state && (
        <p role="status" className="text-sm" style={{ color: "var(--st-ok)" }}>Review saved.</p>
      )}
      <div>
        <Button type="submit" variant="quiet" loading={pending}>
          Save review
        </Button>
      </div>
    </form>
  );
}

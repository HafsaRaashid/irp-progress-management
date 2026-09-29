"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { saveDayRecord } from "./review-actions";

export interface DayRecordDefaults {
  attended: boolean;
  tasksCompleted: boolean;
  note: string | null;
}

/**
 * The mentor's own attendance/tasks record for one weekday (FR-19), and the
 * only action on a day.
 *
 * `upsertDayRecord` fully replaces the stored record on every call (one
 * record per student-day) -- there is no merge. `listStudentDays`'s
 * DaySummary deliberately carries no DayRecord field (students must never
 * receive the mentor's own record), so the page fetches it separately via
 * `listDayRecords` and passes whatever it found for this date as `defaults`.
 * Reopening a recorded day and saving with unprefilled, unchecked boxes
 * would silently wipe attendance back to false/false -- the bug this
 * `defaults` prop exists to close off. `defaults` is undefined only when
 * nothing has been recorded for this date yet, in which case starting
 * blank is correct rather than a loss.
 *
 * `defaultChecked`/`defaultValue` (uncontrolled) rather than
 * `checked`/`value` -- this form's only state is what the mentor is
 * currently typing/toggling, seeded once from the server-fetched record.
 *
 * **`closesDay` is what replaced the old "Mark evaluated" button.** Saving a
 * record for a day the student can no longer submit to also finishes that
 * day (locking it, FR-20) -- one mentor action, not two. It is false while
 * the student's submission window is still open, because locking a day they
 * can still write to would take the window away (`canSubmitFor`, decided
 * server-side in page.tsx). The button reads "Save record" either way --
 * the confirmation line says which of the two actually happened.
 *
 * Never rendered for a weekend (the API 400s -- FR-19 "there is nothing to
 * attend") or an already-finished day (FR-20 locks it) -- both gates live in
 * page.tsx, which decides whether to mount this component at all.
 */
export function DayRecordForm({
  studentId,
  date,
  reportId,
  closesDay,
  defaults,
}: {
  studentId: string;
  date: string;
  reportId: string | null;
  closesDay: boolean;
  defaults?: DayRecordDefaults;
}) {
  const [state, action, pending] = useActionState(saveDayRecord, null);

  return (
    /*
      Two rows under a rule, not one line. Everything on a single line fitted
      but read as one undifferentiated strip -- two checkboxes, a wide text
      field and a button all competing at the same level with nothing to
      group them. The rule separates the mentor's controls from the
      student's words above.
    */
    <form
      action={action}
      className="mt-4 flex flex-col gap-3 border-t pt-4"
      style={{ borderColor: "var(--line)" }}
    >
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="date" value={date} />
      {/* Both read by the server action to decide whether to finish the day.
          A day with no report (nothing submitted, nothing absent) has nothing
          to finish, so reportId carries "" rather than being omitted -- an
          absent FormData key and an empty one would otherwise be
          indistinguishable from a typo in the field name. */}
      <input type="hidden" name="reportId" value={reportId ?? ""} />
      <input type="hidden" name="closesDay" value={closesDay ? "yes" : "no"} />

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
          <input type="checkbox" name="attended" defaultChecked={defaults?.attended ?? false} />
          Attended
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
          <input
            type="checkbox"
            name="tasksCompleted"
            defaultChecked={defaults?.tasksCompleted ?? false}
          />
          Tasks completed
        </label>
      </div>

      <div className="flex items-center gap-3">
        <input
          name="note"
          // DayRecordUpsert caps `note` at 500 -- without this the API 400s on
          // a longer note with no client-side signal at all (same reasoning as
          // absence-toggle.tsx's reason field).
          maxLength={500}
          defaultValue={defaults?.note ?? ""}
          placeholder="Note (optional)"
          aria-label={`Mentor note for ${date}`}
          className="control min-w-0 flex-1"
        />
        {/*
          One label, always. An earlier pass said "Save & finish day" on the
          rows that also finish, which described the mechanism honestly but
          put two different buttons in one column -- the mentor had to read
          each row's button before trusting it. The button is the same
          action every time; what differs is whether the day was still open,
          which the confirmation below and the row's own pill both report
          after the fact.
        */}
        <Button type="submit" variant="quiet" loading={pending}>
          Save record
        </Button>
      </div>

      {/* Its own row below the controls, so a message never reflows the
          inputs sideways as it appears. */}
      {state !== null && "error" in state && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
          {state.error ?? "Something went wrong."}
        </p>
      )}
      {state !== null && "ok" in state && (
        <p role="status" className="text-sm" style={{ color: "var(--st-ok)" }}>
          {closesDay ? "Saved — day finished." : "Record saved."}
        </p>
      )}
    </form>
  );
}

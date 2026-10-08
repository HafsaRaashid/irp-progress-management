"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { SectionLabel } from "@/components/ui/section-label";
import { submitEntry, markAbsent } from "./entry-actions";
import { formatCivilDateLabel } from "./format-civil-date";

/**
 * One target day the student may still act on.
 *
 * `canBeAbsent` is computed by the SERVER (student-today.tsx), not here: it
 * depends on the day being a weekday AND carrying no record yet, and the
 * weekday half is a domain rule (`isWeekday` from @irp/core), not a client
 * concern. Absence does not apply to a weekend — the glossary is explicit that
 * there is nothing to be absent from — and the submission window DOES include
 * Saturday and Sunday on a Monday, so this is a real case and not a
 * theoretical one.
 */
export interface ComposerTarget {
  date: string;
  canBeAbsent: boolean;
}

/**
 * The student's one "what happened on this day" control.
 *
 * Submitting an update and marking absent are two answers to the same
 * question, so they share one date picker. They used to be far apart — the
 * composer here, and a separate mark-absent form inside every day card below —
 * which meant choosing a date twice, in two different widgets, to say two
 * things about the same day.
 *
 * REMOVING an absence stays on the day card (absence-toggle.tsx), because that
 * acts on something already recorded and visible there. This control is only
 * for days nothing has been said about yet.
 */
export function EntryComposer({ targets }: { targets: ComposerTarget[] }) {
  const [state, action, pending] = useActionState(submitEntry, null);
  const [absenceState, absenceAction, absencePending] = useActionState(markAbsent, null);
  // targets is most-recent-first, so index 0 is TODAY.
  const [selected, setSelected] = useState(targets[0]?.date ?? "");
  const [absentOpen, setAbsentOpen] = useState(false);

  const target = targets.find((t) => t.date === selected);
  const canBeAbsent = target?.canBeAbsent ?? false;

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Submit an update</SectionLabel>

      {/*
        The date lives OUTSIDE both forms and is mirrored into each as a
        hidden input. A single <select> cannot be a field of two sibling
        forms, and duplicating the picker is the thing this change exists to
        remove.
      */}
      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          // A date change invalidates an open absence prompt: the reason
          // typed for Monday must not be submitted against Saturday.
          setAbsentOpen(false);
        }}
        aria-label="Entry date"
        className="control"
      >
        {targets.map((t) => (
          <option key={t.date} value={t.date}>{formatCivilDateLabel(t.date)}</option>
        ))}
      </select>

      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="entryDate" value={selected} />
        <textarea
          name="body"
          required
          maxLength={4000}
          rows={4}
          defaultValue={state !== null && "error" in state ? state.body : ""}
          placeholder="What did you work on?"
          aria-label="Entry text"
          className="control"
        />
        {/*
          Optional, student-reported, never required (FR-17, ADR-0033) --
          supplementary context, not a metric anything is scored on (O-18).
          min/max mirror the server's bound (0-480, ADR-0033) so a student
          sees the limit immediately rather than after a round trip.

          defaultValue stays "" rather than 0 on first render and on a
          rejection that carried no meetingMinutes back -- an empty field
          reads as "not reported"; a 0 would claim the student explicitly
          said zero, which is a different, false statement.
        */}
        <div>
          <FieldLabel htmlFor="meeting-minutes">Minutes in meetings (optional)</FieldLabel>
          <input
            id="meeting-minutes"
            type="number"
            name="meetingMinutes"
            min={0}
            max={480}
            defaultValue={
              state !== null && "error" in state && state.meetingMinutes !== undefined
                ? state.meetingMinutes
                : ""
            }
            className="control mt-2 block w-32"
          />
        </div>
        {state !== null && "error" in state && (
          <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>{state.error}</p>
        )}
        {state !== null && "ok" in state && (
          <p role="status" className="text-sm" style={{ color: "var(--st-ok)" }}>Submitted.</p>
        )}
        {/*
          Both actions sit on one row, which is what §8.2's mock shows:
          "[ Submit today's update ]    Mark today as absent". Mark absent is
          type="button" so it toggles the reason field rather than submitting
          this form, and it is `quiet` because submitting is the primary act —
          two primary buttons would make the student choose between equals.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={pending}>Submit update</Button>
          {canBeAbsent && !absentOpen && (
            <Button type="button" variant="quiet" onClick={() => { setAbsentOpen(true); }}>
              Mark absent
            </Button>
          )}
        </div>
      </form>

      {/*
        The absence path. Hidden entirely when the selected day cannot carry
        one — a weekend, or a day already recorded — rather than shown and
        rejected by the API, because "there is nothing to be absent from" is
        not an error the student made.
      */}
      {/*
        The absence confirmation sits outside the `absentOpen` branch: the
        form it belongs to is gone once the day stops being absence-eligible
        (the server re-renders with canBeAbsent false), and a confirmation
        that vanishes at the moment it succeeds is no confirmation at all.

        --st-absent, not --st-ok: absence is neutral, not an achievement
        (§3.2, and O-7 -- it carries no penalty either).
      */}
      {absenceState !== null && "ok" in absenceState && (
        <p role="status" className="text-sm" style={{ color: "var(--st-absent)" }}>
          Marked absent — {absenceState.reason}
        </p>
      )}

      {canBeAbsent && absentOpen && (
        <form action={absenceAction} className="flex flex-col gap-2">
          <input type="hidden" name="date" value={selected} />
          <SectionLabel>Why were you absent?</SectionLabel>
          <div className="flex items-end gap-2">
            <input
              name="reason"
              required
              // AbsenceCreate caps `reason` at 500 -- without this the API
              // 400s on a longer reason with no client-side signal at all.
              maxLength={500}
              placeholder="Reason"
              aria-label={`Absence reason for ${selected}`}
              className="control min-w-0 flex-1"
            />
            <Button type="submit" loading={absencePending}>Record absence</Button>
            <Button type="button" variant="quiet" onClick={() => { setAbsentOpen(false); }}>
              Cancel
            </Button>
          </div>
          {absenceState !== null && "error" in absenceState && (
            <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
              {absenceState.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

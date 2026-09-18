import { redirect } from "next/navigation";
import { listStudentDays, listUsers, listDayRecords } from "@irp/client";
import { civilDate, isWeekday } from "@irp/core";
import { getCurrentUserOrRedirect, apiClient } from "@/lib/api-client";
import { PageTitle } from "@/components/ui/page-title";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCivilDateLabel } from "../../format-civil-date";
import { TransitionControl } from "./transition-control";
import { DayRecordForm } from "./day-record-form";
import { EntryReviewForm } from "./entry-review-form";

const ENTRY_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * One student x one cycle, day-by-day (FR-18/FR-19/FR-20). Admin-only,
 * matching roster/page.tsx's gate.
 *
 * Next 16 makes dynamic-route params a Promise -- `params` must be awaited
 * before `.studentId` is readable.
 */
export default async function StudentReviewPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const user = await getCurrentUserOrRedirect();
  if (user.role !== "Admin") redirect("/");

  const { studentId } = await params;
  const client = await apiClient();

  // No per-id user-lookup endpoint exists -- GET /api/v1/users is the only
  // read this SDK offers for a display name, and the roster is capped at a
  // v1 handful of students, so fetching the whole Student list and finding
  // by id here is cheap and doesn't warrant a new endpoint.
  //
  // listDayRecords is a separate read from listStudentDays -- DaySummary
  // deliberately carries no DayRecord field (students must never receive the
  // mentor's own record through the schema /me/days shares with
  // listStudentDays), so the mentor's stored attendance/tasks records are
  // fetched here and mapped by date below to prefill DayRecordForm. Skipping
  // this and letting the form start blank was the exact bug this fetch
  // exists to close: upsertDayRecord fully replaces the record, so an
  // unprefilled reopen-to-add-a-note would silently revert attendance to
  // false/false with no on-screen signal.
  const [
    { data: students, error: usersError },
    { data: days, error: daysError },
    { data: records, error: recordsError },
  ] = await Promise.all([
    listUsers({ client, query: { role: "Student" } }),
    listStudentDays({ client, path: { id: studentId } }),
    listDayRecords({ client, path: { id: studentId } }),
  ]);

  // Task 13's listBatches lesson: destructuring only `data` off an SDK call
  // makes a 4xx/5xx (data undefined, error defined) indistinguishable from
  // "genuinely nothing to show". An unknown studentId 404s here rather than
  // crashing -- rendered the same Panel treatment as every other SDK error
  // on this page.
  if (daysError !== undefined) {
    return (
      <div>
        <PageTitle>Review</PageTitle>
        <Panel>
          <p role="alert" style={{ color: "var(--st-missed)" }}>
            {daysError.detail ?? daysError.title}
          </p>
        </Panel>
      </div>
    );
  }

  const student = students?.find((s) => s.id === studentId);
  const displayName = student?.displayName ?? studentId;

  // Undefined only when listDayRecords itself failed -- a genuinely empty
  // result is still an array, and `.get()` on the map correctly yields
  // undefined for any date with no stored record (the "start blank" case,
  // which is the honest state for a day the mentor has never recorded).
  const recordsByDate =
    recordsError === undefined
      ? new Map((records ?? []).map((r) => [r.date, r]))
      : undefined;

  return (
    <div>
      <PageTitle>Review — {displayName}</PageTitle>

      {usersError !== undefined && (
        <Panel>
          <p role="alert" style={{ color: "var(--st-missed)" }}>
            {usersError.detail ?? usersError.title}
          </p>
        </Panel>
      )}

      {recordsError !== undefined && (
        <Panel>
          <p role="alert" style={{ color: "var(--st-missed)" }}>
            {recordsError.detail ?? recordsError.title}
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
            Attendance/tasks records could not be loaded, so the record form is hidden below
            rather than risk overwriting a stored record with blank defaults.
          </p>
        </Panel>
      )}

      {(days === undefined || days.length === 0) && (
        <Panel>
          <EmptyState title="No days on record for this cycle yet." />
        </Panel>
      )}

      {days !== undefined && days.length > 0 && (
        <div className="flex flex-col gap-4">
          {/*
            R5: newest first. listStudentDays returns oldest-first (its own
            doc comment says so), so this is the one place that ordering is
            reversed for display -- everywhere else (student-today.tsx's
            targetDates) is already newest-first at the source.
          */}
          {[...days].reverse().map((day) => {
            const weekday = isWeekday(civilDate(day.date));
            // FR-20: an Evaluated day is locked -- no transition buttons, no
            // record form. A weekend never carries a record at all (the API
            // 400s -- "there is nothing to attend"). recordsByDate is
            // undefined only when listDayRecords itself errored -- the form
            // is withheld entirely rather than risk rendering it with wrong
            // (blank) defaults; see the Panel above explaining why.
            const showForm = weekday && day.reportStatus !== "Evaluated" && recordsByDate !== undefined;
            const record = recordsByDate?.get(day.date);
            const defaults = record === undefined
              ? undefined
              : { attended: record.attended, tasksCompleted: record.tasksCompleted, note: record.note };

            return (
              <Panel
                key={day.date}
                title={formatCivilDateLabel(day.date)}
                aside={
                  day.status === "none" ? undefined : (
                    // Keyed on the status it renders so a transition remounts
                    // it — §10's "180ms crossfade on the status pill" is an
                    // animation, and an animation only replays on mount.
                    <StatusPill
                      key={`${day.status}-${String(day.reportStatus)}`}
                      status={day.status}
                      reportStatus={day.reportStatus}
                      crossfade
                    />
                  )
                }
              >
                {day.entries.length === 0 && day.absenceReason === null && (
                  <p style={{ color: "var(--ink-muted)" }}>No entry recorded.</p>
                )}

                {day.entries.map((entry) => (
                  <div key={entry.id} className="mb-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="prose" style={{ color: "var(--ink)" }}>{entry.body}</p>
                      <div
                        className="flex shrink-0 items-center gap-2 text-sm"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        <span>{ENTRY_TIME_FORMAT.format(new Date(entry.submittedAt))}</span>
                        <StatusPill status={entry.isLate ? "late" : entry.isExtra ? "extra" : "onTime"} />
                      </div>
                    </div>
                    {/*
                      FR-20: an Evaluated day is locked -- the API 409s a
                      review write against it (LockedDayError), so the
                      control is withheld entirely rather than offered and
                      failing on submit. Unlike DayRecordForm, this is not
                      restricted to weekdays -- a weekend (Extra) entry is
                      just as reviewable as a weekday one.
                    */}
                    {day.reportStatus !== "Evaluated" && (
                      <EntryReviewForm
                        studentId={studentId}
                        entryId={entry.id}
                        defaults={{
                          score: entry.score,
                          mentorFeedback: entry.mentorFeedback,
                          countsTowardEvaluation: entry.countsTowardEvaluation,
                        }}
                      />
                    )}
                  </div>
                ))}

                {day.absenceReason !== null && (
                  <p style={{ color: "var(--ink-muted)" }}>Absent — {day.absenceReason}</p>
                )}

                {/*
                  Two separate conditional branches, not one TransitionControl
                  with a `reportStatus` prop that changes in place -- this is
                  load-bearing, not a style choice. React reconciles these as
                  distinct slots (only one is ever truthy), so when a
                  transition succeeds and revalidatePath re-renders this page
                  with the day's new reportStatus, the previous branch's
                  TransitionControl unmounts and the next one mounts fresh.
                  That remount is what resets useActionState back to its
                  initial `null` -- without it, a single long-lived instance
                  would carry the *first* step's pending/error state into the
                  *second* step's button, and a stale error from "Start
                  review" could linger on screen under "Mark evaluated" after
                  the transition that produced it already succeeded.
                */}
                {day.reportStatus === "Submitted" && day.reportId !== null && (
                  <TransitionControl
                    studentId={studentId}
                    reportId={day.reportId}
                    reportStatus="Submitted"
                  />
                )}
                {day.reportStatus === "InReview" && day.reportId !== null && (
                  <TransitionControl
                    studentId={studentId}
                    reportId={day.reportId}
                    reportStatus="InReview"
                  />
                )}

                {/*
                  Two full branches rather than `defaults={defaults}` --
                  exactOptionalPropertyTypes forbids passing an explicit
                  `undefined` to an optional prop (same reasoning as
                  student-today.tsx's `query` construction).
                */}
                {showForm && defaults === undefined && (
                  <DayRecordForm studentId={studentId} date={day.date} />
                )}
                {showForm && defaults !== undefined && (
                  <DayRecordForm studentId={studentId} date={day.date} defaults={defaults} />
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { listStudentDays, listUsers, listDayRecords } from "@irp/client";
import { canSubmitFor, civilDate, isWeekday } from "@irp/core";
import { getCurrentUserOrRedirect, apiClient } from "@/lib/api-client";
import { PageTitle } from "@/components/ui/page-title";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCivilDateLabel } from "../../format-civil-date";
import { DayRecordForm } from "./day-record-form";

const ENTRY_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

type Filter = "open" | "saved" | "all";

/**
 * The chips, in the order they render. They are named for the states the
 * StatusPill already shows on each row -- "In review" and "Saved" -- rather
 * than for the work ("Needs review"), so the page speaks one vocabulary.
 * "Evaluated" is deliberately not among them: that word belongs to the
 * monthly performance index (FR-23), which nothing produces yet, and using
 * it here made a mentor look like they were scoring.
 *
 * Labels only. The figures live on one line beneath the row instead --
 * "In review 11" inside a pill ran the label and the number together with
 * nothing to separate them, and every count stays readable below whichever
 * chip happens to be active.
 */
const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: "open", label: "In review" },
  { key: "saved", label: "Saved" },
  { key: "all", label: "All" },
];

/**
 * One student x one cycle, day-by-day (FR-18/FR-19/FR-20). Admin-only,
 * matching roster/page.tsx's gate.
 *
 * Next 16 makes dynamic-route params a Promise -- `params` must be awaited
 * before `.studentId` is readable.
 *
 * The Needs review / Evaluated split lives in the URL (`?show=`), not in
 * client state, for two reasons. A Server Action (Mark evaluated, Save
 * record) calls revalidatePath and re-renders this server component --
 * client state in a filter component would survive that, but only by
 * accident of not remounting, and the day it did remount the mentor would
 * silently be looking at a different list than they thought. And a mentor
 * mid-way through a month can bookmark or share "what is still outstanding
 * for this student", which is the question the page exists to answer.
 */
export default async function StudentReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await getCurrentUserOrRedirect();
  if (user.role !== "Admin") redirect("/");

  const { studentId } = await params;
  // Anything unrecognised falls back to "open" rather than 404ing or
  // showing everything: a mistyped query string should degrade to the
  // default view, not to a wall of already-finished days.
  const { show } = await searchParams;
  const filter: Filter = show === "saved" || show === "all" ? show : "open";
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

  // R5: newest first. listStudentDays returns oldest-first (its own doc
  // comment says so), so this is the one place that ordering is reversed
  // for display -- everywhere else (student-today.tsx's targetDates) is
  // already newest-first at the source.
  const orderedDays = [...(days ?? [])]
    .reverse()
    // A weekend only exists here if the student actually worked it. Saturdays
    // and Sundays carry no obligation (FR-12) and never enter a denominator
    // (FR-33), so an empty one is not "missing" -- rendering it as a row with
    // "No entry recorded." invented 8 pieces of nothing per cycle for the
    // mentor to scroll past. A weekend WITH an Extra entry still shows, and
    // still sits with the outstanding work.
    .filter((d) => isWeekday(civilDate(d.date)) || d.entries.length > 0);
  // `now` once for the whole render: every row's "can this still be
  // submitted to" answer must come from the same instant, or a page
  // straddling midnight would answer two different questions on one screen.
  const now = new Date();
  // "Needs review" is everything not locked yet: InReview, or no report at
  // all. A missed or absent day has no report, so it is neither evaluated
  // nor strictly "in review" -- but the mentor still owes it an attendance
  // record (FR-19), so it belongs with the outstanding work rather than in
  // a third bucket nobody asked for.
  //
  // These two are computed unconditionally, not just for the active filter,
  // because the chips show live counts -- "Evaluated 12" has to be right
  // even while looking at Needs review.
  const openDays = orderedDays.filter((d) => d.reportStatus !== "Evaluated");
  const savedDays = orderedDays.filter((d) => d.reportStatus === "Evaluated");
  const shown = filter === "open" ? openDays : filter === "saved" ? savedDays : orderedDays;

  function renderDay(day: (typeof orderedDays)[number]) {

    // FR-20: an Evaluated day is locked -- no transition buttons, no
    // record form. A weekend never carries a record at all (the API
    // 400s -- "there is nothing to attend"). recordsByDate is undefined
    // only when listDayRecords itself errored -- the form is withheld
    // entirely rather than risk rendering it with wrong (blank) defaults;
    // see the Panel above explaining why.
    const weekday = isWeekday(civilDate(day.date));
    const showForm = weekday && day.reportStatus !== "Evaluated" && recordsByDate !== undefined;
    // FR-20 locks a day once finished, and a lock cannot be undone -- so a
    // day the student may still submit to is never offered as finishable.
    // This is the whole reason "Mark evaluated" could be merged into Save
    // record safely: the dangerous case is excluded rather than trusted to
    // the mentor noticing the date.
    const closesDay = !canSubmitFor(civilDate(day.date), now);
    const record = recordsByDate?.get(day.date);
    const defaults = record === undefined
      ? undefined
      : { attended: record.attended, tasksCompleted: record.tasksCompleted, note: record.note };

    return (
      <Panel
        key={day.date}
        // A real heading, not styled text: 15+ day panels are the page's
        // primary structure, and a screen-reader user needs to jump between
        // them. They rendered as <div> until now, so the page had exactly
        // one heading (its <h1>) and no way to skim.
        title={<h2 className="text-xs font-semibold tracking-[0.08em]">{formatCivilDateLabel(day.date)}</h2>}
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
                {/*
                  Only when the entry says something the day's own pill does
                  not. An on-time entry on an on-time day rendered "On time"
                  twice per row, which is how a real signal (late, extra)
                  gets trained out of a reader.
                */}
                {entry.isLate && <StatusPill status="late" />}
                {!entry.isLate && entry.isExtra && <StatusPill status="extra" />}
              </div>
            </div>
          </div>
        ))}

        {day.absenceReason !== null && (
          <p style={{ color: "var(--ink-muted)" }}>Absent — {day.absenceReason}</p>
        )}

        {/*
          Two full branches rather than `defaults={defaults}` --
          exactOptionalPropertyTypes forbids passing an explicit
          `undefined` to an optional prop (same reasoning as
          student-today.tsx's `query` construction).
        */}
        {showForm && defaults === undefined && (
          <DayRecordForm
            studentId={studentId}
            date={day.date}
            reportId={day.reportId}
            closesDay={closesDay}
          />
        )}
        {showForm && defaults !== undefined && (
          <DayRecordForm
            studentId={studentId}
            date={day.date}
            reportId={day.reportId}
            closesDay={closesDay}
            defaults={defaults}
          />
        )}
      </Panel>
    );
  }

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
        <>
          <div className="mb-8">
            {/*
              The same `.chip` + aria-current pattern Roster and Cycles use
              for their batch/cycle filters (globals.css) -- a filter is a
              filter, and inventing a second vocabulary for this one would
              be §9's "one vocabulary per element" broken for no reason.

              Links, not buttons: this is navigation between two views of
              the same resource, so it belongs in the URL and in history.
              `aria-current="page"` (not `aria-pressed`) follows from that
              same reading, and is what .chip already styles.
            */}
            <div className="flex flex-wrap gap-2">
              {FILTERS.map(({ key, label }) => (
                <Link
                  key={key}
                  // `query` omitted entirely for the default rather than
                  // `show=open` -- a bare /review/<id> must be the same
                  // page as the default chip, or the chip would look
                  // unselected on arrival.
                  href={
                    key === "open"
                      ? { pathname: `/review/${studentId}` }
                      : { pathname: `/review/${studentId}`, query: { show: key } }
                  }
                  aria-current={key === filter ? "page" : undefined}
                  className="chip"
                >
                  {label}
                </Link>
              ))}
            </div>
            {/*
              Counts on one line instead of inside the chips. A chip reading
              "In review 11" ran the label and the figure together with
              nothing between them, so neither read cleanly; pulled out here
              they are a sentence, and every figure stays visible whichever
              chip is active.

              The helper sentence is said once, here, rather than inside all
              11 day forms -- it is the same sentence every time, so per-row
              copies were noise that pushed the actual work off screen.
            */}
            <p className="mt-4 text-sm" style={{ color: "var(--ink-muted)" }}>
              <span className="tabular">{openDays.length}</span> in review ·{" "}
              <span className="tabular">{savedDays.length}</span> saved ·{" "}
              <span className="tabular">{orderedDays.length}</span> days this cycle
            </p>
            <p className="mt-3 max-w-[70ch] text-xs leading-relaxed" style={{ color: "var(--ink-muted)" }}>
              Saving replaces that day&rsquo;s whole record — attendance, tasks and note together.
              A day the student can still submit to is saved without being finished.
            </p>
          </div>

          {shown.length === 0 && (
            <Panel>
              <EmptyState
                title={
                  filter === "open"
                    ? "Nothing left to review for this cycle."
                    : "No saved days yet."
                }
              />
            </Panel>
          )}

          <div className="flex flex-col gap-4">{shown.map(renderDay)}</div>
        </>
      )}
    </div>
  );
}

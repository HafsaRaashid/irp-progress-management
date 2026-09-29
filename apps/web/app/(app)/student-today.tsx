import { getMyDashboard, listMyDays, type Role } from "@irp/client";
import { cycleContaining, graceDeadlineFor, isWeekday, submissionWindow, toProgrammeDate } from "@irp/core";
import { apiClient } from "@/lib/api-client";
import { CycleCalendar } from "@/components/cycle-calendar/cycle-calendar";
import { toStudentCalendarDays } from "@/lib/ribbon";
import { PageTitle } from "@/components/ui/page-title";
import { Panel } from "@/components/ui/panel";
import { SectionLabel } from "@/components/ui/section-label";
import { CountsRow } from "@/components/ui/counts-row";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { EntryComposer } from "./entry-composer";
import { AbsenceToggle } from "./absence-toggle";
import { cycleHeading } from "./cycle-heading";
import { formatCivilDateLabel, formatWeekdayName } from "./format-civil-date";

// §11's deadline copy ("You can still submit for {date} until …") is always
// evaluated in Asia/Colombo, never the deploy region's local zone.
const DEADLINE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// The grace window's closing DAY, for §11's missed copy ("the grace window
// closed on 22 July"). No time of day: the sentence is about a window that is
// already shut, and a to-the-minute timestamp would imply a precision the
// student can no longer act on.
const GRACE_CLOSED_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  day: "numeric",
  month: "long",
});

const ENTRY_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * The student's home — docs/design-system.md §8.2.
 *
 * "Same ribbon, personal marks. The submission box is the primary action and
 * sits immediately below it." The ribbon and the cycle summary used to live
 * only on My month, so the mentor's home opened with the system's signature
 * element while the student's opened with a bare <select>. §8.2's order is
 * followed here: cycle position, ribbon, composer, then the strengths prose.
 * My month keeps the day-by-day history — the one thing this page does not
 * show, since it lists only the open submission window.
 *
 * No score, no rank, no other student anywhere on this surface (FR-30).
 *
 * Two calls, deliberately: getMyDashboard is the aggregate behind the ribbon
 * and the counts, listMyDays carries the entry bodies for the window panels.
 * A dashboard failure must not take the composer down with it — submitting is
 * the one thing this page exists for — so the ribbon degrades to an inline
 * alert and everything below it still renders.
 */
export async function StudentToday({ displayName, role }: { displayName: string; role: Role }) {
  const client = await apiClient();
  const openWindow = submissionWindow(new Date());

  // CycleCalendar (O-17) renders the WHOLE current cycle, weekends included,
  // so listMyDays is queried over the cycle's own bounds rather than the
  // narrower open-submission-window range this call used before -- the
  // dashboard's own StudentDay array is required-days-only and cannot
  // resolve a weekend cell's extra/none status on its own (implementation
  // plan audit finding 3).
  const currentCycle = cycleContaining(toProgrammeDate(new Date()));
  const query = { from: currentCycle.start, to: currentCycle.end };
  const [{ data: dashboard, error: dashboardError }, { data, error }] = await Promise.all([
    getMyDashboard({ client }),
    listMyDays({ client, query }),
  ]);

  const byDate = new Map((data ?? []).map((day) => [day.date, day]));
  // submissionWindow() always includes today as the most recent target
  // (index 0, since targetDates is most-recent-first) -- see its own
  // "Today is always submittable" invariant.
  const today = openWindow.targetDates[0];

  return (
    <div>
      <PageTitle>Today</PageTitle>
      {/*
        Playwright's sign-in chain (e2e/signin.spec.ts) asserts
        data-testid="user-name" AND data-testid="user-role" on every role
        after sign-in. The mentor branch of (app)/page.tsx renders its own
        signed-in card carrying both; these are the Student equivalents.
        Visually hidden -- this page's job is the composer, not a repeat of
        what the Topbar already shows.
      */}
      <span className="sr-only" data-testid="user-name">{displayName}</span>
      <span className="sr-only" data-testid="user-role">{role}</span>

      {dashboardError !== undefined && (
        <div className="mb-6">
          <Panel>
            <p role="alert" style={{ color: "var(--st-missed)" }}>
              {dashboardError.detail ?? dashboardError.title ?? "Your month could not be loaded."}
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
              You can still submit below.
            </p>
          </Panel>
        </div>
      )}

      {dashboard !== undefined && (
        <>
          <div className="mb-6">
            {/* ASSUMPTION: O-17 -- the calendar replaces the ribbon; no FR asks for it. */}
            <CycleCalendar
              weeks={toStudentCalendarDays(
                currentCycle,
                (data ?? []).map((d) => ({ date: d.date, status: d.status })),
                dashboard.today,
              )}
              label={cycleHeading(dashboard)}
            />
          </div>

          <div className="mb-8">
            <CountsRow
              items={[
                { tone: "ok", text: `${String(dashboard.summary.onTime)} on time` },
                { tone: "late", text: `${String(dashboard.summary.late)} late` },
                { tone: "absent", text: `${String(dashboard.summary.absent)} absent` },
                { tone: "missed", text: `${String(dashboard.summary.missed)} missed` },
                ...(dashboard.summary.extra > 0
                  ? [{ tone: "muted" as const, text: `+${String(dashboard.summary.extra)} extra` }]
                  : []),
              ]}
            />
          </div>
        </>
      )}

      <div className="mb-8">
        <EntryComposer targetDates={openWindow.targetDates} />
      </div>

      {error !== undefined && (
        <p role="alert" className="mb-4 text-sm" style={{ color: "var(--st-missed)" }}>
          Could not load your recent days. Try again shortly.
        </p>
      )}

      <SectionLabel>Recent days</SectionLabel>
      <div className="mt-2 mb-8 flex flex-col gap-4">
        {openWindow.targetDates.map((date) => {
          const day = byDate.get(date);
          const entries = day?.entries ?? [];
          const absenceReason = day?.absenceReason ?? null;
          const weekday = isWeekday(date);
          const noRecord = entries.length === 0 && absenceReason === null;
          const isToday = date === today;
          // Review correction: the deadline is PER TARGET, not the window-
          // level graceClosesAt -- that value is the OLDEST target's
          // deadline (the one closing soonest) and understates every newer
          // panel's actual window.
          const deadline = graceDeadlineFor(date);

          return (
            <Panel
              key={date}
              title={formatCivilDateLabel(date)}
              aside={
                day === undefined || day.status === "none" ? undefined : (
                  <StatusPill status={day.status} reportStatus={day.reportStatus} />
                )
              }
            >
              {noRecord && (
                <EmptyState
                  title={isToday ? "No entry for today yet." : `No entry for ${formatWeekdayName(date)} yet.`}
                  hint={`You can still submit for ${formatWeekdayName(date)} until ${DEADLINE_FORMAT.format(deadline)}.`}
                />
              )}

              {/* §11: "Missed — the grace window closed on 22 July", not a bare
                  "Missed" pill. The date is derivable right here (graceDeadlineFor
                  is a pure function of the day), so the pill's one-word label
                  does not have to be the whole story. */}
              {day?.status === "missed" && (
                <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                  Missed — the grace window closed on {GRACE_CLOSED_FORMAT.format(deadline)}.
                </p>
              )}

              {entries.map((entry) => (
                <div key={entry.id} className="mb-3 flex items-start justify-between gap-3">
                  <p className="prose" style={{ color: "var(--ink)" }}>{entry.body}</p>
                  <div
                    className="flex shrink-0 items-center gap-2 text-sm"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    <span>{ENTRY_TIME_FORMAT.format(new Date(entry.submittedAt))}</span>
                    <StatusPill status={entry.isLate ? "late" : entry.isExtra ? "extra" : "onTime"} />
                  </div>
                </div>
              ))}

              {weekday && (noRecord || absenceReason !== null) && (
                <AbsenceToggle date={date} absenceReason={absenceReason} />
              )}
            </Panel>
          );
        })}
      </div>

      {/* §8.2's third band: "Strengths and areas to develop … current cycle
          summary, prose, no score". */}
      {dashboard !== undefined && (
        <>
          <SectionLabel>Strengths and areas to develop</SectionLabel>
          <div className="mt-2">
            <Panel>
              {dashboard.strengthsAndWeaknesses === null ? (
                <EmptyState title="No evaluation yet — your first summary appears after your cycle closes." />
              ) : (
                <p className="prose" style={{ color: "var(--ink)" }}>
                  {dashboard.strengthsAndWeaknesses}
                </p>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

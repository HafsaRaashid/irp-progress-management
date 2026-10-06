import { getMyDashboard, listMyDays, type Role } from "@irp/client";
import { graceDeadlineFor, isWeekday, submissionWindow } from "@irp/core";
import { apiClient } from "@/lib/api-client";
import { CycleRibbon } from "@/components/cycle-ribbon/cycle-ribbon";
import { toStudentRibbonDays } from "@/lib/ribbon";
import { Panel } from "@/components/ui/panel";
import { SectionLabel } from "@/components/ui/section-label";
import { CountsRow } from "@/components/ui/counts-row";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { GreetingBand } from "./greeting-band";
import { EntryComposer } from "./entry-composer";
import { AbsenceToggle } from "./absence-toggle";
import { cycleHeading } from "./cycle-heading";
import { streakFor, streakLabel } from "./streak";
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
  const oldest = openWindow.targetDates[openWindow.targetDates.length - 1];
  const newest = openWindow.targetDates[0];

  // listMyDays() defaults to the current evaluation cycle. The window's
  // oldest target can fall in the PREVIOUS cycle -- e.g. today is Monday the
  // 10th (a cycle boundary), so the previous weekday is Friday the 7th --
  // and the default range would silently drop that day's entries. An
  // explicit range spanning the whole submission window avoids it.
  //
  // Two full object literals rather than a single one with `query:
  // maybeUndefined` -- exactOptionalPropertyTypes forbids assigning
  // `undefined` to an optional property that isn't itself typed `| undefined`.
  const query = oldest !== undefined && newest !== undefined ? { from: oldest, to: newest } : undefined;
  const [{ data: dashboard, error: dashboardError }, { data, error }] = await Promise.all([
    getMyDashboard({ client }),
    listMyDays(query !== undefined ? { client, query } : { client }),
  ]);

  const byDate = new Map((data ?? []).map((day) => [day.date, day]));
  // submissionWindow() always includes today as the most recent target
  // (index 0, since targetDates is most-recent-first) -- see its own
  // "Today is always submittable" invariant.
  const today = openWindow.targetDates[0];

  return (
    <div>
      {/*
        The greeting replaces a bare <PageTitle>Today</PageTitle> (§8.2). It
        lives in the page, not the shared frame -- see greeting-band.tsx. The
        dashboard may have failed to load, in which case there is no server
        civil date to print and the band is skipped rather than guessed at:
        a greeting dated from the browser's clock would be wrong in exactly
        the timezone this system cares about.
      */}
      {dashboard !== undefined && <GreetingBand today={dashboard.today} />}
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
            <CycleRibbon
              days={toStudentRibbonDays([...dashboard.days], dashboard.today)}
              extraAfter={[...dashboard.extraAfter]}
              label={cycleHeading(dashboard)}
            />
          </div>

          {/*
            The streak chip sits BESIDE CountsRow, never inside it: CountsRow
            is the status vocabulary (§3.2) and is not modified by this slice.
            This is a personal count in --ink-muted, carrying no status colour,
            because "how many days you have submitted" is not a compliance
            outcome.

            It names no window -- the ribbon directly above already renders
            "Month 3 of 6 · 10 July – 9 August", so the context is one element
            up. FR-30: own data only, a count with its own denominator, never
            a rate, a rank or a peer.
          */}
          <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
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
            {streakLabel(streakFor(dashboard.days)) !== null && (
              <span
                data-testid="streak-chip"
                className="tabular text-sm"
                style={{ color: "var(--ink-muted)" }}
              >
                {streakLabel(streakFor(dashboard.days))}
              </span>
            )}
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
                <EmptyState title="No evaluation yet — your first summary appears after your month closes." />
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

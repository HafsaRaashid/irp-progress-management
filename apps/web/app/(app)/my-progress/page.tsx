import { redirect } from "next/navigation";
import { getMyDashboard, listMyDays } from "@irp/client";
import { getCurrentUserOrRedirect, apiClient } from "@/lib/api-client";
import { PageTitle } from "@/components/ui/page-title";
import { Panel } from "@/components/ui/panel";
import { SectionLabel } from "@/components/ui/section-label";
import { CountsRow } from "@/components/ui/counts-row";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { MentorNote } from "@/components/ui/mentor-note";
import { cycleHeading } from "../cycle-heading";
import { formatCivilDateLabel } from "../format-civil-date";

/** Required-day outcomes whose result is final -- FR-29's history list keeps
 * a day for this reason alone even when it carries no entry (e.g. Missed). */
const SETTLED_STATUSES = new Set(["onTime", "late", "absent", "missed"]);

/**
 * FR-29: the student's own month. FR-30 is structural here — this page calls
 * only /me endpoints, which take no student identifier, so there is no
 * parameter through which another student's data could arrive. It renders no
 * score, no rank and no peer.
 *
 * Since the §8.2 restructure this page is the day-by-day history and nothing
 * else — the ribbon, the outcome counts and the strengths prose live on the
 * student's home, immediately above the composer, where §8.2 places them.
 *
 * Two calls, deliberately: getMyDashboard gives the programme position and the
 * compliance rate; listMyDays gives the entry bodies for the history list. The
 * dashboard is an aggregate and does not carry entry text — folding the two
 * into one call would make the mentor's identical aggregate path pay for prose
 * no mentor screen renders.
 *
 * A mentor reaching this route is redirected home: it is not a security
 * boundary (the API is), just the wrong screen for them — a mentor holds no
 * enrolment and would see an empty month.
 */
/**
 * "Month 3 of 6" as pips — the programme position, which until now rendered
 * only as text inside cycleHeading().
 *
 * Renders NOTHING when `seq` is null. A mid-cycle joiner has no sequence until
 * their first evaluated cycle opens (FR-27), and cycleHeading() already handles
 * that branch by saying so in words; drawing six empty circles beside it would
 * contradict the sentence next to them. Never "Month null of 6", never NaN pips.
 *
 * ENTIRELY aria-hidden, with no screen-reader text of its own. §12 forbids a
 * visual carrying meaning ALONE — these do not: cycleHeading() renders "Month 3
 * of 6 · 10 July – 9 August" as the label immediately beside them, so the
 * information is already in text. An sr-only duplicate here would make a screen
 * reader announce "Month 3 of 6" twice in a row, which is noise, not access.
 * (It also made getByText(/Month 3 of 6/) ambiguous, which is how the
 * duplication was caught.)
 */
function ProgrammePips({ seq, total }: { seq: number | null; total: number }) {
  if (seq === null || total < 1) return null;
  return (
    <div aria-hidden="true" className="flex items-center gap-3">
      <span className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className="inline-block rounded-full"
            style={{
              width: "8px",
              height: "8px",
              // Months already completed and the current one are filled; the
              // rest are outlined. --primary-weak is §3.1's "primary-tinted
              // fill", not a status colour: programme position is not a
              // compliance outcome and must not borrow the status ramp.
              background: i < seq ? "var(--primary)" : "var(--primary-weak)",
              border: i < seq ? "none" : "1px solid var(--line-strong)",
            }}
          />
        ))}
      </span>
    </div>
  );
}

export default async function MyMonthPage() {
  const user = await getCurrentUserOrRedirect();
  if (user.role !== "Student") redirect("/");

  const client = await apiClient();
  const [{ data: dashboard, error }, { data: dayRows, error: daysError }] = await Promise.all([
    getMyDashboard({ client }),
    listMyDays({ client }),
  ]);

  if (error !== undefined || dashboard === undefined) {
    return (
      <div>
        <PageTitle>My progress</PageTitle>
        <Panel>
          <p role="alert" style={{ color: "var(--st-missed)" }}>
            {error?.detail ?? error?.title ?? "Your month could not be loaded."}
          </p>
        </Panel>
      </div>
    );
  }

  const { summary } = dashboard;

  const complianceLabel =
    summary.complianceRate === null ? "— compliance" : `${String(Math.round(summary.complianceRate * 100))}% compliance`;

  // listMyDays defaults to the whole current cycle -- every calendar date,
  // including weekends and days that haven't arrived yet. Rendering one
  // unfiltered card per date meant the 10th of a month opened this page to
  // roughly 29 empty placeholders (a stray weekday with a "—" pill, or a
  // bare-dated weekend card) stacked above whatever real content existed
  // (Finding 4, Plan 7 whole-branch review). A day earns its card by
  // carrying something real: an entry, a recorded absence, or a settled
  // (final) status -- never merely by existing on the calendar. This is a
  // stricter test than "not future": a weekday still open within its grace
  // window with nothing submitted yet is dropped too, same as a quiet
  // weekend, because there is nothing to show for it either.
  //
  // Corollary: the empty-state branch below (orderedDays.length === 0) was
  // unreachable before this filter -- the array always held one row per
  // calendar date. It is now genuinely reachable for a student at the very
  // start of a cycle, before anything has settled.
  //
  // listMyDays returns oldest first; the history list reads newest first
  // (brief R5) — reverse a copy rather than mutating the response.
  const orderedDays = [...(dayRows ?? [])]
    .filter(
      (day) =>
        day.entries.length > 0 || day.absenceReason !== null || SETTLED_STATUSES.has(day.status),
    )
    .reverse();

  return (
    <div>
      <PageTitle>My progress</PageTitle>

      {/*
        The ribbon, the outcome counts and the strengths prose moved to the
        student's home in the §8.2 restructure — that section places all three
        above the composer, and keeping a second copy here would have made this
        page a near-duplicate of it. What is left is the thing home genuinely
        cannot show: the whole cycle day by day, where home lists only the open
        submission window. The heading and the compliance rate stay because a
        history is unreadable without knowing which month it covers and how it
        came out.
      */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>{cycleHeading(dashboard)}</SectionLabel>
          <ProgrammePips seq={dashboard.cycle.seq} total={dashboard.programmeMonths} />
        </div>
        <div className="mt-2">
          <CountsRow items={[{ tone: "ink", text: complianceLabel, strong: true }]} />
        </div>
      </div>

      <SectionLabel>Your days</SectionLabel>
      <div className="mt-2 flex flex-col gap-4">
        {daysError !== undefined ? (
          <Panel>
            <p role="alert" style={{ color: "var(--st-missed)" }}>
              {daysError.detail ?? daysError.title ?? "Your day history could not be loaded."}
            </p>
          </Panel>
        ) : orderedDays.length === 0 ? (
          <Panel>
            <EmptyState
              title="Nothing recorded this month yet."
              hint="Your entries appear here as you submit them."
            />
          </Panel>
        ) : (
          orderedDays.map((day) => (
            <Panel
              key={day.date}
              title={formatCivilDateLabel(day.date)}
              aside={
                day.status === "none" ? undefined : (
                  <StatusPill status={day.status} reportStatus={day.reportStatus} />
                )
              }
            >
              {day.absenceReason !== null && (
                <p style={{ color: "var(--ink-muted)" }}>{day.absenceReason}</p>
              )}

              {day.entries.map((entry) => (
                <p
                  key={entry.id}
                  data-testid="day-entry-body"
                  className="prose"
                  style={{ color: "var(--ink)" }}
                >
                  {entry.body}
                </p>
              ))}

              <MentorNote note={day.mentorNote} />
            </Panel>
          ))
        )}
      </div>

      {/*
        The feedback band, moved here from the student's home (ADR-0031). It
        belongs with the history it describes, and it does not earn a nav item
        of its own: strengthsAndWeaknesses is null for EVERY student in this
        release, because O-5 blocks the AI provider decision and no evaluation
        exists yet. A top-level destination whose only content is an empty
        state teaches the student the app is empty.
      */}
      <div className="mt-8">
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
      </div>
    </div>
  );
}

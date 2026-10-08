import Link from "next/link";
import { redirect } from "next/navigation";
import { civilDate } from "@irp/core";
import { getMyDashboard, listMyDays } from "@irp/client";
import { getCurrentUserOrRedirect, apiClient } from "@/lib/api-client";
import { PageTitle } from "@/components/ui/page-title";
import { Panel } from "@/components/ui/panel";
import { SectionLabel } from "@/components/ui/section-label";
import { CountsRow } from "@/components/ui/counts-row";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { MentorNote } from "@/components/ui/mentor-note";
import { isWithinTrailingWeek } from "../day-range-filter";
import { cycleHeading } from "../cycle-heading";
import { formatCivilDateLabel, ENTRY_TIME_FORMAT } from "../format-civil-date";

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

export default async function MyMonthPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  // "week" is the only non-default value this understands. Anything else --
  // a stray query string, a stale bookmark -- falls back to the full month
  // rather than silently showing nothing.
  const showWeekOnly = range === "week";

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

  // The week filter is a SEPARATE pass over the same content filter above,
  // not a replacement for it: "This week" must still hide a quiet weekend or
  // a day still inside grace, for the same reason the full month does.
  const visibleDays = showWeekOnly
    ? orderedDays.filter((day) => isWithinTrailingWeek(civilDate(day.date), civilDate(dashboard.today)))
    : orderedDays;

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
        <SectionLabel>{cycleHeading(dashboard)}</SectionLabel>
        <div className="mt-2">
          <CountsRow items={[{ tone: "ink", text: complianceLabel, strong: true }]} />
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionLabel>Your days</SectionLabel>
        {/*
          The same chip + aria-current pattern Roster's batch switcher uses
          (house convention), not a client-side toggle: a plain GET link
          keeps the page server-rendered, bookmarkable, and consistent with
          every other filter in the app. Defaults to the full month -- the
          confirmed direction was a toggle, not a default-collapsed view.
        */}
        <div className="flex gap-2">
          <Link href="/my-progress" aria-current={!showWeekOnly ? "page" : undefined} className="chip">
            This month
          </Link>
          <Link href="/my-progress?range=week" aria-current={showWeekOnly ? "page" : undefined} className="chip">
            This week
          </Link>
        </div>
      </div>
      <div className="mt-2">
        {daysError !== undefined ? (
          <Panel>
            <p role="alert" style={{ color: "var(--st-missed)" }}>
              {daysError.detail ?? daysError.title ?? "Your day history could not be loaded."}
            </p>
          </Panel>
        ) : visibleDays.length === 0 ? (
          <Panel>
            <EmptyState
              title={showWeekOnly ? "Nothing recorded this week yet." : "Nothing recorded this month yet."}
              hint="Your entries appear here as you submit them."
            />
          </Panel>
        ) : (
          /*
            A TABLE was considered and set aside (see the conversation this
            answers): every row here can carry a variable number of prose
            entries plus an expandable mentor note, which does not survive
            being forced into fixed cells without truncating the one thing
            this page exists to let a student re-read. A table also reads
            naturally for SHORT, uniform values -- Roster's one row per
            student is exactly that -- but a day's content is neither short
            nor uniform.

            What was genuinely wrong was each day getting its own heavy
            bordered, surfaced box -- N capsules stacked with gaps between
            them, each repeating the same background and border everyone
            could already see belonged to a list, not N separate things. One
            Panel now holds the whole month; a hairline (--line, decorative,
            no contrast requirement -- design-system §3.1) divides days
            instead of a second border per day, and padding comes from
            spacing, not from a box each row has to re-draw.
          */
          <Panel>
            {visibleDays.map((day, i) => (
              <div
                key={day.date}
                // §5's own thesis -- "rhythm IS the density signal" -- applied
                // between DAYS, not just within one: mt-8/pt-8 (double the
                // within-day rhythm below) is what makes "new day" read as a
                // clearly bigger gap than "next entry, same day", rather than
                // the two kinds of break looking the same size.
                className={i > 0 ? "mt-8 border-t pt-8" : ""}
                style={i > 0 ? { borderColor: "var(--line)" } : undefined}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <SectionLabel>{formatCivilDateLabel(day.date)}</SectionLabel>
                  {day.status !== "none" && (
                    <StatusPill status={day.status} reportStatus={day.reportStatus} />
                  )}
                </div>

                {day.absenceReason !== null && (
                  <p style={{ color: "var(--ink-muted)" }}>{day.absenceReason}</p>
                )}

                {/*
                  Each entry is its own uniform block: a meta line (time +
                  outcome) ABOVE the body, never beside it. Side-by-side, the
                  meta column's vertical position drifted with however many
                  lines the body wrapped to, so entries never looked like
                  repeats of the same shape. Stacked, every entry has the
                  identical two-part structure regardless of how long the
                  body runs -- the one thing that can be made consistent
                  without truncating the text itself (§3's own rule: never
                  clip prose in a fixed box).
                */}
                {/*
                  No "On time" pill per entry: that is every entry's DEFAULT
                  state, and the day's own header pill already says so once.
                  Repeating it per entry was furniture, the exact thing §7
                  already rejects a pill for ("a pill reading '— —' … is
                  furniture, not a status"). Late/extra are kept -- those are
                  the genuinely informative case, an entry's own outcome
                  differing from its day's, which is the whole reason this
                  per-entry marker exists.
                */}
                {day.entries.map((entry, j) => (
                  <div key={entry.id} className={j > 0 ? "mt-4" : ""}>
                    <div
                      className="mb-1 flex items-center gap-2 text-sm"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      <span>{ENTRY_TIME_FORMAT.format(new Date(entry.submittedAt))}</span>
                      {(entry.isLate || entry.isExtra) && (
                        <StatusPill status={entry.isLate ? "late" : "extra"} />
                      )}
                    </div>
                    <p data-testid="day-entry-body" className="prose" style={{ color: "var(--ink)" }}>
                      {entry.body}
                    </p>
                  </div>
                ))}

                <div className="mt-3">
                  <MentorNote note={day.mentorNote} />
                </div>
              </div>
            ))}
          </Panel>
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

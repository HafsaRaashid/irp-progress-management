import type { DayStatus } from "@irp/client";

/**
 * The student's motivational line — FR-29's surface, FR-30's constraint.
 *
 * ## The rule this whole module exists to enforce
 *
 * **It may celebrate a high. It must never mourn a low.**
 *
 * A student who is doing well gets told so. A student who is struggling gets
 * told what is still possible — never what they have missed, never a count of
 * failures, never a comparison with a better past self. The system already
 * reports missed days plainly in the counts row and the ribbon; this line is
 * not a second place to be told off, and a motivational slot that turns on you
 * when you are behind is worse than no slot at all.
 *
 * So there is no branch here that mentions a gap, and that is deliberate
 * rather than an oversight — `missed` is read ONLY to decide which encouraging
 * thing to say, never to say it back.
 *
 * FR-30 holds by construction: every input is the caller's own data. There is
 * no peer, no cohort average, no rank, and nothing that could become one.
 */
export interface MotivationInput {
  days: readonly { date: string; status: DayStatus }[];
  /** The server's Colombo civil date. */
  today: string;
  /** Month number in the programme, null for a mid-cycle joiner (FR-27). */
  seq: number | null;
}

/** Statuses that count as "you showed up". Late was accepted — §3.2. */
const SUBMITTED = new Set<DayStatus>(["onTime", "late"]);
/** Outcomes that have settled. A pending day has not happened yet. */
const SETTLED = new Set<DayStatus>(["onTime", "late", "absent", "missed"]);

/**
 * The trailing run of submitted days, newest backwards.
 *
 * An `absent` day is TRANSPARENT: it neither extends nor breaks the run
 * (// ASSUMPTION: O-7 — absence carries no penalty, so being excused should
 * not cost a student their streak). A `missed` day ends it. A `pending` day
 * is skipped, because today being unsubmitted at 9am is not a break.
 */
export function currentRun(days: readonly { status: DayStatus }[]): number {
  let run = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const s = days[i]!.status;
    if (s === "missed") break;
    if (SUBMITTED.has(s)) run += 1;
    // absent / pending / future / none / extra: skip, do not break.
  }
  return run;
}

/** The longest run anywhere in the window, for "your longest yet". */
function longestRun(days: readonly { status: DayStatus }[]): number {
  let best = 0;
  let cur = 0;
  for (const d of days) {
    if (d.status === "missed") { cur = 0; continue; }
    if (SUBMITTED.has(d.status)) { cur += 1; best = Math.max(best, cur); }
  }
  return best;
}

export function motivationFor({ days, today, seq }: MotivationInput): string {
  const settled = days.filter((d) => SETTLED.has(d.status));
  const submittedToday = days.some((d) => d.date === today && SUBMITTED.has(d.status));
  const run = currentRun(days);
  const best = longestRun(days);

  // A brand-new month, before anything has settled. A clean slate is the one
  // honest thing to say, and it is the same message whether last month went
  // well or badly -- which is the point.
  if (settled.length === 0) {
    return seq === null ? "Your first month starts here." : `Month ${String(seq)} starts here.`;
  }

  // Already submitted today. This is the celebratory branch and the only one
  // that looks backwards at all.
  if (submittedToday) {
    if (run >= 2 && run === best && run >= 5) return `${String(run)} days running — your longest yet.`;
    if (run >= 2) return `${String(run)} days running.`;
    // run of 1 after a break: acknowledge the return, never the gap.
    return "Back on it. Logged for today.";
  }

  // Nothing submitted today yet. Everything below is FORWARD-LOOKING by
  // construction -- it is the branch a struggling student lands on, and it
  // must not reach for the missed count to decide what to say.
  if (run >= 5) return `${String(run)} days running — keep it going.`;
  if (run >= 2) return `${String(run)} days running. Today's still open.`;
  return "Today's still open.";
}

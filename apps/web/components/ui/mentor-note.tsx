/**
 * The mentor's note for one day (FR-19), shown to the student attached to the
 * submission it is about.
 *
 * ## Why this is not a "feedback section"
 *
 * It renders NOTHING when there is no note. That is the whole design: a
 * feedback *panel* has to say something when it is empty, so a student with no
 * feedback yet gets a small apology on their dashboard every day until a
 * mentor writes one. Feedback attached to a day simply is not there until it
 * is — it degrades to nothing rather than to a disappointment.
 *
 * It is also why `mentorNote` is null rather than "" when a mentor records
 * attendance without writing anything: "no feedback" and "feedback that
 * happens to be blank" have to stay distinguishable for this to work.
 *
 * Not a status: it carries no colour from the compliance ramp (§3.2). A note
 * is a message, not an outcome, and tinting it green or red would make the
 * mentor's words look like a verdict.
 */
export function MentorNote({ note }: { note: string | null | undefined }) {
  // Total on purpose. The declared contract is `string | null`, but this
  // component's whole job is "render nothing when there is nothing", and a
  // student-facing surface should not crash because a day arrived without the
  // field -- a stale cached response, or an older client against a newer API.
  // Nothing is the correct output for every falsy case.
  if (note === null || note === undefined || note.trim() === "") return null;

  return (
    <div
      data-testid="mentor-note"
      className="mt-3 rounded-[var(--radius-control)] border-l-2 py-2 pl-3"
      style={{ borderColor: "var(--primary)", background: "var(--primary-weak)" }}
    >
      <p
        className="text-xs uppercase tracking-[0.08em]"
        style={{ color: "var(--primary)", fontFamily: "var(--font-mono)" }}
      >
        From your mentor
      </p>
      <p className="prose mt-1" style={{ color: "var(--ink)" }}>{note}</p>
    </div>
  );
}

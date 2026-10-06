import { formatCivilDateLabel } from "./format-civil-date";

/**
 * The student home's opening band — docs/design-system.md §8.2.
 *
 * Replaces a bare `<PageTitle>Today</PageTitle>`. It is rendered BY THE PAGE,
 * never by Topbar or AppFrame: the frame is shared with the mentor, and §6
 * fixes the topbar's contract at "brand and name, nothing else". Putting a
 * greeting there would change the mentor's frame and reopen a settled
 * decision (ADR-0032's two-register boundary).
 *
 * Both halves resolve in Asia/Colombo and neither comes from the browser:
 *
 *  - The DATE is `today`, the server's current Colombo civil date, supplied by
 *    getMyDashboard precisely "so the interface can ring today on the ribbon
 *    without deriving a timezone-sensitive date in the browser".
 *  - The SALUTATION needs an hour, which a civil date does not carry, so it is
 *    derived server-side from `now` formatted through Intl with an explicit
 *    `timeZone: "Asia/Colombo"`. That is NOT "the server's local timezone" —
 *    the zone is named, which is the rule (§12, and CLAUDE.md's time handling).
 *
 * This is a Server Component, so both are evaluated at request time and no
 * clock reaches the client. Do NOT reach for `useEffect` or a client-side
 * `new Date()` to make the greeting "live": it would compute one zone on the
 * server and another in the browser and hydrate mismatched.
 */
const COLOMBO_HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  hour: "numeric",
  hour12: false,
});

/** Returns the hour 0–23 in Asia/Colombo for the given instant. */
export function colomboHour(now: Date): number {
  // "24" is what hour12:false yields for midnight in some ICU builds; it means
  // hour 0. Normalising here rather than at the call site keeps the thresholds
  // below readable.
  return Number(COLOMBO_HOUR.format(now)) % 24;
}

export function salutationFor(now: Date): string {
  const hour = colomboHour(now);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function GreetingBand({ today, now = new Date() }: { today: string; now?: Date }) {
  return (
    <div className="greeting-band mb-6">
      <h1 className="text-2xl font-semibold" style={{ color: "var(--ink)" }}>
        {salutationFor(now)}
      </h1>
      {/*
        §12: "Timestamps render in Asia/Colombo with the zone named in the UI,
        never bare local time." The zone is named here once, on the page's
        opening line, which is what lets every figure below it be read without
        a second qualifier.
      */}
      <p className="tabular mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
        {formatCivilDateLabel(today)} · Colombo
      </p>
    </div>
  );
}

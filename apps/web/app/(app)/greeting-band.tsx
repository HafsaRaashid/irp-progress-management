import { formatCivilDateLabel } from "./format-civil-date";

/**
 * The student home's opening band — docs/design-system.md §8.2.
 *
 * It carries three things: who/when you are (salutation + Colombo date), where
 * you are in the programme (the journey bar), and one line of encouragement.
 *
 * Rendered BY THE PAGE, never by Topbar or AppFrame: the frame is shared with
 * the mentor, and §6 fixes the topbar's contract at "brand and name, nothing
 * else". A greeting there would change the mentor's frame.
 *
 * ## Why the band is a DEEP fill with its own light ink
 *
 * The first version was a near-white tint carrying `--ink`, and it read as an
 * off-white rectangle — the brand colour was invisible on the page it was
 * supposed to brand. That was not a taste failure, it was a measurement one:
 * with dark text on it, `--ink-muted` stops passing 4.5:1 at about chroma
 * 0.05, which caps the fill at "white with a rumour of blue in it".
 *
 * Inverting it removes that cap entirely. White on `--greeting-from` measures
 * 6.91:1 and on `--greeting-to` 4.84:1, so the band can carry the brand colour
 * at full strength. `--greeting-ink` exists for exactly this: the band is the
 * one surface whose text colour is not `--ink`.
 *
 * ## Time
 *
 * Both halves resolve in Asia/Colombo and neither comes from the browser. The
 * DATE is `today`, the server's civil date. The SALUTATION needs an hour,
 * which a civil date does not carry, so it is derived server-side from `now`
 * through Intl with the zone named explicitly — not "the server's local
 * timezone", which is the rule (§12).
 *
 * This is a Server Component, so no clock reaches the client. Do NOT reach for
 * `useEffect` to make the greeting "live": it would compute one zone on the
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
  // hour 0. Normalising here keeps the thresholds below readable.
  return Number(COLOMBO_HOUR.format(now)) % 24;
}

export function salutationFor(now: Date): string {
  const hour = colomboHour(now);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * "Month 3 of 6" as distance travelled rather than a label.
 *
 * Renders nothing when `seq` is null — a mid-cycle joiner has no sequence
 * until their first evaluated cycle opens (FR-27), and a bar at 0% beside
 * "Your first evaluated month starts…" would contradict the sentence next to
 * it. Never "Month null of 6".
 *
 * The bar is `aria-hidden` and the label beside it carries the meaning, so §12
 * holds: the visual never carries it alone.
 */
function JourneyBar({ seq, total }: { seq: number | null; total: number }) {
  if (seq === null || total < 1) return null;
  const pct = Math.min(100, Math.round((seq / total) * 100));
  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="tabular text-xs uppercase tracking-[0.08em]" style={{ opacity: 0.85 }}>
          Month {seq} of {total}
        </span>
        <span className="tabular text-xs" style={{ opacity: 0.7 }}>
          {total - seq === 0 ? "final month" : `${String(total - seq)} to go`}
        </span>
      </div>
      <div aria-hidden="true" className="journey-track">
        <div className="journey-fill" style={{ width: `${String(pct)}%` }} />
      </div>
    </div>
  );
}

export function GreetingBand({
  today,
  seq,
  programmeMonths,
  motivation,
  now = new Date(),
}: {
  today: string;
  seq: number | null;
  programmeMonths: number;
  /** One line from motivation.ts. It may celebrate a high; it never mourns a low. */
  motivation: string;
  now?: Date;
}) {
  return (
    <div className="greeting-band card-rise mb-6">
      <h1 className="text-3xl font-semibold" style={{ letterSpacing: "-0.03em" }}>
        {salutationFor(now)}
      </h1>
      {/*
        §12: "Timestamps render in Asia/Colombo with the zone named in the UI,
        never bare local time." Named once here, on the page's opening line,
        which is what lets every figure below be read without a qualifier.
      */}
      <p className="tabular mt-1 text-sm" style={{ opacity: 0.85 }}>
        {formatCivilDateLabel(today)} · Colombo
      </p>

      <JourneyBar seq={seq} total={programmeMonths} />

      <p data-testid="motivation" className="mt-4 text-base" style={{ opacity: 0.95 }}>
        {motivation}
      </p>
    </div>
  );
}

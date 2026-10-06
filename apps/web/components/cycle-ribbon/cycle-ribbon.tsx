/**
 * The VISUAL mark for one required day. Deliberately distinct from
 * @irp/core's domain-level DayStatus union — this is presentation, that is
 * domain truth, and Plan 6 owns deciding how the two relate. Do not import
 * one where the other is meant.
 */
export type DayMark = "ok" | "partial" | "late" | "absent" | "missed" | "future";

export interface RibbonDay {
  /** ISO date, YYYY-MM-DD. A required day (weekday) only. */
  date: string;
  mark: DayMark;
  /** 0..1, used only when mark === "partial". */
  fill?: number;
  /**
   * Decoration, ORTHOGONAL to mark. Today has a real status like any other day
   * — it may be unsubmitted, partial, or late — so the ring is drawn OVER
   * whatever mark applies rather than replacing it.
   */
  isToday?: boolean;
}

export interface RibbonProps {
  /** Required days only. Weekends never appear here — see extraAfter. */
  days: RibbonDay[];
  /** Dates after which a weekend Extra slot is rendered (FR-33). */
  extraAfter?: string[];
  label?: string;
  caption?: string;
  /**
   * §10's second moment — "Submission lands: the student's day mark fills."
   * OFF by default (ADR-0032), so the mentor's ribbon renders byte-for-byte
   * what it rendered before this existed. Named for what it DOES, never for
   * who uses it: the mentor surfaces get their own redesign on a later branch
   * and will turn this on, so a `studentMode` here would have to be unpicked.
   *
   * This does NOT extend §10's ≤250ms load-stagger budget — it replaces each
   * mark's own rise animation rather than adding to the run.
   */
  celebrate?: boolean;
}

// docs/design-system.md §3.2 / §7: full (ok) · partial (proportional fill,
// same colour family as ok) · ochre notch (late) · slate (absent) ·
// red (missed). "future" is excluded here and rendered as an outline instead
// — §7 "outline (not yet reached)". Today is not a mark of its own — it is a
// ring (isToday) drawn OVER whichever of these colours the day's real status
// produces, so an unsubmitted today still shows as unsubmitted.
// Exported for RibbonKey alone. The key's swatches MUST be the same values the
// bars are drawn with, or it can quietly start describing colours that are no
// longer on screen — a legend that lies is worse than none. counts-row.tsx
// records what happens otherwise: the status vocabulary reached four separate
// inline definitions of these same tokens before it was consolidated. Do not
// re-declare these anywhere; import them.
export const MARK_COLOR: Record<Exclude<DayMark, "future">, string> = {
  ok: "var(--st-ok)",
  partial: "var(--st-ok)",
  late: "var(--st-late)",
  absent: "var(--st-absent)",
  missed: "var(--st-missed)",
};

/**
 * §10 budgets the whole load stagger at ≤250ms. With a 160ms mark animation
 * that leaves 90ms of delay to spread across however many days the cycle has,
 * so the last mark starts at 90ms and finishes at 250ms exactly — the stagger
 * gets tighter as the cycle gets longer rather than the run getting longer.
 */
const STAGGER_WINDOW_MS = 90;

function staggerDelay(index: number, total: number): string {
  if (total <= 1) return "0ms";
  return `${String(Math.round((index / (total - 1)) * STAGGER_WINDOW_MS))}ms`;
}

/** Just the day-of-month, which is what §7's mock shows: `10 11 ⁺ 14 15`. */
function dayOfMonth(iso: string): string {
  return iso.slice(8, 10);
}

function DaySlot({ day, delay, celebrate }: { day: RibbonDay; delay: string; celebrate: boolean }) {
  const heightPct = day.mark === "partial" ? Math.round((day.fill ?? 0) * 100) : 100;
  const background = day.mark === "future" ? "transparent" : MARK_COLOR[day.mark];
  const label = day.isToday === true ? `${day.date}: ${day.mark}, today` : `${day.date}: ${day.mark}`;
  const isToday = day.isToday === true;

  return (
    // The max is what keeps this a register strip. Measured at 1440px with a
    // 21-day cycle: an unbounded flex-1 gave each day ~40px against a 44px
    // track, so the marks rendered as near-squares and the whole thing read as
    // a bar chart of identical bars rather than a row of marks.
    <li aria-label={label} className="flex min-w-[14px] max-w-[22px] flex-1 flex-col items-stretch gap-1">
      {/* The bar track. The today ring lives here rather than on the <li> so
          it frames the mark alone and not the date label beneath it. */}
      <div
        className="relative flex h-11 items-end"
        style={
          isToday
            ? { outline: "1.5px solid var(--primary)", outlineOffset: "2px", borderRadius: "2px" }
            : undefined
        }
      >
        <span
          data-testid="ribbon-bar"
          className={`${celebrate ? "ribbon-mark-celebrate" : "ribbon-mark"} block w-full rounded-[2px]`}
          style={{
            height: `${String(heightPct)}%`,
            background,
            border: day.mark === "future" ? "1px solid var(--line)" : undefined,
            animationDelay: delay,
          }}
        />
      </div>
      {/*
        §7's mock puts the date under every mark ("10 11 ⁺ 14 …"). Without it
        the ribbon showed a dip but not which day dipped, which is the exact
        affordance §7 claims for it ("a mentor sees Tuesday's dip"). Mono and
        tabular per §4 — every figure in this system is. aria-hidden because
        the <li>'s own aria-label already names the full date; announcing a
        bare "14" after it would just be noise.
      */}
      <span
        aria-hidden="true"
        className="tabular text-center text-[10px] leading-none"
        style={{
          fontFamily: "var(--font-mono)",
          color: isToday ? "var(--primary)" : "var(--ink-muted)",
          fontWeight: isToday ? 600 : 400,
        }}
      >
        {dayOfMonth(day.date)}
      </span>
    </li>
  );
}

function ExtraSlot({ after, delay }: { after: string; delay: string }) {
  // Half-width, and distinguished by FORM not colour. A sixth status colour was
  // tried and rejected: a teal at hue 200 lands within 1.01:1 luminance of the
  // ok green, indistinguishable in a dense ribbon for a colour-vision-deficient
  // user. docs/design-system.md §3.2 specifies the exact treatment: "a
  // half-width slot in --ink-muted carrying a + glyph" — both the glyph and the
  // bar below use --ink-muted, never a status colour.
  return (
    <li
      aria-label={`Extra work after ${after}`}
      className="flex min-w-[7px] max-w-[11px] flex-[0.5] flex-col items-stretch gap-1"
    >
      <div className="relative flex h-11 items-end">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] leading-none"
          style={{ color: "var(--ink-muted)" }}
        >
          +
        </span>
        <span
          className="ribbon-mark block w-full rounded-[2px]"
          style={{ height: "60%", background: "var(--ink-muted)", animationDelay: delay }}
        />
      </div>
      {/* No date under an extra slot: §7's mock shows the weekend as a gap in
          the date run ("10 11 ⁺ 14"), which is what keeps the weekday rhythm
          legible. A date here would read as a sixth required day. */}
      <span aria-hidden="true" className="text-center text-[10px] leading-none">
        &nbsp;
      </span>
    </li>
  );
}

/**
 * The signature element (docs/design-system.md §7, FR-28). One bar per REQUIRED
 * day; an Extra slot appears only where a weekend was actually worked (FR-33).
 *
 * Slots are flex-1 within a min/max range rather than a fixed 8px: at 22
 * required days the fixed width left the ribbon occupying about a quarter of
 * its panel, and there was no room under a mark for its date. The max stops a
 * short cycle from stretching into bar-chart territory.
 */
export function CycleRibbon({ days, extraAfter = [], label, caption, celebrate = false }: RibbonProps) {
  const extras = new Set(extraAfter);
  // The stagger runs over rendered slots, extras included, so the sweep reads
  // left-to-right at an even rate rather than pausing at every weekend.
  const slotCount = days.length + days.filter((d) => extras.has(d.date)).length;
  let slotIndex = 0;

  return (
    <figure
      className="rounded-[var(--radius-panel)] border p-6"
      style={{ background: "var(--surface)", borderColor: "var(--line)" }}
    >
      {label !== undefined && (
        <figcaption
          className="tabular mb-3 text-xs uppercase tracking-[0.08em]"
          style={{ color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}
        >
          {label}
        </figcaption>
      )}

      {/*
        §10's second moment: "Submission lands — the student's day mark fills.
        The action visibly enters the register. This is the one delight moment
        in the system." The marks are server-rendered, so after a submission
        React reconciles the existing <li>s in place and a CSS animation, which
        only fires on mount, would never replay. Keying the list on the marks
        it is drawing forces the remount that makes it replay.

        Known deviation: this redraws the whole ribbon, not only the day that
        changed. Isolating the single changed mark needs the previous marks to
        compare against, which is client state this component deliberately does
        not hold. The whole-register redraw reads as intentional; a wrong mark
        animating would not.
      */}
      <ol className="flex items-end gap-[3px]" key={days.map((d) => d.mark).join("")}>
        {days.flatMap((day) => {
          const slots = [
            <DaySlot key={day.date} day={day} delay={staggerDelay(slotIndex++, slotCount)} celebrate={celebrate} />,
          ];
          if (extras.has(day.date)) {
            slots.push(
              <ExtraSlot
                key={`${day.date}-extra`}
                after={day.date}
                delay={staggerDelay(slotIndex++, slotCount)}
              />,
            );
          }
          return slots;
        })}
      </ol>

      {/* Extra days never enter a compliance denominator (FR-12). */}
      <span data-testid="required-day-count" className="sr-only">
        {days.length} required days in this cycle
      </span>

      {caption !== undefined && (
        <p className="tabular mt-3 text-xs" style={{ color: "var(--ink-muted)" }}>
          {caption}
        </p>
      )}
    </figure>
  );
}

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CycleRibbon, type RibbonDay } from "@/components/cycle-ribbon/cycle-ribbon";

const days: RibbonDay[] = [
  { date: "2026-07-10", mark: "ok" },
  { date: "2026-07-13", mark: "late" },
  { date: "2026-07-14", mark: "absent" },
  { date: "2026-07-15", mark: "missed" },
  { date: "2026-07-16", mark: "partial", fill: 0.6 },
  { date: "2026-07-17", mark: "ok", isToday: true },
  { date: "2026-07-20", mark: "future" },
];

describe("CycleRibbon", () => {
  it("renders one slot per required day", () => {
    render(<CycleRibbon days={days} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });

  it("labels every day with its mark for assistive tech", () => {
    render(<CycleRibbon days={days} />);
    for (const d of days) {
      const expected =
        d.isToday === true ? `${d.date}: ${d.mark}, today` : `${d.date}: ${d.mark}`;
      expect(screen.getByLabelText(expected)).toBeInTheDocument();
    }
  });

  it("draws the today ring over the day's real status instead of forcing ok", () => {
    // The bug this guards: `today` used to be a mark of its own, hardcoded to
    // 100% height and the ok colour, so an unsubmitted today rendered as a
    // solid full green bar. isToday must decorate whatever mark applies.
    render(<CycleRibbon days={[{ date: "2026-07-17", mark: "missed", isToday: true }]} />);
    const item = screen.getByLabelText("2026-07-17: missed, today");
    // Queried by test id rather than firstElementChild: the slot now also
    // carries a date label under the bar, and position-based traversal broke
    // silently the moment that landed.
    const bar = item.querySelector('[data-testid="ribbon-bar"]');
    expect(bar).toHaveStyle({ background: "var(--st-missed)", height: "100%" });
    // The ring frames the bar track, not the whole slot — it must not enclose
    // the date label beneath.
    expect(bar?.parentElement).toHaveStyle({ outline: "1.5px solid var(--primary)" });
  });

  it("prints the day-of-month under every required day, but never under an extra slot", () => {
    // §7's mock reads "10 11 ⁺ 14": the weekend is a gap in the date run, which
    // is what keeps the five-a-week weekday rhythm legible.
    render(<CycleRibbon days={days} extraAfter={["2026-07-10"]} />);

    const dayItem = screen.getByLabelText("2026-07-10: ok");
    expect(dayItem.textContent).toContain("10");

    const extraItem = screen.getByLabelText("Extra work after 2026-07-10");
    expect(extraItem.textContent).not.toMatch(/\d/);
  });

  it("staggers the marks left to right inside §10's 250ms budget", () => {
    const { container } = render(<CycleRibbon days={days} />);
    const bars = [...container.querySelectorAll<HTMLElement>('[data-testid="ribbon-bar"]')];
    const delays = bars.map((b) => Number.parseInt(b.style.animationDelay, 10));

    expect(delays[0]).toBe(0);
    // Monotonic: the sweep runs one way, never back on itself.
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]!);
    }
    // 160ms animation + the last delay must still land inside 250ms total.
    expect(delays[delays.length - 1]! + 160).toBeLessThanOrEqual(250);
  });

  it("gives a single-day cycle no delay rather than dividing by zero", () => {
    const { container } = render(<CycleRibbon days={[{ date: "2026-07-10", mark: "ok" }]} />);
    const bar = container.querySelector<HTMLElement>('[data-testid="ribbon-bar"]');
    expect(bar?.style.animationDelay).toBe("0ms");
  });

  it("renders no weekend slot when nobody worked the weekend", () => {
    render(<CycleRibbon days={days} />);
    expect(screen.queryByLabelText(/extra/i)).not.toBeInTheDocument();
  });

  it("renders a half-width extra slot only where a weekend was worked", () => {
    render(<CycleRibbon days={days} extraAfter={["2026-07-10"]} />);
    const extras = screen.getAllByLabelText(/extra work/i);
    expect(extras).toHaveLength(1);
    // FR-33: the slot sits between the Friday and the Monday it falls between,
    // so immediately after the day it follows.
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveAccessibleName(/extra work/i);
  });

  it("does not count an extra slot as a required day", () => {
    render(<CycleRibbon days={days} extraAfter={["2026-07-10"]} />);
    // 7 required + 1 extra = 8 slots, but only 7 are required days.
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByTestId("required-day-count")).toHaveTextContent(
      "7 required days in this cycle",
    );
  });

  it("renders the label and caption when supplied", () => {
    render(<CycleRibbon days={days} label="Cycle 2 · 10 Jul – 9 Aug" caption="8 of 10 submitted today" />);
    expect(screen.getByText("Cycle 2 · 10 Jul – 9 Aug")).toBeInTheDocument();
    expect(screen.getByText("8 of 10 submitted today")).toBeInTheDocument();
  });

  it("applies a proportional fill for a partial day", () => {
    render(<CycleRibbon days={[{ date: "2026-07-16", mark: "partial", fill: 0.6 }]} />);
    const bar = screen
      .getByLabelText("2026-07-16: partial")
      .querySelector('[data-testid="ribbon-bar"]');
    expect(bar).toHaveStyle({ height: "60%" });
  });
});

/**
 * ADR-0032's load-bearing property for this component. The mentor's dashboard
 * renders the same CycleRibbon and must come out of this slice unchanged, which
 * holds only while the DEFAULT path is untouched.
 */
describe("CycleRibbon celebrate (ADR-0032 opt-in)", () => {
  const localDays: RibbonDay[] = [
    { date: "2026-07-10", mark: "ok" },
    { date: "2026-07-13", mark: "late" },
  ];

  it("uses the plain load animation when celebrate is not passed", () => {
    render(<CycleRibbon days={localDays} />);
    for (const bar of screen.getAllByTestId("ribbon-bar")) {
      expect(bar.className).toContain("ribbon-mark");
      expect(bar.className).not.toContain("ribbon-mark-celebrate");
    }
  });

  it("switches to the celebration animation when it is", () => {
    render(<CycleRibbon days={localDays} celebrate />);
    for (const bar of screen.getAllByTestId("ribbon-bar")) {
      expect(bar.className).toContain("ribbon-mark-celebrate");
    }
  });

  /**
   * The celebration REPLACES the rise rather than stacking on it. Two
   * animations on one element would race, and the second would restart the
   * bar from scaleY(0) after the first had settled it — a visible double
   * pump, and §10 budgets the load stagger separately from this moment.
   */
  it("replaces the load animation rather than stacking on it", () => {
    render(<CycleRibbon days={localDays} celebrate />);
    const classes = screen.getAllByTestId("ribbon-bar")[0]!.className.split(/\s+/);
    expect(classes).toContain("ribbon-mark-celebrate");
    expect(classes).not.toContain("ribbon-mark");
  });
});

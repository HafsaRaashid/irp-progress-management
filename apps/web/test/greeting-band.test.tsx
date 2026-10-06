import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GreetingBand, salutationFor, colomboHour } from "@/app/(app)/greeting-band";

/**
 * The band takes its instant as a prop so the salutation is testable without
 * mocking a global clock. Every case below is expressed as a UTC instant and
 * asserted against the COLOMBO hour, because +05:30 is the whole point: a
 * naive implementation that read the runner's local hour would pass in one
 * timezone and fail in another, which is the defect these guard.
 */
describe("salutationFor", () => {
  it("greets by time of day in Asia/Colombo", () => {
    // 03:00 UTC = 08:30 Colombo
    expect(salutationFor(new Date("2026-10-06T03:00:00Z"))).toBe("Good morning");
    // 08:00 UTC = 13:30 Colombo
    expect(salutationFor(new Date("2026-10-06T08:00:00Z"))).toBe("Good afternoon");
    // 14:00 UTC = 19:30 Colombo
    expect(salutationFor(new Date("2026-10-06T14:00:00Z"))).toBe("Good evening");
  });

  /**
   * The cases a UTC-reading implementation gets wrong. At 19:00 UTC it is
   * already 00:30 the NEXT day in Colombo, and at 23:00 UTC it is 04:30 — both
   * are "morning" in Colombo while UTC still calls them evening and night.
   */
  it("crosses midnight on Colombo's clock, not UTC's", () => {
    expect(colomboHour(new Date("2026-10-06T19:00:00Z"))).toBe(0);
    expect(salutationFor(new Date("2026-10-06T19:00:00Z"))).toBe("Good morning");
    expect(colomboHour(new Date("2026-10-06T23:00:00Z"))).toBe(4);
    expect(salutationFor(new Date("2026-10-06T23:00:00Z"))).toBe("Good morning");
  });

  it("puts the boundaries at noon and 5pm Colombo", () => {
    // 06:29 UTC = 11:59 Colombo, 06:31 UTC = 12:01 Colombo
    expect(salutationFor(new Date("2026-10-06T06:29:00Z"))).toBe("Good morning");
    expect(salutationFor(new Date("2026-10-06T06:31:00Z"))).toBe("Good afternoon");
    // 11:29 UTC = 16:59 Colombo, 11:31 UTC = 17:01 Colombo
    expect(salutationFor(new Date("2026-10-06T11:29:00Z"))).toBe("Good afternoon");
    expect(salutationFor(new Date("2026-10-06T11:31:00Z"))).toBe("Good evening");
  });
});

describe("GreetingBand", () => {
  it("renders the salutation as the page heading", () => {
    render(<GreetingBand today="2026-10-06" now={new Date("2026-10-06T03:00:00Z")} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good morning");
  });

  /**
   * The date comes from the SERVER's civil date, not from the rendering clock.
   * Here the instant is 19:00 UTC — already the 7th in Colombo — while `today`
   * says the 6th. The band must print the 6th: `today` is the authority, and a
   * band that re-derived the date from its own clock would disagree with the
   * ribbon rendered directly beneath it.
   */
  it("prints the supplied civil date rather than re-deriving one", () => {
    render(<GreetingBand today="2026-10-06" now={new Date("2026-10-06T19:00:00Z")} />);
    expect(screen.getByText(/6 October/)).toBeInTheDocument();
    expect(screen.queryByText(/7 October/)).not.toBeInTheDocument();
  });

  /** §12: the zone is named in the UI, never a bare local time. */
  it("names the timezone", () => {
    render(<GreetingBand today="2026-10-06" now={new Date("2026-10-06T03:00:00Z")} />);
    expect(screen.getByText(/Colombo/)).toBeInTheDocument();
  });

  /**
   * The gradient is applied through a class whose stops are tokens, never an
   * inline literal — every colour in apps/web resolves through a token, and an
   * inline gradient would not re-theme in dark.
   */
  it("carries the token-driven gradient class rather than an inline colour", () => {
    const { container } = render(
      <GreetingBand today="2026-10-06" now={new Date("2026-10-06T03:00:00Z")} />,
    );
    const band = container.querySelector(".greeting-band");
    expect(band).not.toBeNull();
    expect(band!.getAttribute("style")).toBeNull();
  });
});

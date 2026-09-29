import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/app-frame/sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

/**
 * D5's whole point is that `signOut` (from `@/auth`, server-only) never
 * reaches this Client Component — it is handed in as a `signOutSlot`
 * `ReactNode` instead. Importing `@/auth` here would be a Next.js build
 * error (a Client Component cannot import server-only code), so a
 * regression would surface only at `next build`, not in this test suite.
 * This is a source-level assertion, in the style `test/theme-tokens.test.ts`
 * uses for `globals.css`, so it fails fast in `pnpm test` instead.
 */
describe("sidebar.tsx never imports @/auth", () => {
  const source = readFileSync(
    path.join(import.meta.dirname, "..", "components", "app-frame", "sidebar.tsx"),
    "utf8",
  );

  it("has no import referencing @/auth", () => {
    expect(source).not.toMatch(/from\s+["']@\/auth["']/);
  });
});

describe("Sidebar Settings entry", () => {
  it("offers Settings to a mentor", () => {
    render(<Sidebar role="Admin" />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("offers Settings to a student too — the theme is theirs as much as a mentor's", () => {
    render(<Sidebar role="Student" />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("renders Settings LAST, after every primary destination", () => {
    render(<Sidebar role="Admin" />);
    const labels = screen.getAllByRole("link").map((a) => a.textContent?.trim());
    expect(labels.at(-1)).toBe("Settings");
  });

  it("does not add Settings to the primary role lists", () => {
    // Students see two primary destinations (Today, My month) plus Settings.
    render(<Sidebar role="Student" />);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  // jsdom performs no flexbox layout, so nothing above actually distinguishes
  // "pinned to the bottom via mt-auto + a divider" from "just appended last
  // in the same .map() list" — both produce an href-correct, last-in-order,
  // right-count link. Appending Settings to MENTOR_DESTINATIONS /
  // STUDENT_DESTINATIONS and deleting the separate wrapper would still pass
  // every test above. These two assert the actual mechanism instead: a
  // dedicated wrapper carrying the pinning classes, and a primary-destination
  // count that a wrongly-appended entry would inflate.
  it("renders Settings inside its own mt-auto/border-t wrapper, not the primary .map() list", () => {
    render(<Sidebar role="Admin" />);
    const wrapper = screen.getByRole("link", { name: "Settings" }).parentElement;
    expect(wrapper).toHaveClass("mt-auto", "border-t");
  });

  it("keeps exactly four primary destinations for a mentor, Settings aside", () => {
    render(<Sidebar role="Admin" />);
    const primary = screen
      .getAllByRole("link")
      .map((a) => a.textContent?.trim())
      .filter((label) => label !== "Settings");
    expect(primary).toHaveLength(4);
  });

  it("keeps exactly two primary destinations for a student, Settings aside", () => {
    render(<Sidebar role="Student" />);
    const primary = screen
      .getAllByRole("link")
      .map((a) => a.textContent?.trim())
      .filter((label) => label !== "Settings");
    expect(primary).toHaveLength(2);
  });

  it("renders an icon for every destination", () => {
    const { container } = render(<Sidebar role="Admin" />);
    // Four primary destinations + Settings = five rows, five icons.
    expect(container.querySelectorAll("nav svg")).toHaveLength(5);
  });

  it("keeps the accessible name as the text label alone — icons are decorative", () => {
    render(<Sidebar role="Admin" />);
    // If an icon ever contributed to the name, this exact-match query breaks.
    // That is the assertion that proves the icons are aria-hidden.
    for (const label of ["Today", "Roster", "Cycles", "Students", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks every icon aria-hidden", () => {
    const { container } = render(<Sidebar role="Admin" />);
    for (const svg of container.querySelectorAll("nav svg")) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("draws icons with currentColor, so they follow hover and active states", () => {
    const { container } = render(<Sidebar role="Admin" />);
    // A hardcoded stroke would not flip with .nav-item[data-active] or in dark.
    for (const svg of container.querySelectorAll("nav svg")) {
      expect(svg.getAttribute("stroke")).toBe("currentColor");
    }
  });

  it("renders whatever sign-out slot the server layout hands it", () => {
    render(
      <Sidebar role="Admin" signOutSlot={<button type="submit">Sign out</button>} />,
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("puts the sign-out slot in the bottom group, AFTER Settings", () => {
    render(
      <Sidebar role="Admin" signOutSlot={<button type="submit">Sign out</button>} />,
    );
    const settings = screen.getByRole("link", { name: "Settings" });
    const signOut = screen.getByRole("button", { name: "Sign out" });
    const wrapper = settings.parentElement!;
    // Same wrapper, and Settings first. DOCUMENT_POSITION_FOLLOWING === 4.
    expect(wrapper.contains(signOut)).toBe(true);
    expect(settings.compareDocumentPosition(signOut) & 4).toBeTruthy();
  });

  it("renders nothing extra when no slot is supplied", () => {
    render(<Sidebar role="Admin" />);
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });
});

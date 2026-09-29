import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Topbar } from "@/components/app-frame/topbar";
import { Sidebar } from "@/components/app-frame/sidebar";

// No `@/auth` mock here: sign-out moved to the sidebar (O-15) as a
// `signOutSlot` the SERVER layout builds and passes down — neither Topbar
// nor Sidebar imports `@/auth` themselves, so there is nothing left in this
// file for such a mock to intercept.

// Sidebar became a Client Component to read usePathname — that is the only
// way it can know which destination is current, since a layout does not
// re-render on navigation within its own segment.
const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn(() => "/") }));
vi.mock("next/navigation", () => ({ usePathname }));

describe("Topbar", () => {
  it("shows the signed-in user's name", () => {
    render(<Topbar userName="Damian De Cruz" />);
    expect(screen.getByText("Damian De Cruz")).toBeInTheDocument();
  });

  // The `batchName` prop this once covered is gone: it was never passed by the
  // layout, `User` carries no batch, and §6's global batch switcher is served
  // instead by the per-page Roster/Cycles chips. Recorded in
  // docs/design-system.md §13.

  it("is a banner landmark 56px tall", () => {
    render(<Topbar userName="A" />);
    expect(screen.getByRole("banner")).toHaveStyle({ height: "56px" });
  });

  // Sign-out moved out of the Topbar and into the Sidebar (O-15): it is no
  // longer this component's control to offer. Coverage that the app frame
  // offers sign-out now lives on Sidebar — see "renders whatever sign-out
  // slot the server layout hands it" in test/sidebar.test.tsx.
});

describe("Sidebar", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
  });

  it("marks the current destination with aria-current and the active-nav fill", () => {
    usePathname.mockReturnValue("/roster");
    render(<Sidebar role="Admin" />);

    expect(screen.getByRole("link", { name: /Roster/ })).toHaveAttribute("aria-current", "page");
    // §12: colour never carries meaning alone, so the state is also an
    // attribute assistive tech can read.
    expect(screen.getByRole("link", { name: /Cycles/ })).not.toHaveAttribute("aria-current");
  });

  it("does not light up Today on every page just because every path starts with /", () => {
    // The bug a prefix test would introduce: "/" prefixes literally every
    // route, so Today would read as current on Roster, Review and the rest.
    usePathname.mockReturnValue("/cycles");
    render(<Sidebar role="Admin" />);

    expect(screen.getByRole("link", { name: /Today/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /Cycles/ })).toHaveAttribute("aria-current", "page");
  });

  it("is a navigation landmark 216px wide", () => {
    render(<Sidebar role="Admin" />);
    expect(screen.getByRole("navigation")).toHaveStyle({ width: "216px" });
  });

  it("renders Today as a real link now that / has a page, on both role variants", () => {
    // Task 9 added apps/web/app/(app)/page.tsx, so "/" is a route typedRoutes
    // accepts. Today is a link; it carries no aria-disabled.
    for (const role of ["Admin", "Student"] as const) {
      const { unmount } = render(<Sidebar role={role} />);
      const today = screen.getByRole("link", { name: /Today/ });
      expect(today).toHaveAttribute("href", "/");
      expect(today).not.toHaveAttribute("aria-disabled");
      unmount();
    }
  });

  it("mentor (Admin) role: Roster, Cycles, and Students are all real links", () => {
    // Task 13 added apps/web/app/(app)/roster/page.tsx, Task 15 added
    // apps/web/app/(app)/students/page.tsx, and Task 7 added
    // apps/web/app/(app)/cycles/page.tsx, so all three are real links.
    // "Review" (Task 14) was deliberately dropped from the nav -- its own
    // landing page had no directory of its own and only pointed back at
    // Roster, which already links straight to /review/[studentId] per row.
    render(<Sidebar role="Admin" />);

    const roster = screen.getByRole("link", { name: /Roster/ });
    expect(roster).toHaveAttribute("href", "/roster");
    expect(roster).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("link", { name: /^Review$/ })).not.toBeInTheDocument();

    const cycles = screen.getByRole("link", { name: /Cycles/ });
    expect(cycles).toHaveAttribute("href", "/cycles");
    expect(cycles).not.toHaveAttribute("aria-disabled");

    const students = screen.getByRole("link", { name: /Students/ });
    expect(students).toHaveAttribute("href", "/students");
    expect(students).not.toHaveAttribute("aria-disabled");
  });

  it("Student role: My month is a real link now that /my-month has a page, on the Student list", () => {
    // Task 8 added apps/web/app/(app)/my-month/page.tsx, so "/my-month" is a
    // route typedRoutes accepts. My month is a link; it carries no
    // aria-disabled.
    render(<Sidebar role="Student" />);

    const myMonth = screen.getByRole("link", { name: /My month/ });
    expect(myMonth).toHaveAttribute("href", "/my-month");
    expect(myMonth).not.toHaveAttribute("aria-disabled");
  });

  it("Student role: sees only Today and My month -- no mentor-only destinations at all", () => {
    // Role gating hides mentor destinations entirely rather than merely
    // disabling them -- a Student should find no trace of Roster, Cycles, or
    // Students in the DOM, even though every one of those is now a real link
    // on the mentor list.
    render(<Sidebar role="Student" />);

    for (const item of ["Roster", "Cycles", "Students"]) {
      expect(screen.queryByText(new RegExp(item))).not.toBeInTheDocument();
    }
  });
});

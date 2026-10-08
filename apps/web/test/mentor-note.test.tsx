import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MentorNote } from "@/components/ui/mentor-note";

/**
 * MentorNote is a DISCLOSURE, not an always-visible panel. A day-by-day
 * history is a scan surface, and an always-open note on every card competes
 * with the entry text for attention on most of them, which carry none. These
 * tests pin the collapsed-by-default behaviour so a future change cannot
 * silently make it always-open again.
 */
describe("MentorNote", () => {
  it("renders nothing when there is no note", () => {
    const { container } = render(<MentorNote note={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the field is undefined -- a stale response or older client", () => {
    const { container } = render(<MentorNote note={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a blank or whitespace-only note", () => {
    const { container } = render(<MentorNote note="   " />);
    expect(container.firstChild).toBeNull();
  });

  it("offers a View feedback button when a note exists, with the note TEXT NOT YET in the document", () => {
    render(<MentorNote note="Strong pairing session." />);
    expect(screen.getByRole("button", { name: "View feedback" })).toBeInTheDocument();
    expect(screen.queryByText("Strong pairing session.")).not.toBeInTheDocument();
  });

  it("is collapsed by default, aria-expanded=false", () => {
    render(<MentorNote note="Strong pairing session." />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("reveals the note on click, and announces it via aria-expanded", () => {
    render(<MentorNote note="Strong pairing session." />);
    fireEvent.click(screen.getByRole("button", { name: "View feedback" }));

    expect(screen.getByText("Strong pairing session.")).toBeInTheDocument();
    expect(screen.getByText("From your mentor")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    // The label itself changes too, not just the ARIA attribute (§12: never a
    // state carried by one signal alone).
    expect(screen.getByRole("button", { name: "Hide feedback" })).toBeInTheDocument();
  });

  it("hides the note again on a second click", () => {
    render(<MentorNote note="Strong pairing session." />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(screen.getByText("Strong pairing session.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide feedback" }));
    expect(screen.queryByText("Strong pairing session.")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  /** §12: status/state is never carried by colour or a glyph alone. */
  it("hides its chevron from assistive technology, relying on the button's own text and aria-expanded", () => {
    const { container } = render(<MentorNote note="Strong pairing session." />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

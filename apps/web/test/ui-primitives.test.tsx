import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldLabel } from "@/components/ui/field-label";
import { Table, Th, Td } from "@/components/ui/table";

describe("Button", () => {
  it("renders the primary variant", () => {
    render(<Button variant="primary">Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.className).toContain("btn-primary");
  });

  it("renders the quiet variant", () => {
    render(<Button variant="quiet">Cancel</Button>);
    const btn = screen.getByRole("button", { name: "Cancel" });
    expect(btn.className).toContain("btn-quiet");
  });

  it("renders the danger variant", () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.className).toContain("btn-danger");
  });

  it("disables the control when disabled is passed", () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("renders the loading state as reduced-opacity text with aria-busy, never a spinner swap", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Save");
  });

  it("marks the error state with data-error when set", () => {
    render(<Button error>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("data-error", "true");
  });

  it("omits data-error when not set", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("data-error");
  });
});

describe("StatusPill", () => {
  it.each([
    ["onTime", "●", "On time"],
    ["late", "◐", "Late"],
    ["absent", "○", "Absent"],
    ["missed", "✕", "Missed"],
    ["pending", "·", "Open"],
    ["extra", "+", "Extra"],
  ] as const)("renders glyph + label for status %s", (status, glyph, label) => {
    // Query the pill by its data-status attribute rather than by text: the
    // accessible text is glyph and label concatenated, which a substring
    // query would match ambiguously.
    const { container } = render(<StatusPill status={status} />);
    const pill = container.querySelector(`[data-status="${status}"]`);
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe(`${glyph}${label}`);
  });

  it.each(["none", "future"] as const)("renders nothing at all for status %s", (status) => {
    // These two mean "nothing has happened here yet", which is not one of
    // §3.2's statuses. They used to render a pill containing "——" — on the
    // review page that produced a column of empty pills down every
    // not-yet-reached day, which is furniture, not information.
    const { container } = render(<StatusPill status={status} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders a reportStatus that has no day outcome of its own", () => {
    // A day can be In review before its own outcome settles, so the suppression
    // above must not swallow the review state too.
    render(<StatusPill status="future" reportStatus="InReview" />);
    expect(screen.getByText(/In review/)).toBeInTheDocument();
  });

  it("appends the In review suffix when reportStatus is InReview", () => {
    render(<StatusPill status="pending" reportStatus="InReview" />);
    expect(screen.getByText(/In review/)).toBeInTheDocument();
  });

  it("appends the Saved suffix with its lock glyph when reportStatus is Evaluated", () => {
    // §3.2 specifies Evaluated as "--ink + lock glyph". The word carries the
    // meaning (§12: never a glyph alone), so the glyph is aria-hidden and
    // asserted structurally rather than by accessible name.
    const { container } = render(<StatusPill status="onTime" reportStatus="Evaluated" />);
    expect(screen.getByText(/· Saved/)).toBeInTheDocument();
    expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("appends no suffix when reportStatus is null", () => {
    render(<StatusPill status="onTime" />);
    expect(screen.queryByText(/In review/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Evaluated/)).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="No entries yet" />);
    expect(screen.getByText("No entries yet")).toBeInTheDocument();
  });

  it("renders the hint when supplied and omits it otherwise", () => {
    const { rerender } = render(<EmptyState title="No entries yet" hint="Submit today's update." />);
    expect(screen.getByText("Submit today's update.")).toBeInTheDocument();
    rerender(<EmptyState title="No entries yet" />);
    expect(screen.queryByText("Submit today's update.")).not.toBeInTheDocument();
  });
});

describe("FieldLabel", () => {
  it("renders a <label> bound to its control", () => {
    render(
      <>
        <FieldLabel htmlFor="roster-date">Date</FieldLabel>
        <input id="roster-date" />
      </>,
    );
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
  });

  it("carries the 12px uppercase tracked treatment, so no page has to restate it", () => {
    render(<FieldLabel htmlFor="x">Batch</FieldLabel>);
    const label = screen.getByText("Batch");
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("text-xs");
  });
});

describe("Table", () => {
  it("renders a real table with scoped column headers", () => {
    render(
      <Table>
        <thead>
          <tr><Th>Student</Th><Th>Status</Th></tr>
        </thead>
        <tbody>
          <tr><Td>Amaya</Td><Td>On time</Td></tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Student" })).toHaveAttribute("scope", "col");
    expect(screen.getAllByRole("cell")).toHaveLength(2);
  });

  it("right-aligns and tabular-figures a numeric cell on request", () => {
    render(<Table><tbody><tr><Td numeric>22</Td></tr></tbody></Table>);
    expect(screen.getByRole("cell").className).toContain("tabular");
  });
});

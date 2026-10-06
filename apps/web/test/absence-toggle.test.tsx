import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AbsenceToggle } from "@/app/(app)/absence-toggle";

// absence-toggle.tsx imports removeAbsence via the relative specifier
// "./entry-actions"; mocking through the "@/" alias resolves to the same
// absolute file, same pattern as entry-composer.test.tsx.
const { removeAbsence } = vi.hoisted(() => ({ removeAbsence: vi.fn() }));

vi.mock("@/app/(app)/entry-actions", () => ({ removeAbsence }));

/**
 * This component is REMOVAL-ONLY. Marking absent moved into the composer,
 * which already owns the date picker — "submit an update" and "I was absent"
 * are two answers to the same question and were asking for the date twice, in
 * two different widgets. The marking cases live in entry-composer.test.tsx.
 */
describe("AbsenceToggle", () => {
  it("shows the recorded reason and a Remove control", () => {
    render(<AbsenceToggle date="2026-07-31" absenceReason="Medical appointment" />);
    expect(screen.getByText(/Marked absent/)).toHaveTextContent("Medical appointment");
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("offers no way to mark absent — that is the composer's job now", () => {
    render(<AbsenceToggle date="2026-07-31" absenceReason="Medical appointment" />);
    expect(screen.queryByRole("button", { name: "Mark absent" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Absence reason/)).not.toBeInTheDocument();
  });

  it("surfaces removeAbsence's error as role=alert -- the earlier plain-form wiring discarded this", async () => {
    removeAbsence.mockResolvedValueOnce({ error: "The absence was not removed." });
    render(<AbsenceToggle date="2026-07-31" absenceReason="Medical appointment" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The absence was not removed.");
  });
});

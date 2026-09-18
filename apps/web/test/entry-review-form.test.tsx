import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EntryReviewForm } from "@/app/(app)/review/[studentId]/entry-review-form";

// Same hoisting reasoning as entry-composer.test.tsx: vi.mock's factory runs
// before this file's other statements, so it cannot close over a plain
// top-level const.
const { reviewEntry } = vi.hoisted(() => ({ reviewEntry: vi.fn() }));
vi.mock("@/app/(app)/review/[studentId]/review-actions", () => ({ reviewEntry }));

describe("EntryReviewForm", () => {
  it("starts blank when the entry has never been reviewed", () => {
    render(
      <EntryReviewForm
        studentId="s1"
        entryId="e1"
        defaults={{ score: null, mentorFeedback: null, countsTowardEvaluation: false }}
      />,
    );
    expect(screen.getByLabelText("Score, 0 to 100")).toHaveValue(null);
    expect(screen.getByLabelText("Mentor feedback")).toHaveValue("");
    expect(screen.getByLabelText("Counts toward evaluation")).not.toBeChecked();
  });

  it("prefills every field from the entry's current review -- a reopen must not start blank", () => {
    // reviewEntry is a full replace (spec §3), so an unprefilled reopen would
    // silently revert an already-scored entry to null/false on the next save.
    render(
      <EntryReviewForm
        studentId="s1"
        entryId="e1"
        defaults={{ score: 88, mentorFeedback: "Solid work.", countsTowardEvaluation: true }}
      />,
    );
    expect(screen.getByLabelText("Score, 0 to 100")).toHaveValue(88);
    expect(screen.getByLabelText("Mentor feedback")).toHaveValue("Solid work.");
    expect(screen.getByLabelText("Counts toward evaluation")).toBeChecked();
  });

  it("renders no error before any submission", () => {
    render(
      <EntryReviewForm
        studentId="s1"
        entryId="e1"
        defaults={{ score: null, mentorFeedback: null, countsTowardEvaluation: false }}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces the action's error message as a role=alert on failure", async () => {
    reviewEntry.mockResolvedValueOnce({ error: "The review was not accepted." });
    render(
      <EntryReviewForm
        studentId="s1"
        entryId="e1"
        defaults={{ score: null, mentorFeedback: null, countsTowardEvaluation: false }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Score, 0 to 100"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Mentor feedback"), {
      target: { value: "Needs more detail." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The review was not accepted.");
  });

  it("submits studentId, entryId, score, feedback, and the evaluation flag through the action", async () => {
    reviewEntry.mockResolvedValueOnce({ ok: true });
    render(
      <EntryReviewForm
        studentId="s1"
        entryId="e1"
        defaults={{ score: null, mentorFeedback: null, countsTowardEvaluation: false }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Score, 0 to 100"), { target: { value: "85" } });
    fireEvent.change(screen.getByLabelText("Mentor feedback"), { target: { value: "Good detail." } });
    fireEvent.click(screen.getByLabelText("Counts toward evaluation"));
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));

    await screen.findByText("Review saved.");
    expect(reviewEntry).toHaveBeenCalled();
    // .at(-1), not [0]: reviewEntry's call history accumulates across this
    // file's earlier tests (nothing clears it between tests), so the most
    // recent call is the only one this assertion can trust.
    const [, formData] = reviewEntry.mock.calls.at(-1) as [unknown, FormData];
    expect(formData.get("studentId")).toBe("s1");
    expect(formData.get("entryId")).toBe("e1");
    expect(formData.get("score")).toBe("85");
    expect(formData.get("feedback")).toBe("Good detail.");
    expect(formData.get("countsTowardEvaluation")).toBe("on");
  });
});

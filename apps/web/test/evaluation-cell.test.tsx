import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvaluationCell } from "@/components/evaluation/evaluation-cell";

// EvaluationCell drives evaluateAction/overrideAction (apps/web/app/(app)/cycles/evaluate-action.ts)
// through useActionState so a 409/502/503 can be surfaced to the mentor --
// those are "use server" functions that reach @irp/client, which this
// component test has no business invoking for real (no apiClient, no
// network). Mocking the module is what the rest of this suite's client
// components (e.g. AbsenceToggle driving entry-actions.ts) rely on too.
vi.mock("@/app/(app)/cycles/evaluate-action", () => ({
  evaluateAction: vi.fn(),
  overrideAction: vi.fn(),
}));

describe("EvaluationCell", () => {
  it("shows an Evaluate button and no score when ungenerated and the cycle is closed", () => {
    render(<EvaluationCell studentId="s1" cycleSeq={1} evaluation={null} cycleIsClosed />);
    expect(screen.getByRole("button", { name: "Evaluate" })).toBeInTheDocument();
    expect(screen.queryByText(/performance/i)).not.toBeInTheDocument();
  });

  it("shows 'Awaiting evaluation', no button, when the cycle has not closed yet", () => {
    render(<EvaluationCell studentId="s1" cycleSeq={1} evaluation={null} cycleIsClosed={false} />);
    expect(screen.getByText("Awaiting evaluation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Evaluate" })).not.toBeInTheDocument();
  });

  it("shows the AI score and an Override control when evaluated with no override", () => {
    render(
      <EvaluationCell
        studentId="s1"
        cycleSeq={1}
        cycleIsClosed
        evaluation={{
          id: "eval-1", studentId: "s1", cycleSeq: 1, attendance: 80, taskCompletion: 90,
          contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85, performanceIndex: 79,
          summary: "Solid month.", modelVersion: "gpt-4o-mini-2024-10-21", override: null,
        }}
      />,
    );
    expect(screen.getByText("79")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Override" })).toBeInTheDocument();
  });

  it("shows the override score, not the AI score, once overridden", () => {
    render(
      <EvaluationCell
        studentId="s1"
        cycleSeq={1}
        cycleIsClosed
        evaluation={{
          id: "eval-1", studentId: "s1", cycleSeq: 1, attendance: 80, taskCompletion: 90,
          contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85, performanceIndex: 79,
          summary: "Solid month.", modelVersion: "gpt-4o-mini-2024-10-21",
          override: { newScore: 85, originalScore: 79, reason: "Strong finish." },
        }}
      />,
    );
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText(/overridden from 79/i)).toBeInTheDocument();
  });
});

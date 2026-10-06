import { describe, expect, it, vi } from "vitest";
import { civilDate } from "@irp/core";
import { createEvaluationService } from "../src/services/evaluation-service.js";
import {
  CycleNotClosedError, EvaluationExistsError, EnrolmentDoesNotSpanCycleError, BatchNotFoundError,
  EvaluationNotFoundError,
} from "../src/domain/errors.js";

const BATCH = { id: "b1", name: "Batch 1", startDate: civilDate("2026-01-10"), endDate: civilDate("2030-01-10") };

function deps(overrides: Record<string, unknown> = {}) {
  return {
    batchRepo: {
      getBatch: vi.fn().mockResolvedValue(BATCH),
      listEnrolments: vi.fn().mockResolvedValue([
        { id: "e1", studentId: "s1", batchId: "b1", startDate: civilDate("2026-01-10"), endDate: null },
      ]),
      ...((overrides.batchRepo as object) ?? {}),
    },
    entryRepo: { listEntries: vi.fn().mockResolvedValue([]) },
    mentorRecordRepo: { listForStudent: vi.fn().mockResolvedValue([]) },
    absenceRepo: { listForStudent: vi.fn().mockResolvedValue([]) },
    evaluationRepo: {
      upsertCycle: vi.fn().mockResolvedValue("cycle-1"),
      findEvaluation: vi.fn().mockResolvedValue(null),
      findEvaluationById: vi.fn().mockResolvedValue(null),
      createEvaluation: vi.fn().mockImplementation((input: Record<string, unknown>) =>
        Promise.resolve({ id: "eval-1", cycleSeq: 1, ...input, performanceIndex: String(input.performanceIndex) })),
      findOverride: vi.fn().mockResolvedValue(null),
      createOverride: vi.fn(),
      ...((overrides.evaluationRepo as object) ?? {}),
    },
    aiClient: {
      evaluate: vi.fn().mockResolvedValue({
        result: {
          attendance: 80, taskCompletion: 90, contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85,
          summary: "Solid month.",
        },
        modelVersion: "gpt-4o-mini-2024-10-21",
      }),
    },
    userRepo: { findById: vi.fn().mockResolvedValue({ id: "s1", displayName: "Test Student" }) },
  };
}

describe("EvaluationService.generateForCycle", () => {
  it("computes performanceIndex from the fixed weights (20/25/25/10/20)", async () => {
    const service = createEvaluationService(deps());
    // Cycle 1 of a batch starting 2026-01-10 closes 2026-02-09; "now" after that.
    const view = await service.generateForCycle("b1", "s1", 1, new Date("2026-02-15T00:00:00Z"));
    // 80*.20 + 90*.25 + 70*.25 + 60*.10 + 85*.20 = 16 + 22.5 + 17.5 + 6 + 17 = 79
    expect(view.performanceIndex).toBeCloseTo(79, 5);
  });

  it("409s when the cycle has not closed yet", async () => {
    const service = createEvaluationService(deps());
    await expect(
      service.generateForCycle("b1", "s1", 1, new Date("2026-01-20T00:00:00Z")),
    ).rejects.toBeInstanceOf(CycleNotClosedError);
  });

  it("409s when an evaluation already exists for this cycle+student", async () => {
    const d = deps({
      evaluationRepo: { findEvaluation: vi.fn().mockResolvedValue({ id: "existing-eval" }) },
    });
    const service = createEvaluationService(d);
    await expect(
      service.generateForCycle("b1", "s1", 1, new Date("2026-02-15T00:00:00Z")),
    ).rejects.toBeInstanceOf(EvaluationExistsError);
  });

  it("409s when the student's enrolment does not span the whole cycle (FR-27)", async () => {
    const d = deps({
      batchRepo: {
        listEnrolments: vi.fn().mockResolvedValue([
          // Joined mid-cycle -- does not cover the cycle's start.
          { id: "e1", studentId: "s1", batchId: "b1", startDate: civilDate("2026-01-20"), endDate: null },
        ]),
      },
    });
    const service = createEvaluationService(d);
    await expect(
      service.generateForCycle("b1", "s1", 1, new Date("2026-02-15T00:00:00Z")),
    ).rejects.toBeInstanceOf(EnrolmentDoesNotSpanCycleError);
  });

  it("404s via BatchNotFoundError when the batch doesn't exist", async () => {
    const d = deps({ batchRepo: { getBatch: vi.fn().mockResolvedValue(null) } });
    const service = createEvaluationService(d);
    await expect(
      service.generateForCycle("no-such-batch", "s1", 1, new Date("2026-02-15T00:00:00Z")),
    ).rejects.toBeInstanceOf(BatchNotFoundError);
  });
});

describe("EvaluationService.override", () => {
  it("stores the new score, the original AI score, and the reason (FR-24)", async () => {
    const d = deps({
      evaluationRepo: {
        findEvaluationById: vi.fn().mockResolvedValue({
          id: "eval-1", cycleId: "cycle-1", cycleSeq: 1, studentId: "s1",
          attendance: 80, taskCompletion: 90, contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85,
          performanceIndex: "79", summary: "Solid month.", modelVersion: "gpt-4o-mini-2024-10-21", createdAt: new Date(),
        }),
        // override() calls createOverride then toView(evaluation) — cycleSeq
        // comes from the evaluation record itself (its joined Cycle.seq),
        // not a parameter. toView reads the override back via findOverride
        // exactly once — it does not take createOverride's own return value
        // as the source of truth, so this mock is what the assertion below
        // actually reads.
        findOverride: vi.fn().mockResolvedValue({
          id: "ov1", evaluationId: "eval-1", mentorId: "m1", newScore: "85", originalScore: "79", reason: "Strong finish.",
        }),
        createOverride: vi.fn().mockResolvedValue({
          id: "ov1", evaluationId: "eval-1", mentorId: "m1", newScore: "85", originalScore: "79", reason: "Strong finish.",
        }),
      },
    });
    const service = createEvaluationService(d);
    const result = await service.override("eval-1", "m1", 85, "Strong finish.");
    expect(result.cycleSeq).toBe(1);
    expect(result.studentId).toBe("s1");
    expect(result.override).toEqual({ newScore: 85, originalScore: 79, reason: "Strong finish." });
  });

  it("404s via EvaluationNotFoundError when the evaluation id does not exist", async () => {
    const d = deps({ evaluationRepo: { findEvaluationById: vi.fn().mockResolvedValue(null) } });
    const service = createEvaluationService(d);
    await expect(service.override("no-such-eval", "m1", 85, "x")).rejects.toBeInstanceOf(EvaluationNotFoundError);
  });
});

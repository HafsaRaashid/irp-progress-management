import type { EvaluationAiClient, EvaluationAiResult } from "../../src/services/evaluation-ai-client.js";

const FIXED_RESULT: EvaluationAiResult = {
  attendance: 80,
  taskCompletion: 90,
  contributionInitiative: 70,
  effortTime: 60,
  mentorEvaluation: 85,
  summary: "You submitted on time for most of this cycle's required days.",
};

/**
 * A fake `EvaluationAiClient` returning a fixed, valid result — no real
 * network call is ever made in a test. Same principle as every other fake
 * in this directory (e.g. `fake-notification-service.ts`); overriding the
 * resolved value lets an individual test assert on a different score shape
 * without touching the default every other test relies on.
 */
export function fakeEvaluationAiClient(
  overrides: Partial<EvaluationAiResult> = {},
): EvaluationAiClient {
  return {
    evaluate: () =>
      Promise.resolve({
        result: { ...FIXED_RESULT, ...overrides },
        modelVersion: "gpt-4o-mini-2024-10-21-test",
      }),
  };
}

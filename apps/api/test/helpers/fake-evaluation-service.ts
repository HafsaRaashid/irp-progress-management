import type { EvaluationService } from "../../src/services/evaluation-service.js";

/**
 * A stub for suites that construct `buildServer` without a database
 * connection (auth/plumbing tests). No route that calls `evaluationService`
 * is exercised in those files, so a call here is a test bug, not a
 * legitimate path. Same pattern as `unusedNotificationService`.
 */
export function unusedEvaluationService(): EvaluationService {
  const unused = () => {
    throw new Error("unused: evaluationService was not expected to be called in this suite");
  };
  return {
    generateForCycle: unused,
    getEvaluation: unused,
    override: unused,
  };
}

import type { DayService } from "../../src/services/day-service.js";

/**
 * A stub for suites that construct `buildServer` without a database
 * connection (auth/plumbing tests). `/api/v1/me/days` is never exercised in
 * those files, so the method throws if it is ever reached — that is a test
 * bug, not a legitimate call path. Same pattern as `unusedEntryRepo`.
 */
export function unusedDayService(): DayService {
  const unused = () => {
    throw new Error("unused: dayService was not expected to be called in this suite");
  };
  return {
    listDays: unused,
    listDaysForStudents: unused,
    currentCycleStart: unused,
  };
}

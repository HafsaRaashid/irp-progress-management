import type { MentorRecordRepo } from "../../src/db/mentor-record-repo.js";

/**
 * A stub for suites that construct `buildServer` without a database
 * connection (auth/plumbing tests). No review route is exercised in those
 * files, so every method throws if it is ever reached — that is a test bug,
 * not a legitimate call path. Same pattern as `unusedBatchRepo`.
 */
export function unusedMentorRecordRepo(): MentorRecordRepo {
  const unused = () => {
    throw new Error("unused: mentorRecordRepo was not expected to be called in this suite");
  };
  return {
    upsert: unused,
    get: unused,
    listForStudent: unused,
    listForStudents: unused,
  };
}

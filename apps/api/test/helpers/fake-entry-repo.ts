import type { EntryRepo } from "../../src/db/entry-repo.js";

/**
 * A stub for suites that construct `buildServer` without a database
 * connection (auth/plumbing tests). `/api/v1/entries` is never exercised in
 * those files, so every method throws if it is ever reached — that is a test
 * bug, not a legitimate call path.
 */
export function unusedEntryRepo(): EntryRepo {
  const unused = () => {
    throw new Error("unused: entryRepo was not expected to be called in this suite");
  };
  return {
    addEntry: unused,
    listEntries: unused,
    getReport: unused,
    listReports: unused,
    listEntriesForStudents: unused,
    listReportsForStudents: unused,
    transition: unused,
  };
}

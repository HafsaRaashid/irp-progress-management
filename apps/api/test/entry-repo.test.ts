import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { civilDate } from "@irp/core";
import { createPrismaClient } from "../src/db/client.js";
import { createEntryRepo } from "../src/db/entry-repo.js";
import { toDbDate } from "../src/db/civil-date-map.js";
import { AbsentDayConflictError, LockedDayError, SubmissionWindowClosedError } from "../src/domain/errors.js";
import { resetDb } from "./helpers/db.js";
import { dbUrl } from "./helpers/require-db.js";

// 2026-08-03 is a Monday. 11:30Z = 17:00 Colombo.
const MONDAY = civilDate("2026-08-03");
const MONDAY_5PM = new Date("2026-08-03T11:30:00Z");

describe.skipIf(!dbUrl)("createEntryRepo", () => {
  const prisma = createPrismaClient(dbUrl!);
  const repo = createEntryRepo(prisma);

  beforeEach(async () => { await resetDb(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function student(externalId: string) {
    return prisma.user.create({
      data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "STUDENT" },
    });
  }

  it("first entry creates the daily report already IN_REVIEW; a second entry reuses it without resetting inReviewAt (FR-11, FR-18)", async () => {
    const s = await student("e-1");
    const first = await repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "stood up the parser", submittedAt: MONDAY_5PM });
    expect(first.isLate).toBe(false);
    const report = await repo.getReport(s.id, MONDAY);
    // Born IN_REVIEW: the submission IS the thing under review, so there is
    // no earlier state for a mentor to move it out of (ASSUMPTION: O-19).
    expect(report?.status).toBe("IN_REVIEW");
    const created = await prisma.dailyReport.findUniqueOrThrow({ where: { id: report!.id } });
    expect(created.inReviewAt).toEqual(MONDAY_5PM);

    const SECOND = new Date("2026-08-03T12:00:00Z");
    await repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "fixed the tests", submittedAt: SECOND });
    expect(await prisma.dailyReport.count()).toBe(1);
    expect(await prisma.entry.count()).toBe(2);
    // The upsert's `update: {}` is what keeps this true -- a later entry on
    // the same day must not restamp when the day entered review.
    const reused = await prisma.dailyReport.findUniqueOrThrow({ where: { id: report!.id } });
    expect(reused.inReviewAt).toEqual(MONDAY_5PM);
  });

  it("stores late flags computed from the historical instant (FR-13)", async () => {
    const s = await student("e-2");
    // Tuesday 09:40 Colombo for Monday's date — inside grace, late.
    const e = await repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "yesterday's notes", submittedAt: new Date("2026-08-04T04:10:00Z") });
    expect(e.isLate).toBe(true);
  });

  it("rejects a closed window with SubmissionWindowClosedError", async () => {
    const s = await student("e-3");
    await expect(
      repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "too old", submittedAt: new Date("2026-08-06T04:00:00Z") }),
    ).rejects.toThrow(SubmissionWindowClosedError);
  });

  it("rejects an entry for an EVALUATED (locked) day (FR-20)", async () => {
    const s = await student("e-4");
    await repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "first", submittedAt: MONDAY_5PM });
    await prisma.dailyReport.updateMany({
      where: { studentId: s.id }, data: { status: "EVALUATED", evaluatedAt: new Date() },
    });
    await expect(
      repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "after lock", submittedAt: new Date("2026-08-03T13:00:00Z") }),
    ).rejects.toThrow(LockedDayError);
  });

  it("rejects an entry for a day marked absent", async () => {
    const s = await student("e-5");
    await prisma.absenceRecord.create({
      data: { studentId: s.id, date: toDbDate(MONDAY), reason: "medical" },
    });
    await expect(
      repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "but also worked?", submittedAt: MONDAY_5PM }),
    ).rejects.toThrow(AbsentDayConflictError);
  });

  it("lists entries within a date range, oldest first", async () => {
    const s = await student("e-6");
    await repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "one", submittedAt: MONDAY_5PM });
    const rows = await repo.listEntries(s.id, civilDate("2026-08-01"), civilDate("2026-08-09"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entryDate).toBe("2026-08-03");
  });
});

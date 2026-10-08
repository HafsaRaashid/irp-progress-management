import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { civilDate } from "@irp/core";
import { createPrismaClient } from "../src/db/client.js";
import { createEntryRepo } from "../src/db/entry-repo.js";
import { createAbsenceRepo } from "../src/db/absence-repo.js";
import { createBatchRepo } from "../src/db/batch-repo.js";
import { createMentorRecordRepo } from "../src/db/mentor-record-repo.js";
import { colomboInstant } from "../src/db/civil-date-map.js";
import { createDayService } from "../src/services/day-service.js";
import { createRosterService } from "../src/services/roster-service.js";
import { BatchNotFoundError } from "../src/domain/errors.js";
import { resetDb } from "./helpers/db.js";
import { dbUrl } from "./helpers/require-db.js";

// 2026-06-08 is a Monday (2026-06-01 is a Monday — confirmed by
// day-service.test.ts's own MON_ON_TIME constant, and 06-08 is +7 days).
// Its cycle (10th -> 9th) is 2026-05-10 .. 2026-06-09.
const ROSTER_DATE = civilDate("2026-06-08");
const CYCLE_START = civilDate("2026-05-10");
// 2026-05-30 is a Saturday inside that same cycle.
const SAT_IN_CYCLE = civilDate("2026-05-30");
const DAY_BEFORE_TRANSFER = civilDate("2026-06-07"); // Sunday, still fine as a boundary probe
const TRANSFER_EFFECTIVE = ROSTER_DATE;

// Comfortably after ROSTER_DATE, so every grace window in this file is
// closed and classification never depends on the machine's real clock.
const NOW = colomboInstant(civilDate("2026-06-15"), "10:00");

describe.skipIf(!dbUrl)("createRosterService", () => {
  const prisma = createPrismaClient(dbUrl!);
  const entryRepo = createEntryRepo(prisma);
  const absenceRepo = createAbsenceRepo(prisma);
  const batchRepo = createBatchRepo(prisma);
  const mentorRecordRepo = createMentorRecordRepo(prisma);
  const dayService = createDayService({ entryRepo, absenceRepo, batchRepo, mentorRecordRepo });
  const roster = createRosterService({ batchRepo, dayService, mentorRecordRepo });

  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function student(externalId: string, opts: { deletedAt?: Date } = {}) {
    return prisma.user.create({
      data: {
        externalId,
        email: `${externalId}@dev.local`,
        displayName: `Student ${externalId}`,
        role: "STUDENT",
        deletedAt: opts.deletedAt ?? null,
      },
    });
  }

  it("includes only the currently-enrolled, non-archived student, with the correct day, mentor-record flag, and extra count", async () => {
    const batch = await batchRepo.create({
      name: "Batch Roster A", startDate: CYCLE_START, endDate: civilDate("2026-11-09"),
    });
    const otherBatch = await batchRepo.create({
      name: "Batch Roster Other", startDate: CYCLE_START, endDate: civilDate("2026-11-09"),
    });

    // Enrolled and active: the one row we expect back.
    const enrolled = await student("roster-enrolled");
    await batchRepo.enrol(enrolled.id, batch.id, CYCLE_START);
    await entryRepo.addEntry({
      studentId: enrolled.id,
      entryDate: ROSTER_DATE,
      body: "On-time entry for the roster date.",
      submittedAt: colomboInstant(ROSTER_DATE, "10:00"),
    });
    await entryRepo.addEntry({
      studentId: enrolled.id,
      entryDate: SAT_IN_CYCLE,
      body: "Weekend extra work inside the same cycle.",
      submittedAt: colomboInstant(SAT_IN_CYCLE, "11:00"),
    });
    await mentorRecordRepo.upsert({
      studentId: enrolled.id,
      date: ROSTER_DATE,
      attended: true,
      tasksCompleted: true,
      recordedById: enrolled.id, // recorder identity is irrelevant to this test
    });

    // Archived: enrolled in the batch, but soft-deleted — must be excluded.
    const archived = await student("roster-archived", { deletedAt: new Date() });
    await batchRepo.enrol(archived.id, batch.id, CYCLE_START);

    // Transferred away before the roster date — excluded from THIS batch.
    const transferredAway = await student("roster-transferred-away");
    await batchRepo.enrol(transferredAway.id, batch.id, CYCLE_START);
    await batchRepo.transfer(transferredAway.id, otherBatch.id, civilDate("2026-06-01"));

    const rows = await roster.roster(batch.id, ROSTER_DATE, NOW);

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.student.id).toBe(enrolled.id);
    expect(row.student.displayName).toBe(enrolled.displayName);
    expect(row.student.email).toBe(enrolled.email);
    expect(row.day.date).toBe(ROSTER_DATE);
    expect(row.day.status).toBe("onTime");
    expect(row.day.entries).toHaveLength(1);
    expect(row.hasMentorRecord).toBe(true);
    expect(row.extraCountThisCycle).toBe(1);
  });

  it("orders multiple enrolled students by displayName", async () => {
    const batch = await batchRepo.create({
      name: "Batch Roster Order", startDate: CYCLE_START, endDate: civilDate("2026-11-09"),
    });
    const zed = await prisma.user.create({
      data: { externalId: "roster-zed", email: "zed@dev.local", displayName: "Zed", role: "STUDENT" },
    });
    const amy = await prisma.user.create({
      data: { externalId: "roster-amy", email: "amy@dev.local", displayName: "Amy", role: "STUDENT" },
    });
    await batchRepo.enrol(zed.id, batch.id, CYCLE_START);
    await batchRepo.enrol(amy.id, batch.id, CYCLE_START);

    const rows = await roster.roster(batch.id, ROSTER_DATE, NOW);
    expect(rows.map((r) => r.student.displayName)).toEqual(["Amy", "Zed"]);
  });

  it("throws BatchNotFoundError for an unknown batch id", async () => {
    await expect(roster.roster("00000000-0000-0000-0000-000000000000", ROSTER_DATE, NOW))
      .rejects.toBeInstanceOf(BatchNotFoundError);
  });

  it("ADR-0017 transfer boundary: on the effective date the student is ONLY in the new batch's roster; the day before, only in the old one", async () => {
    const oldBatch = await batchRepo.create({
      name: "Batch Old", startDate: CYCLE_START, endDate: civilDate("2026-11-09"),
    });
    const newBatch = await batchRepo.create({
      name: "Batch New", startDate: DAY_BEFORE_TRANSFER, endDate: civilDate("2027-06-09"),
    });
    const mover = await student("roster-mover");
    await batchRepo.enrol(mover.id, oldBatch.id, CYCLE_START);
    await batchRepo.transfer(mover.id, newBatch.id, TRANSFER_EFFECTIVE);

    const dayBeforeOld = await roster.roster(oldBatch.id, DAY_BEFORE_TRANSFER, NOW);
    const dayBeforeNew = await roster.roster(newBatch.id, DAY_BEFORE_TRANSFER, NOW);
    expect(dayBeforeOld.map((r) => r.student.id)).toEqual([mover.id]);
    expect(dayBeforeNew).toHaveLength(0);

    const effectiveOld = await roster.roster(oldBatch.id, TRANSFER_EFFECTIVE, NOW);
    const effectiveNew = await roster.roster(newBatch.id, TRANSFER_EFFECTIVE, NOW);
    expect(effectiveOld).toHaveLength(0);
    expect(effectiveNew.map((r) => r.student.id)).toEqual([mover.id]);
  });
});

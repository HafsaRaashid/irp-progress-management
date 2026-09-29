import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SEED_BATCH_NAMES, SEED_STUDENTS } from "@irp/fixtures";
import { createPrismaClient } from "../src/db/client.js";
import { runSeed } from "../src/seed/run-seed.js";
import { resetDb } from "./helpers/db.js";
import { dbUrl } from "./helpers/require-db.js";

// A fixed "now" mid-cycle on a Wednesday so classifications are stable:
// 2026-07-22 is a Wednesday inside the 10 Jul–9 Aug cycle.
const NOW = new Date("2026-07-22T09:00:00Z");

describe.skipIf(!dbUrl)("runSeed", () => {
  const prisma = createPrismaClient(dbUrl!);

  beforeAll(async () => {
    await resetDb(prisma);
    await runSeed(prisma, NOW);
  }, 120_000);
  afterAll(async () => { await prisma.$disconnect(); });

  it("creates 2 batches, 2 mentors, 10 students", async () => {
    expect(await prisma.batch.count()).toBe(2);
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(2);
    expect(await prisma.user.count({ where: { role: "STUDENT" } })).toBe(10);
  });

  it("is idempotent — a second run changes no counts", async () => {
    const before = await prisma.entry.count();
    await runSeed(prisma, NOW);
    expect(await prisma.entry.count()).toBe(before);
    expect(await prisma.user.count()).toBe(12);
    // 120s like beforeAll's own runSeed above, and for the same reason: a full
    // seed writes ~10 personas' worth of entries, reports and absences and
    // takes multiple seconds. Vitest's DEFAULT is 5000ms and applies per test,
    // NOT inherited from beforeAll's override -- so this test and the one
    // below were the only two calling runSeed on a 5s budget. On a slower
    // machine that reads as a cascade of four unrelated failures rather than
    // one timeout: the wipe half of runSeed commits, the test is cut off
    // mid-rebuild, and every later test in the file then asserts against a
    // partially seeded database (0 extra entries, a null deletedAt, only
    // SUBMITTED reports, an Entry_studentId_fkey violation). Measured on
    // 2026-08-04: 5006ms, i.e. exactly the budget. Do not remove.
  }, 120_000);

  it("is idempotent even when a non-seed student is enrolled in a seed-owned batch", async () => {
    // Regression for a Task 16 e2e finding: the Students-page "register,
    // then archive" flow (@irp/fixtures externalId never in
    // SEED_EXTERNAL_IDS) leaves the archived student's Enrolment row behind
    // -- archive only soft-deletes the User, it was never going to touch
    // their Enrolment too. The NEXT db:seed run used to throw a
    // Prisma P2003 foreign-key violation on Enrolment_batchId_fkey, because
    // the batch deleteMany only had its enrolments cleared when the STUDENT
    // was seed-owned, not when the BATCH was. The seed batches are owned
    // by the seed by name; a stray enrolment into either, from any student,
    // must not survive a reseed.
    const externalId = "not-a-seed-user";
    // deleteMany, not delete: makes this test's own setup idempotent against
    // a previous failed run's leftover row, rather than 500ing on a unique
    // constraint before the actual regression gets exercised. Enrolment has
    // no cascade in the schema, so the stray student's Enrolment rows must
    // go first -- deleting the User while one still points at it would P2003
    // this setup itself on a re-run after a mid-test failure.
    await prisma.enrolment.deleteMany({ where: { student: { externalId } } });
    await prisma.user.deleteMany({ where: { externalId } });

    const batchA = await prisma.batch.findUniqueOrThrow({ where: { name: SEED_BATCH_NAMES.A } });
    const stray = await prisma.user.create({
      data: {
        externalId,
        email: "stray@dev.local",
        displayName: "Stray Registrant",
        role: "STUDENT",
        // Archived, matching the scenario this test reproduces: the
        // Students-page archive flow soft-deletes the User (deletedAt set)
        // but leaves the Enrolment row it's regressing against untouched.
        deletedAt: NOW,
      },
    });
    await prisma.enrolment.create({
      data: { studentId: stray.id, batchId: batchA.id, startDate: batchA.startDate },
    });

    await runSeed(prisma, NOW);

    // The seed only wipes rows it owns (SEED_EXTERNAL_IDS), so the stray
    // user itself survives -- only the seed batch, and the dangling
    // enrolment pointing at it, are gone.
    expect(await prisma.batch.count({ where: { name: SEED_BATCH_NAMES.A } })).toBe(1);
    expect(await prisma.enrolment.count({ where: { studentId: stray.id } })).toBe(0);
    await prisma.user.delete({ where: { id: stray.id } });
    // Also calls runSeed — same 120s budget, same reasoning as above.
  }, 120_000);

  it("the late persona has late-flagged entries; compliant has none", async () => {
    const late = SEED_STUDENTS.find((s) => s.kind === "late")!;
    const compliant = SEED_STUDENTS.find((s) => s.kind === "compliant")!;
    const lateUser = await prisma.user.findUniqueOrThrow({ where: { externalId: late.externalId } });
    const compliantUser = await prisma.user.findUniqueOrThrow({ where: { externalId: compliant.externalId } });
    expect(await prisma.entry.count({ where: { studentId: lateUser.id, isLate: true } })).toBeGreaterThan(0);
    expect(await prisma.entry.count({ where: { studentId: compliantUser.id, isLate: true } })).toBe(0);
  });

  it("the weekend persona has extra entries and no other student does", async () => {
    const weekend = SEED_STUDENTS.find((s) => s.kind === "weekend")!;
    const wUser = await prisma.user.findUniqueOrThrow({ where: { externalId: weekend.externalId } });
    expect(await prisma.entry.count({ where: { studentId: wUser.id, isExtra: true } })).toBeGreaterThan(0);
    expect(await prisma.entry.count({ where: { isExtra: true, studentId: { not: wUser.id } } })).toBe(0);
  });

  it("the absent persona has absence records with reasons", async () => {
    const absent = SEED_STUDENTS.find((s) => s.kind === "absent")!;
    const aUser = await prisma.user.findUniqueOrThrow({ where: { externalId: absent.externalId } });
    const rows = await prisma.absenceRecord.findMany({ where: { studentId: aUser.id } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.reason.length > 0)).toBe(true);
  });

  it("the transfer persona has a closed and an open enrolment (FR-8)", async () => {
    const transfer = SEED_STUDENTS.find((s) => s.kind === "transfer")!;
    const tUser = await prisma.user.findUniqueOrThrow({ where: { externalId: transfer.externalId } });
    const enrolments = await prisma.enrolment.findMany({ where: { studentId: tUser.id }, orderBy: { startDate: "asc" } });
    expect(enrolments).toHaveLength(2);
    expect(enrolments[0]!.endDate).not.toBeNull();
    expect(enrolments[1]!.endDate).toBeNull();
  });

  it("the archived persona is soft-deleted but keeps history (FR-5)", async () => {
    const archived = SEED_STUDENTS.find((s) => s.kind === "archived")!;
    const aUser = await prisma.user.findUniqueOrThrow({ where: { externalId: archived.externalId } });
    expect(aUser.deletedAt).not.toBeNull();
    expect(await prisma.entry.count({ where: { studentId: aUser.id } })).toBeGreaterThan(0);
  });

  it("the joiner persona has no entries before their enrolment start (FR-27 setup)", async () => {
    const joiner = SEED_STUDENTS.find((s) => s.kind === "joiner")!;
    const jUser = await prisma.user.findUniqueOrThrow({ where: { externalId: joiner.externalId } });
    const enrolment = await prisma.enrolment.findFirstOrThrow({ where: { studentId: jUser.id } });
    expect(await prisma.entry.count({
      where: { studentId: jUser.id, entryDate: { lt: enrolment.startDate } },
    })).toBe(0);
  });

  it("review statuses span both states, and cycles exist for both batches", async () => {
    const statuses = await prisma.dailyReport.groupBy({ by: ["status"] });
    // Two states, not three: a report is born IN_REVIEW (ASSUMPTION: O-19),
    // so the seed's older sweep to EVALUATED is the only status write left.
    expect(statuses.map((s) => s.status).sort()).toEqual(["EVALUATED", "IN_REVIEW"]);
    const batchA = await prisma.batch.findUniqueOrThrow({ where: { name: SEED_BATCH_NAMES.A } });
    expect(await prisma.cycle.count({ where: { batchId: batchA.id } })).toBeGreaterThanOrEqual(3);
    expect(await prisma.evaluation.count()).toBe(0); // D2/D6: no fake evaluations
  });
});

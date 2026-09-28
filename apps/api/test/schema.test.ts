import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPrismaClient } from "../src/db/client.js";
import { resetDb } from "./helpers/db.js";
import { dbUrl } from "./helpers/require-db.js";

describe.skipIf(!dbUrl)("slice 2 schema", () => {
  const prisma = createPrismaClient(dbUrl!);

  beforeEach(async () => { await resetDb(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function student(externalId: string) {
    return prisma.user.create({
      data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "STUDENT" },
    });
  }

  // The whole object graph — one row in every table. Shared by the
  // round-trip test and the resetDb test so "cleared" means every table.
  async function createFullGraph() {
    const s = await student("g-1");
    const mentor = await prisma.user.create({
      data: { externalId: "g-m", email: "g-m@dev.local", displayName: "M", role: "ADMIN" },
    });
    const batch = await prisma.batch.create({
      data: { name: "Graph", startDate: new Date("2026-05-10"), endDate: new Date("2026-11-09") },
    });
    await prisma.enrolment.create({
      data: { studentId: s.id, batchId: batch.id, startDate: new Date("2026-05-10") },
    });
    await prisma.entry.create({
      data: {
        studentId: s.id, entryDate: new Date("2026-05-11"), body: "did things",
        submittedAt: new Date("2026-05-11T11:30:00Z"), isLate: false, isExtra: false,
      },
    });
    const report = await prisma.dailyReport.create({
      data: { studentId: s.id, reportDate: new Date("2026-05-11") },
    });
    await prisma.mentorDayRecord.create({
      data: {
        studentId: s.id, date: new Date("2026-05-11"),
        attended: true, tasksCompleted: true, recordedById: mentor.id,
      },
    });
    await prisma.absenceRecord.create({
      data: { studentId: s.id, date: new Date("2026-05-12"), reason: "medical appointment" },
    });
    const cycle = await prisma.cycle.create({
      data: { batchId: batch.id, seq: 1, startDate: new Date("2026-05-10"), endDate: new Date("2026-06-09") },
    });
    const evaluation = await prisma.evaluation.create({
      data: {
        cycleId: cycle.id, studentId: s.id,
        attendance: 80, taskCompletion: 75, contributionInitiative: 70,
        effortTime: 90, mentorEvaluation: 85,
        performanceIndex: "78.25", summary: "seed", modelVersion: "none",
      },
    });
    await prisma.override.create({
      data: {
        evaluationId: evaluation.id, mentorId: mentor.id,
        newScore: "82.00", originalScore: "78.25", reason: "led the workshop",
      },
    });
    await prisma.award.create({
      data: { cycleId: cycle.id, evaluationId: evaluation.id, justification: "top of batch" },
    });
    return report;
  }

  it("round-trips the whole object graph", async () => {
    const report = await createFullGraph();
    expect(report.status).toBe("IN_REVIEW");
    expect(await prisma.award.count()).toBe(1);
  });

  it("rejects a second OPEN enrolment but allows sequential ones", async () => {
    const s = await student("g-2");
    const batch = await prisma.batch.create({
      data: { name: "Seq", startDate: new Date("2026-05-10"), endDate: new Date("2026-11-09") },
    });
    await prisma.enrolment.create({
      data: { studentId: s.id, batchId: batch.id, startDate: new Date("2026-05-10") },
    });
    await expect(
      prisma.enrolment.create({
        data: { studentId: s.id, batchId: batch.id, startDate: new Date("2026-06-10") },
      }),
    ).rejects.toThrow(); // partial unique index
    await prisma.enrolment.updateMany({
      where: { studentId: s.id }, data: { endDate: new Date("2026-06-09") },
    });
    await expect(
      prisma.enrolment.create({
        data: { studentId: s.id, batchId: batch.id, startDate: new Date("2026-06-10") },
      }),
    ).resolves.toBeTruthy(); // closed rows don't block a new open one
  });

  it("resetDb clears the whole graph", async () => {
    await createFullGraph();
    await resetDb(prisma);
    // Every table, not just the TRUNCATE roots — the CASCADE claim in
    // resetDb's comment is what this asserts.
    const counts = await Promise.all([
      prisma.user.count(), prisma.batch.count(), prisma.enrolment.count(),
      prisma.entry.count(), prisma.dailyReport.count(), prisma.mentorDayRecord.count(),
      prisma.absenceRecord.count(), prisma.cycle.count(), prisma.evaluation.count(),
      prisma.override.count(), prisma.award.count(),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

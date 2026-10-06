import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { civilDate } from "@irp/core";
import { createPrismaClient } from "../src/db/client.js";
import { createEvaluationRepo } from "../src/db/evaluation-repo.js";
import { createBatchRepo } from "../src/db/batch-repo.js";
import { createUserRepo } from "../src/db/user-repo.js";
import { resetDb } from "./helpers/db.js";
import { dbUrl } from "./helpers/require-db.js";

describe.skipIf(!dbUrl)("createEvaluationRepo", () => {
  const prisma = createPrismaClient(dbUrl!);
  const repo = createEvaluationRepo(prisma);
  const batchRepo = createBatchRepo(prisma);
  const userRepo = createUserRepo(prisma);

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("upserts a Cycle row once, returning the same id on a second call", async () => {
    const batch = await batchRepo.create({
      name: `Batch ${Date.now()}`,
      startDate: civilDate("2026-01-10"),
      endDate: civilDate("2030-01-10"),
    });
    const first = await repo.upsertCycle(batch.id, 1, {
      start: civilDate("2026-01-10"),
      end: civilDate("2026-02-09"),
    });
    const second = await repo.upsertCycle(batch.id, 1, {
      start: civilDate("2026-01-10"),
      end: civilDate("2026-02-09"),
    });
    expect(second).toBe(first);
  });

  it("creates and finds an evaluation, then an override", async () => {
    const batch = await batchRepo.create({
      name: `Batch ${Date.now()}`,
      startDate: civilDate("2026-01-10"),
      endDate: civilDate("2030-01-10"),
    });
    const student = await userRepo.create({
      externalId: `s-${Date.now()}`,
      email: `s-${Date.now()}@dev.local`,
      displayName: "Test Student",
      role: "STUDENT",
    });
    const cycleId = await repo.upsertCycle(batch.id, 1, {
      start: civilDate("2026-01-10"),
      end: civilDate("2026-02-09"),
    });

    expect(await repo.findEvaluation(cycleId, student.id)).toBeNull();

    const evaluation = await repo.createEvaluation({
      cycleId,
      studentId: student.id,
      attendance: 80,
      taskCompletion: 90,
      contributionInitiative: 70,
      effortTime: 60,
      mentorEvaluation: 85,
      performanceIndex: 79.5,
      summary: "Solid month.",
      modelVersion: "gpt-4o-mini-2024-10",
    });
    expect(await repo.findEvaluation(cycleId, student.id)).toMatchObject({ id: evaluation.id });
    expect(await repo.findEvaluationById(evaluation.id)).toMatchObject({ id: evaluation.id });
    expect(await repo.findEvaluationById("00000000-0000-0000-0000-000000000000")).toBeNull();

    expect(await repo.findOverride(evaluation.id)).toBeNull();
    const override = await repo.createOverride({
      evaluationId: evaluation.id,
      mentorId: student.id,
      newScore: 85,
      originalScore: 79.5,
      reason: "Strong finish.",
    });
    expect(await repo.findOverride(evaluation.id)).toMatchObject({ id: override.id });
  });

  it("joins cycleSeq from the parent Cycle on every read path (not a column on Evaluation itself)", async () => {
    const batch = await batchRepo.create({
      name: `Batch ${Date.now()}`,
      startDate: civilDate("2026-01-10"),
      endDate: civilDate("2030-01-10"),
    });
    const student = await userRepo.create({
      externalId: `seq-${Date.now()}`,
      email: `seq-${Date.now()}@dev.local`,
      displayName: "Seq Student",
      role: "STUDENT",
    });
    // seq 3, not 1 — proves the joined value really is the Cycle's own seq
    // rather than some hardcoded/default number.
    const cycleId = await repo.upsertCycle(batch.id, 3, {
      start: civilDate("2026-03-10"),
      end: civilDate("2026-04-09"),
    });
    const evaluation = await repo.createEvaluation({
      cycleId,
      studentId: student.id,
      attendance: 50,
      taskCompletion: 50,
      contributionInitiative: 50,
      effortTime: 50,
      mentorEvaluation: 50,
      performanceIndex: 50,
      summary: "x",
      modelVersion: "v1",
    });

    expect(evaluation.cycleSeq).toBe(3);
    expect((await repo.findEvaluation(cycleId, student.id))?.cycleSeq).toBe(3);
    expect((await repo.findEvaluationById(evaluation.id))?.cycleSeq).toBe(3);
  });
});

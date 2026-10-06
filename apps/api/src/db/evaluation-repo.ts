import type { CivilDate } from "@irp/core";
import type { PrismaClient } from "../generated/prisma/client.js";
import { toDbDate } from "./civil-date-map.js";

export interface EvaluationScores {
  attendance: number;
  taskCompletion: number;
  contributionInitiative: number;
  effortTime: number;
  mentorEvaluation: number;
}

export interface EvaluationRecord extends EvaluationScores {
  id: string;
  cycleId: string;
  /**
   * Joined from Cycle, not a column on Evaluation itself — Cycle.seq is the
   * ADR-0019 1-based sequence. Included on every read so the override path
   * (service Task 4) never needs a SEPARATE Cycle lookup just to answer
   * "which cycle number was this": the PUT /evaluations/{id}/override route
   * (Task 6) has only the evaluation's id in its path, no cycle context.
   */
  cycleSeq: number;
  studentId: string;
  performanceIndex: string; // Decimal as string, same convention as Prisma's Decimal mapping elsewhere
  summary: string;
  modelVersion: string;
  createdAt: Date;
}

export interface OverrideRecord {
  id: string;
  evaluationId: string;
  mentorId: string;
  newScore: string;
  originalScore: string;
  reason: string;
  createdAt: Date;
}

export interface EvaluationRepo {
  /** Upserts the Cycle row (lazy materialisation, ADR-0019) and returns its id. */
  upsertCycle(batchId: string, seq: number, bounds: { start: CivilDate; end: CivilDate }): Promise<string>;
  findEvaluation(cycleId: string, studentId: string): Promise<EvaluationRecord | null>;
  /** By primary key — the override path (service Task 4) has only the evaluation's id, not its cycleId. */
  findEvaluationById(id: string): Promise<EvaluationRecord | null>;
  createEvaluation(input: EvaluationScores & {
    cycleId: string; studentId: string; performanceIndex: number; summary: string; modelVersion: string;
  }): Promise<EvaluationRecord>;
  findOverride(evaluationId: string): Promise<OverrideRecord | null>;
  createOverride(input: {
    evaluationId: string; mentorId: string; newScore: number; originalScore: number; reason: string;
  }): Promise<OverrideRecord>;
}

function mapEvaluation(e: {
  id: string; cycleId: string; studentId: string; attendance: number; taskCompletion: number;
  contributionInitiative: number; effortTime: number; mentorEvaluation: number;
  performanceIndex: { toString(): string }; summary: string; modelVersion: string; createdAt: Date;
  cycle: { seq: number };
}): EvaluationRecord {
  const { cycle, ...rest } = e;
  return { ...rest, cycleSeq: cycle.seq, performanceIndex: e.performanceIndex.toString() };
}

/** Every read includes the parent Cycle's seq (see EvaluationRecord.cycleSeq's own comment). */
const WITH_CYCLE_SEQ = { include: { cycle: { select: { seq: true } } } } as const;

function mapOverride(o: {
  id: string; evaluationId: string; mentorId: string;
  newScore: { toString(): string }; originalScore: { toString(): string }; reason: string; createdAt: Date;
}): OverrideRecord {
  return { ...o, newScore: o.newScore.toString(), originalScore: o.originalScore.toString() };
}

export function createEvaluationRepo(prisma: PrismaClient): EvaluationRepo {
  return {
    async upsertCycle(batchId, seq, bounds) {
      const cycle = await prisma.cycle.upsert({
        where: { batchId_seq: { batchId, seq } },
        create: { batchId, seq, startDate: toDbDate(bounds.start), endDate: toDbDate(bounds.end) },
        update: {},
      });
      return cycle.id;
    },

    async findEvaluation(cycleId, studentId) {
      const e = await prisma.evaluation.findFirst({ where: { cycleId, studentId }, ...WITH_CYCLE_SEQ });
      return e === null ? null : mapEvaluation(e);
    },

    async findEvaluationById(id) {
      const e = await prisma.evaluation.findUnique({ where: { id }, ...WITH_CYCLE_SEQ });
      return e === null ? null : mapEvaluation(e);
    },

    async createEvaluation(input) {
      const e = await prisma.evaluation.create({ data: input, ...WITH_CYCLE_SEQ });
      return mapEvaluation(e);
    },

    async findOverride(evaluationId) {
      const o = await prisma.override.findUnique({ where: { evaluationId } });
      return o === null ? null : mapOverride(o);
    },

    async createOverride(input) {
      const o = await prisma.override.create({ data: input });
      return mapOverride(o);
    },
  };
}

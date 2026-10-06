import { cycleContaining, compareDates, firstEvaluatedCycleStart, shiftCycle, toProgrammeDate, type CycleBounds } from "@irp/core";
import type { BatchRepo } from "../db/batch-repo.js";
import type { EntryRepo } from "../db/entry-repo.js";
import type { MentorRecordRepo } from "../db/mentor-record-repo.js";
import type { AbsenceRepo } from "../db/absence-repo.js";
import type { EvaluationRecord, EvaluationRepo } from "../db/evaluation-repo.js";
import type { UserRepo } from "../db/user-repo.js";
import type { EvaluationAiClient } from "./evaluation-ai-client.js";
import {
  BatchNotFoundError, CycleNotClosedError, EvaluationExistsError, EnrolmentDoesNotSpanCycleError,
  EvaluationNotFoundError, StudentNotFoundError,
} from "../domain/errors.js";

export interface EvaluationView {
  id: string;
  studentId: string;
  cycleSeq: number;
  attendance: number;
  taskCompletion: number;
  contributionInitiative: number;
  effortTime: number;
  mentorEvaluation: number;
  performanceIndex: number;
  summary: string;
  modelVersion: string;
  override: { newScore: number; originalScore: number; reason: string } | null;
}

export interface EvaluationServiceDeps {
  batchRepo: Pick<BatchRepo, "getBatch" | "listEnrolments">;
  entryRepo: Pick<EntryRepo, "listEntries">;
  mentorRecordRepo: Pick<MentorRecordRepo, "listForStudent">;
  absenceRepo: Pick<AbsenceRepo, "listForStudent">;
  evaluationRepo: EvaluationRepo;
  aiClient: EvaluationAiClient;
  userRepo: Pick<UserRepo, "findById">;
}

export interface EvaluationService {
  generateForCycle(batchId: string, studentId: string, seq: number, now: Date): Promise<EvaluationView>;
  getEvaluation(batchId: string, studentId: string, seq: number): Promise<EvaluationView | null>;
  override(evaluationId: string, mentorId: string, newScore: number, reason: string): Promise<EvaluationView>;
}

// Brief §5: Attendance 20, Task completion 25, Contribution & initiative 25, Effort/time 10, Mentor evaluation 20.
function weightedIndex(s: {
  attendance: number; taskCompletion: number; contributionInitiative: number; effortTime: number; mentorEvaluation: number;
}): number {
  return s.attendance * 0.20 + s.taskCompletion * 0.25 + s.contributionInitiative * 0.25
    + s.effortTime * 0.10 + s.mentorEvaluation * 0.20;
}

function resolveBounds(batchStartDate: CycleBounds["start"], seq: number): CycleBounds {
  const first = firstEvaluatedCycleStart(batchStartDate);
  return cycleContaining(shiftCycle(first, seq - 1));
}

export function createEvaluationService(deps: EvaluationServiceDeps): EvaluationService {
  async function toView(evalRow: EvaluationRecord): Promise<EvaluationView> {
    const override = await deps.evaluationRepo.findOverride(evalRow.id);
    return {
      id: evalRow.id,
      studentId: evalRow.studentId,
      cycleSeq: evalRow.cycleSeq,
      attendance: evalRow.attendance,
      taskCompletion: evalRow.taskCompletion,
      contributionInitiative: evalRow.contributionInitiative,
      effortTime: evalRow.effortTime,
      mentorEvaluation: evalRow.mentorEvaluation,
      performanceIndex: Number(evalRow.performanceIndex),
      summary: evalRow.summary,
      modelVersion: evalRow.modelVersion,
      override: override === null ? null : {
        newScore: Number(override.newScore), originalScore: Number(override.originalScore), reason: override.reason,
      },
    };
  }

  return {
    async generateForCycle(batchId, studentId, seq, now) {
      const batch = await deps.batchRepo.getBatch(batchId);
      if (batch === null) throw new BatchNotFoundError(batchId);

      const bounds = resolveBounds(batch.startDate, seq);
      if (compareDates(bounds.end, toProgrammeDate(now)) >= 0) {
        throw new CycleNotClosedError(bounds.end);
      }

      const enrolments = await deps.batchRepo.listEnrolments(studentId);
      const spansWholeCycle = enrolments.some(
        (e) => e.batchId === batchId
          && compareDates(e.startDate, bounds.start) <= 0
          && (e.endDate === null || compareDates(e.endDate, bounds.end) >= 0),
      );
      if (!spansWholeCycle) throw new EnrolmentDoesNotSpanCycleError(studentId);

      const cycleId = await deps.evaluationRepo.upsertCycle(batchId, seq, bounds);
      const existing = await deps.evaluationRepo.findEvaluation(cycleId, studentId);
      if (existing !== null) throw new EvaluationExistsError(existing.id);

      const student = await deps.userRepo.findById(studentId);
      if (student === null) throw new StudentNotFoundError(studentId);

      const [entries, mentorRecords, absences] = await Promise.all([
        deps.entryRepo.listEntries(studentId, bounds.start, bounds.end),
        deps.mentorRecordRepo.listForStudent(studentId, bounds.start, bounds.end),
        deps.absenceRepo.listForStudent(studentId, bounds.start, bounds.end),
      ]);

      const { result, modelVersion } = await deps.aiClient.evaluate({
        studentName: student.displayName,
        cycleStart: bounds.start,
        cycleEnd: bounds.end,
        entries: entries.map((e) => ({ date: e.entryDate, body: e.body, isLate: e.isLate, isExtra: e.isExtra })),
        mentorRecords: mentorRecords.map((r) => ({
          date: r.date, attended: r.attended, tasksCompleted: r.tasksCompleted, note: r.note,
        })),
        absences: absences.map((a) => ({ date: a.date, reason: a.reason })),
      });

      const performanceIndex = weightedIndex(result);
      const created = await deps.evaluationRepo.createEvaluation({
        cycleId, studentId, ...result, performanceIndex, modelVersion,
      });
      return toView(created);
    },

    async getEvaluation(batchId, studentId, seq) {
      const batch = await deps.batchRepo.getBatch(batchId);
      if (batch === null) throw new BatchNotFoundError(batchId);
      const bounds = resolveBounds(batch.startDate, seq);
      const cycleId = await deps.evaluationRepo.upsertCycle(batchId, seq, bounds);
      const existing = await deps.evaluationRepo.findEvaluation(cycleId, studentId);
      return existing === null ? null : toView(existing);
    },

    async override(evaluationId, mentorId, newScore, reason) {
      const evaluation = await deps.evaluationRepo.findEvaluationById(evaluationId);
      if (evaluation === null) throw new EvaluationNotFoundError(evaluationId);
      await deps.evaluationRepo.createOverride({
        evaluationId, mentorId, newScore, originalScore: Number(evaluation.performanceIndex), reason,
      });
      return toView(evaluation);
    },
  };
}

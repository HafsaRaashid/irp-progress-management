import type { FastifyPluginAsync } from "fastify";
import type { components } from "@irp/types";
import type { EvaluationService, EvaluationView } from "../services/evaluation-service.js";
import type { UserRepo } from "../db/user-repo.js";
import type { BatchRepo } from "../db/batch-repo.js";
import { StudentNotFoundError } from "../domain/errors.js";
import { requireAdmin } from "../plugins/roles.js";
import { resolveStudent } from "./reviews.js";
import { UUID_PARAM, EVALUATION_GENERATE_QUERY, CYCLE_PARAM, EVALUATION_OVERRIDE_BODY } from "./schemas.js";

type ApiEvaluation = components["schemas"]["Evaluation"];

/**
 * Exported: Task 8 reuses this exact mapping for the batch dashboard's
 * per-student `evaluation` field, rather than re-deriving the same
 * field-for-field copy in `dashboards.ts`.
 */
export function toApiEvaluation(v: EvaluationView): ApiEvaluation {
  return {
    id: v.id,
    studentId: v.studentId,
    cycleSeq: v.cycleSeq,
    attendance: v.attendance,
    taskCompletion: v.taskCompletion,
    contributionInitiative: v.contributionInitiative,
    effortTime: v.effortTime,
    mentorEvaluation: v.mentorEvaluation,
    performanceIndex: v.performanceIndex,
    summary: v.summary,
    modelVersion: v.modelVersion,
    override: v.override,
  };
}

export const evaluationRoutes: FastifyPluginAsync<{
  evaluationService: EvaluationService;
  userRepo: UserRepo;
  batchRepo: Pick<BatchRepo, "openEnrolment">;
  // eslint-disable-next-line @typescript-eslint/require-await
}> = async (app, opts) => {
  app.post<{ Params: { id: string }; Querystring: { cycle: number } }>(
    "/api/v1/students/:id/evaluations",
    { schema: { params: UUID_PARAM, querystring: EVALUATION_GENERATE_QUERY }, preHandler: [app.authenticate] },
    async (req, reply): Promise<ApiEvaluation> => {
      requireAdmin(req);
      const student = await resolveStudent(opts.userRepo, req.params.id);
      // EvaluationService.generateForCycle needs the batch to evaluate
      // against, and neither it nor resolveStudent carries the student's
      // current batch membership — that comes from the student's own open
      // enrolment.
      const enrolment = await opts.batchRepo.openEnrolment(student.id);
      if (enrolment === null) throw new StudentNotFoundError(student.id);
      const view = await opts.evaluationService.generateForCycle(
        enrolment.batchId, student.id, req.query.cycle, new Date(),
      );
      // 200, not 201: the spec's custom four-response lint assertion requires
      // the literal '200' key on every operation.
      reply.code(200);
      return toApiEvaluation(view);
    },
  );

  app.get<{ Params: { id: string; cycle: number } }>(
    "/api/v1/students/:id/evaluations/:cycle",
    { schema: { params: CYCLE_PARAM }, preHandler: [app.authenticate] },
    async (req, reply): Promise<ApiEvaluation | undefined> => {
      requireAdmin(req);
      const student = await resolveStudent(opts.userRepo, req.params.id);
      const enrolment = await opts.batchRepo.openEnrolment(student.id);
      if (enrolment === null) throw new StudentNotFoundError(student.id);
      const view = await opts.evaluationService.getEvaluation(enrolment.batchId, student.id, req.params.cycle);
      if (view === null) {
        reply.code(404);
        return undefined;
      }
      return toApiEvaluation(view);
    },
  );

  app.put<{ Params: { id: string }; Body: { newScore: number; reason: string } }>(
    "/api/v1/evaluations/:id/override",
    { schema: { params: UUID_PARAM, body: EVALUATION_OVERRIDE_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiEvaluation> => {
      requireAdmin(req);
      const view = await opts.evaluationService.override(
        req.params.id, req.user!.id, req.body.newScore, req.body.reason,
      );
      return toApiEvaluation(view);
    },
  );
};

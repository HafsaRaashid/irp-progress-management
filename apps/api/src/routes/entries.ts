import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { civilDate } from "@irp/core";
import type { components } from "@irp/types";
import type { EntryRepo, EntryRecord } from "../db/entry-repo.js";
import { HttpError } from "../errors.js";
import { requireAdmin } from "../plugins/roles.js";
import { ENTRY_CREATE_BODY, ENTRY_REVIEW_BODY, UUID_PARAM } from "./schemas.js";

// The mentor-facing shape (score/mentorFeedback/countsTowardEvaluation
// included) -- used only by toApiEntryForMentor and reviewEntry's response.
type ApiEntry = components["schemas"]["Entry"];
// The student-facing shape -- genuinely lacks score/countsTowardEvaluation
// at the type level (not merely omitted at the object-literal call site),
// which is what keeps a score from ever reaching /me/days (spec §4).
type ApiStudentEntry = components["schemas"]["StudentEntry"];

/** Student-only endpoints: an Admin has no enrolment to act against. */
export function requireStudent(req: FastifyRequest): void {
  if (req.user?.role !== "STUDENT") {
    throw new HttpError(
      403,
      "https://irp.bistec.example/problems/students-only",
      "Students only",
      "This action belongs to students; mentors use the review endpoints.",
    );
  }
}

/**
 * Student-safe mapping -- the type genuinely has no score/countsTowardEvaluation
 * property, so a caller cannot leak them by accident even if EntryRecord grows
 * more mentor-only fields later. Used by createEntry's own response and as
 * `toApiDay`'s default entry-mapper for `/me/days`.
 */
export function toApiEntry(e: EntryRecord): ApiStudentEntry {
  return {
    id: e.id,
    entryDate: e.entryDate,
    body: e.body,
    submittedAt: e.submittedAt.toISOString(),
    isLate: e.isLate,
    isExtra: e.isExtra,
  };
}

/** Mentor-facing mapping -- adds the review fields. Used by `/students/{id}/days` and reviewEntry's response. */
export function toApiEntryForMentor(e: EntryRecord): ApiEntry {
  return {
    id: e.id,
    entryDate: e.entryDate,
    body: e.body,
    submittedAt: e.submittedAt.toISOString(),
    isLate: e.isLate,
    isExtra: e.isExtra,
    score: e.score,
    mentorFeedback: e.mentorFeedback,
    countsTowardEvaluation: e.countsTowardEvaluation,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await
export const entryRoutes: FastifyPluginAsync<{ entryRepo: EntryRepo }> = async (app, opts) => {
  app.post<{ Body: components["schemas"]["EntryCreate"] }>(
    "/api/v1/entries",
    { schema: { body: ENTRY_CREATE_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiStudentEntry> => {
      requireStudent(req);
      const entry = await opts.entryRepo.addEntry({
        studentId: req.user!.id,
        entryDate: civilDate(req.body.entryDate),
        body: req.body.body,
        submittedAt: new Date(),
      });
      return toApiEntry(entry);
    },
  );

  app.put<{ Params: { id: string }; Body: components["schemas"]["EntryReview"] }>(
    "/api/v1/entries/:id/review",
    { schema: { params: UUID_PARAM, body: ENTRY_REVIEW_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiEntry> => {
      requireAdmin(req);
      const entry = await opts.entryRepo.reviewEntry(
        req.params.id,
        {
          score: req.body.score,
          mentorFeedback: req.body.feedback,
          countsTowardEvaluation: req.body.countsTowardEvaluation,
        },
        req.user!.id,
        new Date(),
      );
      return toApiEntryForMentor(entry);
    },
  );
};

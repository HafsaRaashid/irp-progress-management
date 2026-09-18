import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { civilDate } from "@irp/core";
import type { components } from "@irp/types";
import type { EntryRepo, EntryRecord } from "../db/entry-repo.js";
import type { NotificationService } from "../services/notification-service.js";
import { HttpError } from "../errors.js";
import { ENTRY_CREATE_BODY } from "./schemas.js";

type ApiEntry = components["schemas"]["Entry"];

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

export function toApiEntry(e: EntryRecord): ApiEntry {
  return {
    id: e.id,
    entryDate: e.entryDate,
    body: e.body,
    submittedAt: e.submittedAt.toISOString(),
    isLate: e.isLate,
    isExtra: e.isExtra,
  };
}

export const entryRoutes: FastifyPluginAsync<{
  entryRepo: EntryRepo;
  notificationService: NotificationService;
  // eslint-disable-next-line @typescript-eslint/require-await
}> = async (app, opts) => {
  app.post<{ Body: components["schemas"]["EntryCreate"] }>(
    "/api/v1/entries",
    { schema: { body: ENTRY_CREATE_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiEntry> => {
      requireStudent(req);
      const entry = await opts.entryRepo.addEntry({
        studentId: req.user!.id,
        entryDate: civilDate(req.body.entryDate),
        body: req.body.body,
        submittedAt: new Date(),
      });
      // FR-21, fire-and-forget (design spec D5) — never awaited. notify()
      // is contractually synchronous-and-non-throwing, but the write above
      // has already committed, so a defect in it must never turn into a
      // 500 for a request that otherwise succeeded.
      try {
        opts.notificationService.notify({
          type: "EntrySubmitted",
          studentId: entry.studentId,
          entryDate: entry.entryDate,
          submittedAt: entry.submittedAt,
        });
      } catch (err) {
        req.log.warn({ err }, "notificationService.notify threw synchronously");
      }
      return toApiEntry(entry);
    },
  );
};

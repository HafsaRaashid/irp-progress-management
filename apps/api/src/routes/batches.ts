import type { FastifyPluginAsync } from "fastify";
import { civilDate, compareDates, toProgrammeDate } from "@irp/core";
import type { components } from "@irp/types";
import type { BatchRepo, BatchRecord } from "../db/batch-repo.js";
import type { RosterService } from "../services/roster-service.js";
import { InvalidBatchDatesError } from "../domain/errors.js";
import { requireAdmin } from "../plugins/roles.js";
import { toApiDay } from "./me-days.js";
import { BATCH_CREATE_BODY, UUID_PARAM, ROSTER_QUERY } from "./schemas.js";

type ApiBatch = components["schemas"]["Batch"];
type ApiRosterRow = components["schemas"]["RosterRow"];

function toApiBatch(b: BatchRecord): ApiBatch {
  return { id: b.id, name: b.name, startDate: b.startDate, endDate: b.endDate };
}

export const batchRoutes: FastifyPluginAsync<{
  batchRepo: BatchRepo;
  rosterService: RosterService;
  // eslint-disable-next-line @typescript-eslint/require-await
}> = async (app, opts) => {
  app.get("/api/v1/batches", { preHandler: [app.authenticate] }, async (req): Promise<ApiBatch[]> => {
    requireAdmin(req);
    const batches = await opts.batchRepo.list();
    return batches.map(toApiBatch);
  });

  app.post<{ Body: components["schemas"]["BatchCreate"] }>(
    "/api/v1/batches",
    { schema: { body: BATCH_CREATE_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiBatch> => {
      requireAdmin(req);
      const startDate = civilDate(req.body.startDate);
      const endDate = civilDate(req.body.endDate);
      if (compareDates(startDate, endDate) >= 0) throw new InvalidBatchDatesError();
      const batch = await opts.batchRepo.create({ name: req.body.name, startDate, endDate });
      return toApiBatch(batch);
    },
  );

  // Fans out 2 queries per roster member (a whole-cycle day-service call plus
  // a mentor-record lookup) via roster-service's Promise.all — accepted for a
  // <=10-student roster; no premature batching (Task 5 review decision).
  app.get<{ Params: { id: string }; Querystring: { date?: string } }>(
    "/api/v1/batches/:id/roster",
    { schema: { params: UUID_PARAM, querystring: ROSTER_QUERY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiRosterRow[]> => {
      requireAdmin(req);
      const now = new Date();
      const date = req.query.date !== undefined ? civilDate(req.query.date) : toProgrammeDate(now);
      const rows = await opts.rosterService.roster(req.params.id, date, now);
      return rows.map((r) => ({
        student: r.student,
        day: toApiDay(r.day),
        hasMentorRecord: r.hasMentorRecord,
        extraCountThisCycle: r.extraCountThisCycle,
      }));
    },
  );
};

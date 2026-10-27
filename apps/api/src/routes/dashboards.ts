import type { FastifyPluginAsync } from "fastify";
import type { components } from "@irp/types";
import type {
  BatchTodayView, CycleView, CycleCounts, DayCompliance, DashboardService,
} from "../services/dashboard-service.js";
import { requireAdmin } from "../plugins/roles.js";
import { CYCLE_QUERY, UUID_PARAM } from "./schemas.js";

type ApiBatchToday = components["schemas"]["BatchTodayDashboard"];

/**
 * Domain views are already the wire shape field-for-field, so these mappers
 * are structural copies rather than translations. They exist anyway: the
 * explicit return type is what makes a spec change that the service has not
 * followed a compile error instead of a silently wrong payload.
 */
function toApiCycle(c: CycleView): components["schemas"]["CycleView"] {
  return { seq: c.seq, startDate: c.startDate, endDate: c.endDate, requiredDayCount: c.requiredDayCount };
}

function toApiDayCompliance(d: DayCompliance): components["schemas"]["DayCompliance"] {
  return {
    date: d.date, enrolled: d.enrolled, submitted: d.submitted,
    late: d.late, absent: d.absent, missed: d.missed, pending: d.pending,
  };
}

function toApiCycleCounts(c: CycleCounts): components["schemas"]["CycleCounts"] {
  return {
    requiredDays: c.requiredDays, settledDays: c.settledDays, onTime: c.onTime,
    late: c.late, absent: c.absent, missed: c.missed, pending: c.pending,
    extra: c.extra,
  };
}

function toApiBatchToday(v: BatchTodayView): ApiBatchToday {
  return {
    batchId: v.batch.id,
    batchName: v.batch.name,
    date: v.date,
    isFallbackDay: v.isFallbackDay,
    dayNumber: v.dayNumber,
    cycle: toApiCycle(v.cycle),
    counts: toApiDayCompliance(v.counts),
    extraCount: v.extraCount,
    days: v.days.map(toApiDayCompliance),
    extraAfter: [...v.extraAfter],
  };
}

export const dashboardRoutes: FastifyPluginAsync<{
  dashboardService: DashboardService;
  // eslint-disable-next-line @typescript-eslint/require-await
}> = async (app, opts) => {
  app.get<{ Params: { id: string } }>(
    "/api/v1/batches/:id/dashboard/today",
    { schema: { params: UUID_PARAM }, preHandler: [app.authenticate] },
    async (req): Promise<ApiBatchToday> => {
      requireAdmin(req);
      return toApiBatchToday(await opts.dashboardService.batchToday(req.params.id, new Date()));
    },
  );

  app.get<{ Params: { id: string }; Querystring: { cycle?: number } }>(
    "/api/v1/batches/:id/dashboard/summary",
    { schema: { params: UUID_PARAM, querystring: CYCLE_QUERY }, preHandler: [app.authenticate] },
    async (req): Promise<components["schemas"]["BatchCycleSummary"]> => {
      requireAdmin(req);
      const view = await opts.dashboardService.batchSummary(req.params.id, req.query.cycle, new Date());
      return {
        batchId: view.batch.id,
        batchName: view.batch.name,
        cycle: toApiCycle(view.cycle),
        currentSeq: view.currentSeq,
        students: view.students.map((s) => ({
          student: s.student,
          counts: toApiCycleCounts(s.counts),
          reviewProgress: { ...s.reviewProgress },
        })),
      };
    },
  );

  app.get(
    "/api/v1/me/dashboard",
    { preHandler: [app.authenticate] },
    async (req): Promise<components["schemas"]["StudentDashboard"]> => {
      // No role gate and no id parameter: the caller's own id is the only
      // input, so FR-30 holds by construction rather than by a check.
      const view = await opts.dashboardService.studentDashboard(req.user!.id, new Date());
      return {
        today: view.today,
        programmeMonths: view.programmeMonths,
        firstEvaluatedCycleStart: view.firstEvaluatedCycleStart,
        cycle: toApiCycle(view.cycle),
        days: view.days.map((d) => ({ date: d.date, status: d.status })),
        extraAfter: [...view.extraAfter],
        summary: toApiCycleCounts(view.summary),
        strengthsAndWeaknesses: view.strengthsAndWeaknesses,
      };
    },
  );
};

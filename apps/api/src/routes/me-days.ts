import type { FastifyPluginAsync } from "fastify";
import {
  civilDate, cycleContaining, toProgrammeDate,
  addDays, compareDates,
} from "@irp/core";
import type { components } from "@irp/types";
import type { DayService, DayView } from "../services/day-service.js";
import type { DailyReportStatus } from "../generated/prisma/client.js";
import { HttpError } from "../errors.js";
import { toApiEntry } from "./entries.js";

type ApiDaySummary = components["schemas"]["DaySummary"];

export const REPORT_STATUS_TO_API: Record<DailyReportStatus, "InReview" | "Evaluated"> = {
  IN_REVIEW: "InReview",
  EVALUATED: "Evaluated",
};

export function toApiDay(v: DayView): ApiDaySummary {
  return {
    date: v.date,
    status: v.status,
    reportId: v.reportId,
    reportStatus: v.reportStatus === null ? null : REPORT_STATUS_TO_API[v.reportStatus],
    absenceReason: v.absenceReason,
    mentorNote: v.mentorNote,
    entries: v.entries.map(toApiEntry),
  };
}

const MAX_RANGE_DAYS = 92;

export function resolveRange(from?: string, to?: string, now = new Date()) {
  const today = toProgrammeDate(now);
  const cycle = cycleContaining(today);
  const f = from === undefined ? cycle.start : civilDate(from);
  // Default `to` is today, not the cycle's end -- a day that hasn't happened
  // yet has nothing to submit, review, or attend, so neither the mentor
  // Review page nor a student's own history should default to including it.
  // An explicit `to` (e.g. a caller that wants the whole cycle's shape) still
  // gets exactly what it asked for.
  const t = to === undefined ? today : civilDate(to);
  if (compareDates(f, t) > 0) {
    throw new HttpError(400, "https://irp.bistec.example/problems/invalid-range",
      "Invalid range", "`from` is after `to`.");
  }
  let width = 0;
  for (let d = f; compareDates(d, t) <= 0 && width <= MAX_RANGE_DAYS; d = addDays(d, 1)) width++;
  if (width > MAX_RANGE_DAYS) {
    throw new HttpError(400, "https://irp.bistec.example/problems/range-too-wide",
      "Range too wide", `The range may not exceed ${MAX_RANGE_DAYS} days.`);
  }
  return { from: f, to: t };
}

export const DAYS_QUERY = {
  type: "object",
  additionalProperties: false,
  properties: {
    from: { type: "string", format: "date" },
    to: { type: "string", format: "date" },
  },
} as const;

// eslint-disable-next-line @typescript-eslint/require-await
export const meDaysRoutes: FastifyPluginAsync<{ dayService: DayService }> = async (app, opts) => {
  app.get<{ Querystring: { from?: string; to?: string } }>(
    "/api/v1/me/days",
    { schema: { querystring: DAYS_QUERY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiDaySummary[]> => {
      const now = new Date();
      const { from, to } = resolveRange(req.query.from, req.query.to, now);
      const days = await opts.dayService.listDays(req.user!.id, from, to, now);
      return days.map(toApiDay);
    },
  );
};

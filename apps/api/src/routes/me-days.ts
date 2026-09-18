import type { FastifyPluginAsync } from "fastify";
import {
  civilDate, cycleContaining, toProgrammeDate,
  addDays, compareDates,
} from "@irp/core";
import type { components } from "@irp/types";
import type { DayService, DayView } from "../services/day-service.js";
import type { DailyReportStatus } from "../generated/prisma/client.js";
import type { EntryRecord } from "../db/entry-repo.js";
import { HttpError } from "../errors.js";
import { toApiEntry } from "./entries.js";

type ApiStudentDaySummary = components["schemas"]["StudentDaySummary"];

export const REPORT_STATUS_TO_API: Record<
  DailyReportStatus,
  "Submitted" | "InReview" | "Evaluated"
> = { SUBMITTED: "Submitted", IN_REVIEW: "InReview", EVALUATED: "Evaluated" };

/**
 * Shared day-assembly, parameterised over the entry mapper so a score never
 * reaches a student response (spec §4's correctness-critical split). `E` is
 * inferred from `entryMapper`'s return type -- when called with no second
 * argument it defaults to `toApiEntry` (student-safe), so the return type is
 * genuinely `StudentDaySummary`-shaped, not `DaySummary`-shaped-with-fields-
 * omitted-at-runtime. `reviews.ts` passes `toApiEntryForMentor` explicitly to
 * get the `DaySummary` (mentor) shape instead.
 */
export function toApiDay<E = ReturnType<typeof toApiEntry>>(
  v: DayView,
  entryMapper: (e: EntryRecord) => E = toApiEntry as unknown as (e: EntryRecord) => E,
) {
  return {
    date: v.date,
    status: v.status,
    reportId: v.reportId,
    reportStatus: v.reportStatus === null ? null : REPORT_STATUS_TO_API[v.reportStatus],
    absenceReason: v.absenceReason,
    entries: v.entries.map(entryMapper),
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
    async (req): Promise<ApiStudentDaySummary[]> => {
      const now = new Date();
      const { from, to } = resolveRange(req.query.from, req.query.to, now);
      const days = await opts.dayService.listDays(req.user!.id, from, to, now);
      return days.map((v) => toApiDay(v));
    },
  );
};

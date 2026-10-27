import { batchPhase, cycleAt, cycleBounds, type CivilDate } from "@irp/core";
import type { PrismaClient } from "../generated/prisma/client.js";
import { fromDbDate, toDbDate } from "./civil-date-map.js";

export interface CycleRecord {
  id: string;
  batchId: string;
  seq: number;
  startDate: CivilDate;
  endDate: CivilDate;
}

export interface CycleRepo {
  /**
   * Materialise every cycle from the batch's first up to and including the
   * one containing `through` (the last, once the batch is over; none, before
   * it starts). Idempotent: existing (batchId, seq) rows are left untouched,
   * so an Evaluation FK can never be orphaned by a re-run. The ENGINE owns
   * the arithmetic; these rows are its cache (spec §3, ADR-0035).
   */
  ensureCycles(batchId: string, through: CivilDate): Promise<CycleRecord[]>;
  listForBatch(batchId: string): Promise<CycleRecord[]>;
}

export function createCycleRepo(prisma: PrismaClient): CycleRepo {
  async function listForBatch(batchId: string): Promise<CycleRecord[]> {
    const rows = await prisma.cycle.findMany({ where: { batchId }, orderBy: { seq: "asc" } });
    return rows.map((c) => ({
      id: c.id,
      batchId: c.batchId,
      seq: c.seq,
      startDate: fromDbDate(c.startDate),
      endDate: fromDbDate(c.endDate),
    }));
  }

  return {
    async ensureCycles(batchId, through) {
      const row = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
      const batch = { startDate: fromDbDate(row.startDate), endDate: fromDbDate(row.endDate) };
      const lastWanted = batchPhase(batch, through) === "before" ? 0 : cycleAt(batch, through).index;

      const wanted = [];
      for (let seq = 1; seq <= lastWanted; seq += 1) {
        // In range by the bound above, so never null.
        wanted.push(cycleBounds(batch, seq)!);
      }

      await prisma.$transaction(
        wanted.map((w) =>
          prisma.cycle.upsert({
            where: { batchId_seq: { batchId, seq: w.index } },
            update: {},
            create: {
              batchId,
              seq: w.index,
              startDate: toDbDate(w.start),
              endDate: toDbDate(w.end),
            },
          }),
        ),
      );
      return listForBatch(batchId);
    },

    listForBatch,
  };
}

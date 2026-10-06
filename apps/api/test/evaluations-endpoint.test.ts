import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { civilDate } from "@irp/core";
import { buildTestServer } from "./helpers/build-test-server.js";
import { createBatchRepo } from "../src/db/batch-repo.js";
import { resetDb } from "./helpers/db.js";
import { signToken } from "./helpers/keys.js";
import { dbUrl } from "./helpers/require-db.js";

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

interface EvaluationLike {
  id: string;
  studentId: string;
  cycleSeq: number;
  performanceIndex: number;
  override: { newScore: number; originalScore: number; reason: string } | null;
}

// A batch old enough that cycles 1 and 2 (2026-01-10..2026-02-09 and
// 2026-02-10..2026-03-11) have both closed relative to any real-world "now"
// this suite runs under (today is well past 2026-03) — so
// EvaluationService.generateForCycle's CycleNotClosedError guard never fires
// here. The batch's own endDate is kept far in the future so it is never the
// thing under test.
const BATCH_START = civilDate("2026-01-10");
const BATCH_END = civilDate("2030-01-10");

describe.skipIf(!dbUrl)("evaluations endpoints", () => {
  let app: FastifyInstance;
  let prisma: Awaited<ReturnType<typeof buildTestServer>>["prisma"];

  beforeAll(async () => {
    ({ app, prisma } = await buildTestServer(dbUrl!));
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function mentor(externalId: string): Promise<string> {
    await prisma.user.create({
      data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "ADMIN" },
    });
    return signToken({ oid: externalId });
  }

  // Creates a student with an open enrolment spanning the batch's start date,
  // so cycles 1 and 2 are both fully spanned (FR-27) — `generateForCycle`
  // never rejects on enrolment coverage here.
  async function enrolledStudent(externalId: string): Promise<{ studentId: string; batchId: string }> {
    const batchRepo = createBatchRepo(prisma);
    const batch = await batchRepo.create({ name: `Batch ${externalId}`, startDate: BATCH_START, endDate: BATCH_END });
    const s = await prisma.user.create({
      data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "STUDENT" },
    });
    await batchRepo.enrol(s.id, batch.id, BATCH_START);
    return { studentId: s.id, batchId: batch.id };
  }

  it("404s before generation, 200s on generation, 200s after", async () => {
    const adminToken = await mentor("eval-e1-mentor");
    const { studentId } = await enrolledStudent("eval-e1-student");

    const before = await app.inject({
      method: "GET", url: `/api/v1/students/${studentId}/evaluations/1`,
      headers: bearer(adminToken),
    });
    expect(before.statusCode).toBe(404);

    const generated = await app.inject({
      method: "POST", url: `/api/v1/students/${studentId}/evaluations?cycle=1`,
      headers: bearer(adminToken),
    });
    expect(generated.statusCode).toBe(200);
    const evaluation = generated.json<EvaluationLike>();
    expect(evaluation.override).toBeNull();
    expect(evaluation.studentId).toBe(studentId);
    expect(evaluation.cycleSeq).toBe(1);

    const after = await app.inject({
      method: "GET", url: `/api/v1/students/${studentId}/evaluations/1`,
      headers: bearer(adminToken),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json<EvaluationLike>().id).toBe(evaluation.id);
  });

  it("409s a second generation request for the same cycle", async () => {
    const adminToken = await mentor("eval-e2-mentor");
    const { studentId } = await enrolledStudent("eval-e2-student");

    const first = await app.inject({
      method: "POST", url: `/api/v1/students/${studentId}/evaluations?cycle=1`,
      headers: bearer(adminToken),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST", url: `/api/v1/students/${studentId}/evaluations?cycle=1`,
      headers: bearer(adminToken),
    });
    expect(second.statusCode).toBe(409);
    expect(second.headers["content-type"]).toContain("application/problem+json");
  });

  it("PUT override persists the new score, original score, and reason", async () => {
    const adminToken = await mentor("eval-e3-mentor");
    const { studentId } = await enrolledStudent("eval-e3-student");

    const generated = await app.inject({
      method: "POST", url: `/api/v1/students/${studentId}/evaluations?cycle=2`,
      headers: bearer(adminToken),
    });
    expect(generated.statusCode).toBe(200);
    const evaluationId = generated.json<EvaluationLike>().id;
    const originalScore = generated.json<EvaluationLike>().performanceIndex;

    const overridden = await app.inject({
      method: "PUT", url: `/api/v1/evaluations/${evaluationId}/override`,
      headers: bearer(adminToken),
      payload: { newScore: 95, reason: "Exceptional final week." },
    });
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json<EvaluationLike>().override).toEqual({
      newScore: 95, originalScore, reason: "Exceptional final week.",
    });
  });

  it("rejects a student token with 403 admin-only", async () => {
    const { studentId } = await enrolledStudent("eval-e4-student");
    const studentToken = await signToken({ oid: "eval-e4-student" });

    const res = await app.inject({
      method: "POST", url: `/api/v1/students/${studentId}/evaluations?cycle=1`,
      headers: bearer(studentToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("rejects an unknown student id with 404 student-not-found", async () => {
    const adminToken = await mentor("eval-e5-mentor");
    const UNKNOWN_UUID = "00000000-0000-0000-0000-000000000000";

    const res = await app.inject({
      method: "POST", url: `/api/v1/students/${UNKNOWN_UUID}/evaluations?cycle=1`,
      headers: bearer(adminToken),
    });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ type: string }>();
    expect(body.type).toBe("https://irp.bistec.example/problems/student-not-found");
  });
});

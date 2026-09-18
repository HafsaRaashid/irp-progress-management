import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { addDays, isWeekday, toProgrammeDate } from "@irp/core";
import { buildTestServer } from "./helpers/build-test-server.js";
import { resolveRange } from "../src/routes/me-days.js";
import { resetDb } from "./helpers/db.js";
import { signToken } from "./helpers/keys.js";
import { dbUrl } from "./helpers/require-db.js";

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

interface ProblemLike {
  type: string;
  title: string;
  status: number;
}

interface DaySummaryLike {
  date: string;
  status: string;
  reportStatus: string | null;
  reportId: string | null;
  absenceReason: string | null;
  entries: { id: string; entryDate: string; body: string; isLate: boolean; isExtra: boolean }[];
}

describe.skipIf(!dbUrl)("GET /api/v1/me/days", () => {
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

  async function student(externalId: string) {
    return prisma.user.create({
      data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "STUDENT" },
    });
  }

  async function mentor(externalId: string) {
    return prisma.user.create({
      data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "ADMIN" },
    });
  }

  it("returns the day view with an entry mapped and reportStatus Submitted", async () => {
    await student("md-1");
    const today = toProgrammeDate(new Date());

    const posted = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "md-1" })),
      payload: { entryDate: today, body: "Wrote the day-view endpoint tests." },
    });
    expect(posted.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/me/days?from=${today}&to=${today}`,
      headers: bearer(await signToken({ oid: "md-1" })),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<DaySummaryLike[]>();
    expect(body).toHaveLength(1);
    const day = body[0]!;
    expect(day.date).toBe(today);
    expect(day.reportStatus).toBe("Submitted");
    expect(day.reportId).not.toBeNull();
    expect(day.absenceReason).toBeNull();
    expect(day.entries).toHaveLength(1);
    expect(day.entries[0]!.body).toBe("Wrote the day-view endpoint tests.");
    expect(day.status).toBe(isWeekday(today) ? "onTime" : "extra");
  });

  it("defaults to the current cycle when from/to are omitted", async () => {
    await student("md-2");
    const { from, to } = resolveRange();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/days",
      headers: bearer(await signToken({ oid: "md-2" })),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<DaySummaryLike[]>();
    expect(body[0]!.date).toBe(from);
    expect(body.at(-1)!.date).toBe(to);
  });

  it("respects an explicit range narrower than the current cycle", async () => {
    await student("md-3");
    const { from } = resolveRange();
    const to = addDays(from, 2);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/me/days?from=${from}&to=${to}`,
      headers: bearer(await signToken({ oid: "md-3" })),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<DaySummaryLike[]>();
    expect(body).toHaveLength(3);
    expect(body[0]!.date).toBe(from);
    expect(body.at(-1)!.date).toBe(to);
  });

  it("accepts a 92-day span — the boundary itself, not just comfortably inside it", async () => {
    await student("md-4a");
    const { from } = resolveRange();
    const to = addDays(from, 91); // from..to inclusive is exactly 92 days

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/me/days?from=${from}&to=${to}`,
      headers: bearer(await signToken({ oid: "md-4a" })),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<DaySummaryLike[]>();
    expect(body).toHaveLength(92);
  });

  it("rejects a 93-day span with 400 range-too-wide — one day past the boundary", async () => {
    await student("md-4b");
    const { from } = resolveRange();
    const to = addDays(from, 92); // from..to inclusive is exactly 93 days

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/me/days?from=${from}&to=${to}`,
      headers: bearer(await signToken({ oid: "md-4b" })),
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/range-too-wide");
  });

  it("rejects from after to with 400 invalid-range, distinct from range-too-wide", async () => {
    await student("md-5");
    const { from } = resolveRange();
    const to = addDays(from, -1);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/me/days?from=${from}&to=${to}`,
      headers: bearer(await signToken({ oid: "md-5" })),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/invalid-range");
    expect(body.title).toBe("Invalid range");
  });

  it("rejects a calendar-invalid date (2026-02-30, not a leap-valid day) with 400 before it ever reaches civilDate()", async () => {
    await student("md-invalid-date");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/days?from=2026-02-30",
      headers: bearer(await signToken({ oid: "md-invalid-date" })),
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/validation-failed");
  });

  it("rejects an unknown query property with 400", async () => {
    await student("md-6");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/days?unexpected=1",
      headers: bearer(await signToken({ oid: "md-6" })),
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/validation-failed");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me/days" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/unauthorized");
  });

  it("never includes score or countsTowardEvaluation on an entry, even after a mentor reviews it — a student must not receive either key", async () => {
    await student("md-7");
    await mentor("md-7-mentor");
    const today = toProgrammeDate(new Date());

    const posted = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "md-7" })),
      payload: { entryDate: today, body: "Entry that will be reviewed." },
    });
    expect(posted.statusCode).toBe(200);
    const entryId = posted.json<{ id: string }>().id;

    const reviewRes = await app.inject({
      method: "PUT",
      url: `/api/v1/entries/${entryId}/review`,
      headers: bearer(await signToken({ oid: "md-7-mentor" })),
      payload: { score: 77, feedback: "Reviewed.", countsTowardEvaluation: true },
    });
    expect(reviewRes.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/me/days?from=${today}&to=${today}`,
      headers: bearer(await signToken({ oid: "md-7" })),
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain("score");
    expect(res.payload).not.toContain("countsTowardEvaluation");
    const entry = res.json<DaySummaryLike[]>()[0]!.entries[0]!;
    expect(Object.keys(entry).sort()).toEqual(
      ["body", "entryDate", "id", "isExtra", "isLate", "submittedAt"].sort(),
    );
  });

  it("gives a mentor a uniform 'none' list rather than 403 or 'missed' — mentors have no enrolment days", async () => {
    await mentor("md-mentor");
    const { from, to } = resolveRange();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/me/days?from=${from}&to=${to}`,
      headers: bearer(await signToken({ oid: "md-mentor" })),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<DaySummaryLike[]>();
    expect(body.every((d) => d.entries.length === 0)).toBe(true);
    // Enrolment-clipped obligation: with no enrolment at all, every day is
    // always "none" — even a day that hasn't arrived yet. Outside enrolment,
    // "future" never applies (see spec DayStatus).
    for (const d of body) {
      expect(d.status).toBe("none");
    }
  });
});

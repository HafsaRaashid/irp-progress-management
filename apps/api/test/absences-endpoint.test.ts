import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { isWeekday, previousWeekday, toProgrammeDate, type CivilDate } from "@irp/core";
import { buildTestServer } from "./helpers/build-test-server.js";
import { resetDb } from "./helpers/db.js";
import { signToken } from "./helpers/keys.js";
import { dbUrl } from "./helpers/require-db.js";
import type { NotificationEvent } from "../src/services/notification-service.js";

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

interface ProblemLike {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

interface AbsenceLike {
  id: string;
  date: string;
  reason: string;
}

/**
 * A weekday still inside the current submission window (FR-14/FR-15), by the
 * same construction `entries-endpoint.test.ts` uses for its "previous
 * weekday" case: today itself when today is a weekday, else the weekday
 * immediately before it. Both are always canSubmitFor()-true — see
 * `submission-window.ts`'s grace-to-next-weekday rule.
 */
function weekdayInWindow(): CivilDate {
  const today = toProgrammeDate(new Date());
  return isWeekday(today) ? today : previousWeekday(today);
}

// Confirmed a Monday by `absence-repo.test.ts`'s own `MONDAY` constant.
const FIXED_MONDAY = new Date("2026-08-03T10:00:00.000Z");
const FIXED_SUNDAY: CivilDate = "2026-08-02" as CivilDate;

// Far enough back that its grace window closed years ago — same fixed date
// `entries-endpoint.test.ts` uses for its own window-closed case.
const PAST_FINAL_DATE = "2020-01-06";

describe.skipIf(!dbUrl)("POST /api/v1/absences and DELETE /api/v1/absences/{date}", () => {
  let app: FastifyInstance;
  let prisma: Awaited<ReturnType<typeof buildTestServer>>["prisma"];

  beforeAll(async () => {
    ({ app, prisma } = await buildTestServer(dbUrl!));
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterEach(() => {
    vi.useRealTimers();
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

  it("records a weekday absence inside the window (200)", async () => {
    await student("abs-1");
    const target = weekdayInWindow();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "abs-1" })),
      payload: { date: target, reason: "medical appointment" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<AbsenceLike>();
    expect(body.date).toBe(target);
    expect(body.reason).toBe("medical appointment");
    expect(body.id).toBeTruthy();
  });

  it("rejects a weekend date with 400 weekend-absence", async () => {
    await student("abs-2");
    // Fixed to a known Monday so the previous Sunday is still inside the
    // submission window (grace runs to the end of the next weekday) —
    // deterministic regardless of which real-world day this suite runs on.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_MONDAY);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "abs-2" })),
      payload: { date: FIXED_SUNDAY, reason: "n/a" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/weekend-absence");
  });

  it("rejects a date whose submission window has closed with 400 absence-window-closed", async () => {
    await student("abs-3");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "abs-3" })),
      payload: { date: PAST_FINAL_DATE, reason: "long past" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/absence-window-closed");
  });

  it("rejects a day that already holds entries with 409 entry-conflict", async () => {
    await student("abs-4");
    const target = weekdayInWindow();

    const entryRes = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "abs-4" })),
      payload: { entryDate: target, body: "Already worked this day." },
    });
    expect(entryRes.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "abs-4" })),
      payload: { date: target, reason: "also absent?" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/entry-conflict");
  });

  it("rejects marking a locked (Evaluated) day absent with 409 day-locked", async () => {
    const s = await student("abs-5");
    const target = weekdayInWindow();

    const entryRes = await app.inject({
      method: "POST",
      url: "/api/v1/entries",
      headers: bearer(await signToken({ oid: "abs-5" })),
      payload: { entryDate: target, body: "First entry of the day." },
    });
    expect(entryRes.statusCode).toBe(200);

    await prisma.dailyReport.updateMany({
      where: { studentId: s.id },
      data: { status: "EVALUATED", evaluatedAt: new Date() },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "abs-5" })),
      payload: { date: target, reason: "too late now" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/day-locked");
  });

  it("rejects a duplicate absence for the same date with 409 absence-exists", async () => {
    await student("abs-6");
    const target = weekdayInWindow();

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "abs-6" })),
      payload: { date: target, reason: "sick" },
    });
    expect(first.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "abs-6" })),
      payload: { date: target, reason: "again" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/absence-exists");
  });

  it("rejects an extra body property with 400", async () => {
    await student("abs-7");
    const target = weekdayInWindow();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "abs-7" })),
      payload: { date: target, reason: "sick", extra: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/validation-failed");
  });

  it("rejects a mentor token with 403 students-only", async () => {
    await mentor("abs-mentor-1");
    const target = weekdayInWindow();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "abs-mentor-1" })),
      payload: { date: target, reason: "mentors do not submit" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/students-only");
  });

  it("rejects an unauthenticated create request with 401", async () => {
    const target = weekdayInWindow();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      payload: { date: target, reason: "no token" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/unauthorized");
  });

  it("removes an existing absence and echoes the removed record (200)", async () => {
    await student("abs-8");
    const target = weekdayInWindow();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "abs-8" })),
      payload: { date: target, reason: "travel" },
    });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json<AbsenceLike>();

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/absences/${target}`,
      headers: bearer(await signToken({ oid: "abs-8" })),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<AbsenceLike>();
    expect(body.id).toBe(createdBody.id);
    expect(body.date).toBe(target);
    expect(body.reason).toBe("travel");
    expect(await prisma.absenceRecord.count()).toBe(0);
  });

  it("rejects removing a nonexistent absence with 404 absence-not-found", async () => {
    await student("abs-9");
    const target = weekdayInWindow();

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/absences/${target}`,
      headers: bearer(await signToken({ oid: "abs-9" })),
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/absence-not-found");
  });

  it("rejects removing an absence for a date whose window has closed with 400", async () => {
    await student("abs-10");

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/absences/${PAST_FINAL_DATE}`,
      headers: bearer(await signToken({ oid: "abs-10" })),
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/absence-window-closed");
  });

  it("rejects a mentor token on delete with 403 students-only", async () => {
    await mentor("abs-mentor-2");
    const target = weekdayInWindow();

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/absences/${target}`,
      headers: bearer(await signToken({ oid: "abs-mentor-2" })),
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/students-only");
  });

  it("rejects an unauthenticated delete request with 401", async () => {
    const target = weekdayInWindow();
    const res = await app.inject({ method: "DELETE", url: `/api/v1/absences/${target}` });

    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.type).toBe("https://irp.bistec.example/problems/unauthorized");
  });
});

// FR-21: same isolation rationale as entries-endpoint.test.ts's notification
// describe block — a dedicated app instance carrying a spy notificationService.
describe.skipIf(!dbUrl)("POST/DELETE /api/v1/absences — notifications (FR-21)", () => {
  let app: FastifyInstance;
  let prisma: Awaited<ReturnType<typeof buildTestServer>>["prisma"];
  const notify = vi.fn<(event: NotificationEvent) => void>();

  beforeAll(async () => {
    ({ app, prisma } = await buildTestServer(dbUrl!, { notificationService: { notify } }));
  });
  beforeEach(async () => {
    await resetDb(prisma);
    notify.mockReset();
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

  it("still returns 200 and commits the absence when notify() throws on every call", async () => {
    notify.mockImplementation(() => {
      throw new Error("notification dispatch exploded");
    });
    await student("notif-abs-1");
    const target = weekdayInWindow();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "notif-abs-1" })),
      payload: { date: target, reason: "medical" },
    });

    expect(res.statusCode).toBe(200);
    expect(await prisma.absenceRecord.count()).toBe(1);
  });

  it("calls notify() once on create", async () => {
    const s = await student("notif-abs-2");
    const target = weekdayInWindow();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "notif-abs-2" })),
      payload: { date: target, reason: "medical" },
    });

    expect(res.statusCode).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "AbsenceMarked", studentId: s.id, date: target, reason: "medical" }),
    );
  });

  it("does not call notify() on delete — retraction is not a submission (design spec §2)", async () => {
    await student("notif-abs-3");
    const target = weekdayInWindow();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: bearer(await signToken({ oid: "notif-abs-3" })),
      payload: { date: target, reason: "medical" },
    });
    expect(created.statusCode).toBe(200);
    notify.mockClear();

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/absences/${target}`,
      headers: bearer(await signToken({ oid: "notif-abs-3" })),
    });

    expect(res.statusCode).toBe(200);
    expect(notify).not.toHaveBeenCalled();
  });
});

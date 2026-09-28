import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { civilDate, graceDeadlineFor } from "@irp/core";
import { createPrismaClient } from "../src/db/client.js";
import { createEntryRepo } from "../src/db/entry-repo.js";
import { createAbsenceRepo } from "../src/db/absence-repo.js";
import { createBatchRepo } from "../src/db/batch-repo.js";
import { colomboInstant } from "../src/db/civil-date-map.js";
import { createDayService } from "../src/services/day-service.js";
import { resetDb } from "./helpers/db.js";
import { dbUrl } from "./helpers/require-db.js";

// A fixed historical week, ~63 days before the fixed NOW below (well past
// any grace window) so the fixtures are deterministic regardless of the
// machine's real clock. 2026-06-01 is a Monday.
const MON_ON_TIME = civilDate("2026-06-01");
const TUE_LATE = civilDate("2026-06-02");
const WED_ABSENT = civilDate("2026-06-03");
const THU_MISSED = civilDate("2026-06-04");
// FRI_UNUSED = 2026-06-05, left silent (also missed, unasserted).
const SAT_EXTRA = civilDate("2026-06-06");
const SUN_NONE = civilDate("2026-06-07");
const TODAY_PENDING = civilDate("2026-06-12"); // Friday
const TOMORROW_FUTURE = civilDate("2026-06-13"); // Saturday

const RANGE_FROM = MON_ON_TIME;
const RANGE_TO = TOMORROW_FUTURE;

// Friday 2026-06-12, 15:00 Colombo (09:30 UTC) — well inside that day, and
// well before Monday 2026-06-15's end-of-day grace close.
const NOW = colomboInstant(TODAY_PENDING, "15:00");

describe.skipIf(!dbUrl)("createDayService", () => {
  const prisma = createPrismaClient(dbUrl!);
  const entryRepo = createEntryRepo(prisma);
  const absenceRepo = createAbsenceRepo(prisma);
  const batchRepo = createBatchRepo(prisma);
  const service = createDayService({ entryRepo, absenceRepo, batchRepo });

  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function student(externalId: string) {
    return prisma.user.create({
      data: { externalId, email: `${externalId}@dev.local`, displayName: externalId, role: "STUDENT" },
    });
  }

  it("classifies onTime, late, absent, missed, extra, none, pending and future for an enrolled student (FR-14, FR-33)", async () => {
    const s = await student("day-1");
    // Enrolled for the whole range, so every day is evaluated by the engine
    // (none of them should fall back to the "outside enrolment" none path).
    const batch = await batchRepo.create({
      name: "Batch day-1", startDate: RANGE_FROM, endDate: civilDate("2026-11-30"),
    });
    await batchRepo.enrol(s.id, batch.id, RANGE_FROM);

    await entryRepo.addEntry({
      studentId: s.id,
      entryDate: MON_ON_TIME,
      body: "Wrote the day-service tests.",
      submittedAt: colomboInstant(MON_ON_TIME, "10:00"),
    });
    // Late: entryDate is Tuesday, but it lands the next weekday morning —
    // inside grace, after that day's own end.
    await entryRepo.addEntry({
      studentId: s.id,
      entryDate: TUE_LATE,
      body: "Yesterday's notes, submitted late.",
      submittedAt: colomboInstant(WED_ABSENT, "09:40"),
    });
    await absenceRepo.create({ studentId: s.id, date: WED_ABSENT, reason: "medical appointment" });
    // THU_MISSED: nothing recorded.
    await entryRepo.addEntry({
      studentId: s.id,
      entryDate: SAT_EXTRA,
      body: "Spent Saturday morning polishing the demo.",
      submittedAt: colomboInstant(SAT_EXTRA, "11:00"),
    });
    // SUN_NONE, TODAY_PENDING, TOMORROW_FUTURE: nothing recorded.

    const days = await service.listDays(s.id, RANGE_FROM, RANGE_TO, NOW);

    // Oldest-first, one element per calendar day in the range.
    expect(days.map((d) => d.date)).toEqual([
      "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05",
      "2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10",
      "2026-06-11", "2026-06-12", "2026-06-13",
    ]);

    const byDate = new Map(days.map((d) => [d.date, d]));

    const onTime = byDate.get(MON_ON_TIME)!;
    expect(onTime.status).toBe("onTime");
    expect(onTime.reportId).not.toBeNull();
    expect(onTime.reportStatus).toBe("IN_REVIEW");
    expect(onTime.absenceReason).toBeNull();
    expect(onTime.entries).toHaveLength(1);

    const late = byDate.get(TUE_LATE)!;
    expect(late.status).toBe("late");
    expect(late.reportId).not.toBeNull();
    expect(late.reportStatus).toBe("IN_REVIEW");
    expect(late.entries).toHaveLength(1);
    expect(late.entries[0]!.isLate).toBe(true);

    const absent = byDate.get(WED_ABSENT)!;
    expect(absent.status).toBe("absent");
    expect(absent.reportId).toBeNull();
    expect(absent.reportStatus).toBeNull();
    expect(absent.absenceReason).toBe("medical appointment");
    expect(absent.entries).toHaveLength(0);

    const missed = byDate.get(THU_MISSED)!;
    expect(missed.status).toBe("missed");
    expect(missed.reportId).toBeNull();
    expect(missed.absenceReason).toBeNull();
    expect(missed.entries).toHaveLength(0);

    const extra = byDate.get(SAT_EXTRA)!;
    expect(extra.status).toBe("extra");
    expect(extra.reportId).not.toBeNull();
    expect(extra.reportStatus).toBe("IN_REVIEW");
    expect(extra.entries).toHaveLength(1);
    expect(extra.entries[0]!.isExtra).toBe(true);

    const none = byDate.get(SUN_NONE)!;
    expect(none.status).toBe("none");
    expect(none.reportId).toBeNull();
    expect(none.entries).toHaveLength(0);

    // Confirm the fixture is actually testing what it claims: NOW must still
    // be inside TODAY_PENDING's grace window for the "pending" assertion
    // below to mean anything.
    expect(NOW.getTime()).toBeLessThanOrEqual(graceDeadlineFor(TODAY_PENDING).getTime());
    const pending = byDate.get(TODAY_PENDING)!;
    expect(pending.status).toBe("pending");
    expect(pending.reportId).toBeNull();
    expect(pending.entries).toHaveLength(0);

    const future = byDate.get(TOMORROW_FUTURE)!;
    expect(future.status).toBe("future");
    expect(future.reportId).toBeNull();
    expect(future.entries).toHaveLength(0);
  });

  it("gives a caller with no enrolment a uniform 'none'/'future' list, never 'missed' (mentor shape)", async () => {
    const s = await student("day-2");
    const days = await service.listDays(s.id, MON_ON_TIME, TUE_LATE, NOW);
    expect(days).toHaveLength(2);
    expect(days.every((d) => d.entries.length === 0)).toBe(true);
    // No enrolment at all: every day is always "none", even one that hasn't
    // arrived yet — outside enrolment, "future" never applies (see spec
    // DayStatus).
    for (const d of days) {
      expect(d.status).toBe("none");
    }
  });

  it("clips obligation to the enrolment interval: pre-enrolment weekdays are 'none', post-enrolment silent weekdays are 'missed' (FR-27 spirit)", async () => {
    const s = await student("day-3");
    // Joins mid-week, Wednesday 2026-06-03. Monday/Tuesday precede the
    // enrolment and carry no obligation; Wednesday onward do, and are silent
    // past a grace window closed by the same fixed NOW used above.
    const joinDate = WED_ABSENT; // 2026-06-03, reused as a plain civil date here
    const batch = await batchRepo.create({
      name: "Batch day-3", startDate: joinDate, endDate: civilDate("2026-11-30"),
    });
    await batchRepo.enrol(s.id, batch.id, joinDate);

    const days = await service.listDays(s.id, MON_ON_TIME, THU_MISSED, NOW);
    const byDate = new Map(days.map((d) => [d.date, d]));

    expect(byDate.get(MON_ON_TIME)!.status).toBe("none");
    expect(byDate.get(TUE_LATE)!.status).toBe("none");
    expect(byDate.get(joinDate)!.status).toBe("missed");
    expect(byDate.get(THU_MISSED)!.status).toBe("missed");
  });

  it("listDaysForStudents classifies every requested student in one pass", async () => {
    const batch = await batchRepo.create({
      name: "Batch Batched", startDate: civilDate("2026-05-10"), endDate: civilDate("2026-11-09"),
    });
    const one = await prisma.user.create({
      data: { externalId: "batched-1", email: "batched-1@dev.local", displayName: "One", role: "STUDENT" },
    });
    const two = await prisma.user.create({
      data: { externalId: "batched-2", email: "batched-2@dev.local", displayName: "Two", role: "STUDENT" },
    });
    await batchRepo.enrol(one.id, batch.id, civilDate("2026-05-10"));
    await batchRepo.enrol(two.id, batch.id, civilDate("2026-05-10"));
    // 2026-06-01 is a Monday. One submits on time; Two submits nothing.
    await entryRepo.addEntry({
      studentId: one.id,
      entryDate: civilDate("2026-06-01"),
      body: "Batched read fixture entry.",
      submittedAt: colomboInstant(civilDate("2026-06-01"), "10:00"),
    });
    const now = colomboInstant(civilDate("2026-06-15"), "10:00");

    const batched = await service.listDaysForStudents(
      [one.id, two.id], civilDate("2026-06-01"), civilDate("2026-06-05"), now,
    );

    expect([...batched.keys()].sort()).toEqual([one.id, two.id].sort());
    expect(batched.get(one.id)).toHaveLength(5);
    expect(batched.get(one.id)![0]!.status).toBe("onTime");
    expect(batched.get(two.id)![0]!.status).toBe("missed");

    // Finding 5, Plan 7 whole-branch review: this test used to close with
    // `expect(batched.get(id)).toEqual(await service.listDays(id, ...))` for
    // each student, framed as proving `listDaysForStudents` "agrees with"
    // `listDays`. That could never fail: `listDays` (day-service.ts) IS
    // `listDaysForStudents([studentId], ...).get(studentId)` -- one
    // implementation, not two independent ones to cross-check. No coverage is
    // lost by removing it: `listDays`'s own behaviour is already covered
    // directly, with richer fixtures, by the three tests above this one.
  });

  it("listDaysForStudents returns an empty map for an empty id list, without querying", async () => {
    const now = colomboInstant(civilDate("2026-06-15"), "10:00");
    const batched = await service.listDaysForStudents([], civilDate("2026-06-01"), civilDate("2026-06-05"), now);
    expect(batched.size).toBe(0);
  });
});

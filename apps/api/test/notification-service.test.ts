import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { createTracerProvider } from "../src/telemetry.js";
import {
  createNotificationService,
  type NotificationEvent,
  type TeamsMessage,
  type EmailMessage,
} from "../src/services/notification-service.js";
import type { UserRepo, UserRecord } from "../src/db/user-repo.js";

type Row = UserRecord & { deletedAt: Date | null };
interface ListFilter {
  role?: "ADMIN" | "STUDENT";
  archived: boolean;
}

function fakeUserRepo(users: Row[]): Pick<UserRepo, "list" | "findById"> {
  return {
    list: vi.fn((filter: ListFilter) =>
      Promise.resolve(
        users.filter(
          (u) =>
            (filter.role === undefined || u.role === filter.role) &&
            (filter.archived ? u.deletedAt !== null : u.deletedAt === null),
        ),
      ),
    ),
    findById: vi.fn((id: string) => Promise.resolve(users.find((u) => u.id === id) ?? null)),
  };
}

function fakeSender() {
  return {
    sendTeams: vi.fn<(message: TeamsMessage) => Promise<void>>(() => Promise.resolve()),
    sendEmail: vi.fn<(message: EmailMessage) => Promise<void>>(() => Promise.resolve()),
  };
}

const mentorA: Row = {
  id: "mentor-a", externalId: "mentor-a", email: "a@dev.local", displayName: "Mentor A",
  role: "ADMIN", deletedAt: null,
};
const mentorB: Row = {
  id: "mentor-b", externalId: "mentor-b", email: "b@dev.local", displayName: "Mentor B",
  role: "ADMIN", deletedAt: null,
};
const studentOne: Row = {
  id: "student-1", externalId: "student-1", email: "s@dev.local", displayName: "Student One",
  role: "STUDENT", deletedAt: null,
};

const entrySubmitted: NotificationEvent = {
  type: "EntrySubmitted",
  studentId: "student-1",
  entryDate: "2026-06-08",
  submittedAt: new Date("2026-06-08T10:00:00Z"),
};

function build(users: Row[]) {
  const userRepo = fakeUserRepo(users);
  const teams = fakeSender();
  const email = fakeSender();
  const exporter = new InMemorySpanExporter();
  const tracerProvider = createTracerProvider(exporter);
  const logger = { warn: vi.fn() };
  const service = createNotificationService({
    userRepo,
    teams,
    email,
    webBaseUrl: "http://localhost:3100",
    tracer: tracerProvider.getTracer("test"),
    logger,
  });
  return { service, teams, email, userRepo, logger, exporter };
}

// notify() kicks off its dispatch without the caller awaiting it — give the
// microtask/timer queue a turn so assertions can observe it.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createNotificationService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fans out one email per current ADMIN user, addressed individually, and never to a STUDENT", async () => {
    const { service, email } = build([mentorA, mentorB, studentOne]);
    service.notify(entrySubmitted);
    await flush();

    expect(email.sendEmail).toHaveBeenCalledTimes(2);
    const recipients = email.sendEmail.mock.calls.map((c) => c[0].to);
    expect(recipients.sort()).toEqual(["a@dev.local", "b@dev.local"]);
  });

  it("posts exactly one Teams message per event, not one per mentor", async () => {
    const { service, teams } = build([mentorA, mentorB]);
    service.notify(entrySubmitted);
    await flush();

    expect(teams.sendTeams).toHaveBeenCalledTimes(1);
  });

  it("includes the deep link to the student's review page in both channels", async () => {
    const { service, teams, email } = build([mentorA, studentOne]);
    service.notify(entrySubmitted);
    await flush();

    expect(teams.sendTeams.mock.calls[0]![0].text).toContain(
      "http://localhost:3100/review/student-1",
    );
    expect(email.sendEmail.mock.calls[0]![0].body).toContain(
      "http://localhost:3100/review/student-1",
    );
  });

  it("names the student in the message using the current display name", async () => {
    const { service, teams } = build([mentorA, studentOne]);
    service.notify(entrySubmitted);
    await flush();

    expect(teams.sendTeams.mock.calls[0]![0].title).toContain("Student One");
  });

  it("builds the correct summary line for each of the three event types", async () => {
    const { service, teams } = build([mentorA, studentOne]);

    service.notify(entrySubmitted);
    await flush();
    expect(teams.sendTeams.mock.calls[0]![0].title).toContain("Entry submitted");

    service.notify({
      type: "AbsenceMarked", studentId: "student-1", date: "2026-06-08", reason: "medical",
    });
    await flush();
    expect(teams.sendTeams.mock.calls[1]![0].title).toContain("Absent");
    expect(teams.sendTeams.mock.calls[1]![0].title).toContain("medical");

    service.notify({
      type: "ReportTransitioned", studentId: "student-1", reportId: "report-1", to: "InReview",
    });
    await flush();
    expect(teams.sendTeams.mock.calls[2]![0].title).toContain("In Review");

    service.notify({
      type: "ReportTransitioned", studentId: "student-1", reportId: "report-1", to: "Evaluated",
    });
    await flush();
    expect(teams.sendTeams.mock.calls[3]![0].title).toContain("Evaluated");
  });

  it("does not throw when a sender rejects on every call", async () => {
    const { service, teams, email } = build([mentorA, studentOne]);
    teams.sendTeams.mockRejectedValue(new Error("Teams is down"));
    email.sendEmail.mockRejectedValue(new Error("SMTP is down"));

    expect(() => service.notify(entrySubmitted)).not.toThrow();
    await flush();
    expect(teams.sendTeams).toHaveBeenCalled();
  });

  it("logs a warning, not an error, when a sender rejects", async () => {
    const { service, teams, logger } = build([mentorA, studentOne]);
    teams.sendTeams.mockRejectedValue(new Error("Teams is down"));

    service.notify(entrySubmitted);
    await flush();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "EntrySubmitted" }),
      expect.stringContaining("teams"),
    );
  });

  it("skips email fan-out but still posts to Teams when the ADMIN roster is empty", async () => {
    const { service, teams, email } = build([studentOne]);
    service.notify(entrySubmitted);
    await flush();

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(teams.sendTeams).toHaveBeenCalledTimes(1);
  });

  it("never awaits notify() itself — it returns synchronously", () => {
    const { service } = build([mentorA, studentOne]);
    const result = service.notify(entrySubmitted);
    expect(result).toBeUndefined();
  });
});

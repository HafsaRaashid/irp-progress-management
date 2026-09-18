import type { Tracer } from "@opentelemetry/api";
import type { UserRepo } from "../db/user-repo.js";

// Property-typed (not method-shorthand) so a test can hold a bare reference
// to `.warn` for `expect(logger.warn).toHaveBeenCalledWith(...)` without
// tripping @typescript-eslint/unbound-method, which treats method-shorthand
// signatures as potentially `this`-dependent.
export interface NotificationLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

export interface TeamsMessage {
  title: string;
  text: string;
  link: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * Two adapters (TeamsWebhookSender, SmtpEmailSender) share this interface
 * per the design spec (§3) even though each only meaningfully implements
 * its own half — see notification-senders.ts. Property-typed for the same
 * unbound-method reason as NotificationLogger above — tests spy on these
 * methods by bare reference.
 */
export interface NotificationSender {
  sendTeams: (message: TeamsMessage) => Promise<void>;
  sendEmail: (message: EmailMessage) => Promise<void>;
}

export type NotificationEvent =
  | { type: "EntrySubmitted"; studentId: string; entryDate: string; submittedAt: Date }
  | { type: "AbsenceMarked"; studentId: string; date: string; reason: string }
  | { type: "ReportTransitioned"; studentId: string; reportId: string; to: "InReview" | "Evaluated" };

export interface NotificationService {
  /**
   * Fire-and-forget (design spec D5): always returns synchronously and never
   * rejects — a sender failure is caught, logged, and never reaches the
   * caller. The triggering write has already committed by the time a route
   * calls this.
   */
  notify(event: NotificationEvent): void;
}

export interface NotificationServiceDeps {
  userRepo: Pick<UserRepo, "list" | "findById">;
  teams: NotificationSender;
  email: NotificationSender;
  webBaseUrl: string;
  tracer: Tracer;
  logger: NotificationLogger;
}

const TRANSITION_LABEL: Record<"InReview" | "Evaluated", string> = {
  InReview: "Moved to In Review",
  Evaluated: "Moved to Evaluated",
};

/** The event description and, when the event carries one, the date in question (design spec §5). */
function describeEvent(event: NotificationEvent): { description: string; date: string | null } {
  switch (event.type) {
    case "EntrySubmitted":
      return { description: "Entry submitted", date: event.entryDate };
    case "AbsenceMarked":
      return { description: `Absent — ${event.reason}`, date: event.date };
    case "ReportTransitioned":
      return { description: TRANSITION_LABEL[event.to], date: null };
  }
}

function buildContent(
  event: NotificationEvent,
  studentName: string,
  webBaseUrl: string,
): { title: string; text: string; subject: string; body: string; link: string } {
  const { description, date } = describeEvent(event);
  const link = `${webBaseUrl}/review/${event.studentId}`;
  const title = `${description} — ${studentName}`;
  const detail = date !== null ? `${date} — Open review: ${link}` : `Open review: ${link}`;
  const bodyDate = date !== null ? ` (${date})` : "";
  return {
    title,
    text: detail,
    subject: title,
    body: `${studentName} — ${description}${bodyDate}\n\n${link}`,
    link,
  };
}

export function createNotificationService(deps: NotificationServiceDeps): NotificationService {
  const { userRepo, teams, email, webBaseUrl, tracer, logger } = deps;

  async function withSpan(
    spanName: string,
    event: NotificationEvent,
    recipient: string,
    work: () => Promise<void>,
  ): Promise<void> {
    const span = tracer.startSpan(spanName);
    try {
      await work();
    } catch (err) {
      span.recordException(err instanceof Error ? err : String(err));
      logger.warn({ event: event.type, recipient, err }, `${spanName} dispatch failed`);
    } finally {
      span.end();
    }
  }

  async function dispatch(event: NotificationEvent): Promise<void> {
    const student = await userRepo.findById(event.studentId);
    const studentName = student?.displayName ?? event.studentId;
    const { title, text, subject, body, link } = buildContent(event, studentName, webBaseUrl);

    await withSpan("notification.teams", event, "teams", () => teams.sendTeams({ title, text, link }));

    const mentors = await userRepo.list({ role: "ADMIN", archived: false });
    await Promise.all(
      mentors.map((mentor) =>
        withSpan("notification.email", event, mentor.email, () =>
          email.sendEmail({ to: mentor.email, subject, body }),
        ),
      ),
    );
  }

  return {
    notify(event) {
      dispatch(event).catch(() => {
        // dispatch() never rejects (withSpan swallows every failure) — this
        // is a final backstop, not the intended failure path.
      });
    },
  };
}

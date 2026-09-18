import nodemailer from "nodemailer";
import type {
  NotificationSender,
  NotificationLogger,
  TeamsMessage,
  EmailMessage,
} from "./notification-service.js";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromEmail: string;
}

/**
 * MessageCard is the legacy but still-supported Incoming Webhook payload
 * shape (ADR-0024) — a title, a text body, and one action button to the
 * deep link, per design spec §5.
 */
function buildMessageCard(message: TeamsMessage): Record<string, unknown> {
  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    title: message.title,
    text: message.text,
    potentialAction: [
      {
        "@type": "OpenUri",
        name: "Open review",
        targets: [{ os: "default", uri: message.link }],
      },
    ],
  };
}

export function createTeamsWebhookSender(
  webhookUrl: string | undefined,
  logger: NotificationLogger,
): NotificationSender {
  if (webhookUrl === undefined) {
    logger.warn({}, "Teams notifications disabled: TEAMS_WEBHOOK_URL is not set");
    return {
      sendTeams: () => Promise.resolve(),
      sendEmail: () => {
        return Promise.reject(new Error("TeamsWebhookSender does not send email"));
      },
    };
  }

  return {
    async sendTeams(message) {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildMessageCard(message)),
      });
      if (!res.ok) {
        throw new Error(`Teams webhook responded ${res.status}`);
      }
    },
    sendEmail: () => {
      return Promise.reject(new Error("TeamsWebhookSender does not send email"));
    },
  };
}

export function createSmtpEmailSender(
  config: SmtpConfig | undefined,
  logger: NotificationLogger,
): NotificationSender {
  if (config === undefined) {
    logger.warn({}, "Email notifications disabled: SMTP is not fully configured");
    return {
      sendTeams: () => {
        return Promise.reject(new Error("SmtpEmailSender does not send Teams messages"));
      },
      sendEmail: () => Promise.resolve(),
    };
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    auth: { user: config.user, pass: config.pass },
  });

  return {
    sendTeams: () => {
      return Promise.reject(new Error("SmtpEmailSender does not send Teams messages"));
    },
    async sendEmail(message: EmailMessage) {
      await transport.sendMail({
        from: config.fromEmail,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
    },
  };
}

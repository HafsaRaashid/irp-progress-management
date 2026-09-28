import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import nodemailer from "nodemailer";
import {
  createTeamsWebhookSender,
  createSmtpEmailSender,
} from "../src/services/notification-senders.js";

vi.mock("nodemailer");

type FetchLike = (input: string, init: { method: string; body: string }) => Promise<Response>;

interface MessageCardPayload {
  "@type": string;
  title: string;
  text: string;
}

describe("createTeamsWebhookSender", () => {
  const logger = { warn: vi.fn() };
  let fetchSpy: ReturnType<typeof vi.fn<FetchLike>>;

  beforeEach(() => {
    logger.warn.mockReset();
    fetchSpy = vi.fn<FetchLike>(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs a MessageCard-shaped JSON payload to the configured webhook URL", async () => {
    const sender = createTeamsWebhookSender("https://outlook.office.com/webhook/abc", logger);
    await sender.sendTeams({
      title: "Entry submitted — Student One",
      text: "2026-06-08 — Open review",
      link: "http://localhost:3100/review/student-1",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://outlook.office.com/webhook/abc");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(init.body) as MessageCardPayload;
    expect(payload["@type"]).toBe("MessageCard");
    expect(payload.title).toContain("Entry submitted");
    expect(JSON.stringify(payload)).toContain("http://localhost:3100/review/student-1");
  });

  it("no-ops and logs once at construction when the webhook URL is unset", async () => {
    const sender = createTeamsWebhookSender(undefined, logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await sender.sendTeams({ title: "x", text: "y", link: "z" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws if asked to send email — it only implements the Teams half of the shared interface", async () => {
    const sender = createTeamsWebhookSender("https://outlook.office.com/webhook/abc", logger);
    await expect(sender.sendEmail({ to: "x@y.com", subject: "s", body: "b" })).rejects.toThrow();
  });
});

describe("createSmtpEmailSender", () => {
  const logger = { warn: vi.fn() };
  const sendMail = vi.fn<() => Promise<{ messageId: string }>>(() =>
    Promise.resolve({ messageId: "1" }),
  );

  beforeEach(() => {
    logger.warn.mockReset();
    sendMail.mockClear();
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as unknown as ReturnType<
      typeof nodemailer.createTransport
    >);
  });

  it("sends via nodemailer with the configured from address", async () => {
    const sender = createSmtpEmailSender(
      { host: "smtp.office365.com", port: 587, user: "svc@bistec.example", pass: "secret", fromEmail: "svc@bistec.example" },
      logger,
    );
    await sender.sendEmail({ to: "mentor@bistec.example", subject: "Entry submitted", body: "..." });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "svc@bistec.example",
        to: "mentor@bistec.example",
        subject: "Entry submitted",
      }),
    );
  });

  it("no-ops and logs once at construction when SMTP config is unset", async () => {
    const sender = createSmtpEmailSender(undefined, logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await sender.sendEmail({ to: "x@y.com", subject: "s", body: "b" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("throws if asked to send a Teams message — it only implements the email half of the shared interface", async () => {
    const sender = createSmtpEmailSender(
      { host: "smtp.office365.com", port: 587, user: "svc@bistec.example", pass: "secret", fromEmail: "svc@bistec.example" },
      logger,
    );
    await expect(sender.sendTeams({ title: "t", text: "x", link: "y" })).rejects.toThrow();
  });
});

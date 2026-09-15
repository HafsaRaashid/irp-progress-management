import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgresql://irp:irp@localhost:5432/irp?schema=public",
  JWKS_URI: "https://example/keys",
  JWT_ISSUER: "https://issuer/v2.0",
  JWT_AUDIENCE: "api://irp",
};

describe("loadConfig", () => {
  it("applies defaults for optional vars", () => {
    const c = loadConfig({ ...base });
    expect(c.port).toBe(3001);
    expect(c.version).toBe("0.0.0");
    expect(c.nodeEnv).toBe("development");
  });

  it("parses PORT as a number", () => {
    expect(loadConfig({ ...base, PORT: "8080" }).port).toBe(8080);
  });

  it("throws listing every missing required var", () => {
    expect(() => loadConfig({})).toThrowError(
      /DATABASE_URL.*JWKS_URI.*JWT_ISSUER.*JWT_AUDIENCE/s,
    );
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => loadConfig({ ...base, PORT: "not-a-number" })).toThrowError(/PORT/);
  });

  it.each(["development", "test", "production"] as const)(
    "accepts NODE_ENV=%s",
    (value) => {
      expect(loadConfig({ ...base, NODE_ENV: value }).nodeEnv).toBe(value);
    },
  );

  it("rejects an invalid NODE_ENV", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "staging" })).toThrowError(
      /NODE_ENV.*staging.*development.*test.*production/is,
    );
  });

  it("leaves notification config undefined when every notification var is unset (FR-21)", () => {
    const c = loadConfig({ ...base });
    expect(c.teamsWebhookUrl).toBeUndefined();
    expect(c.smtp).toBeUndefined();
    expect(c.webBaseUrl).toBe("http://localhost:3100");
  });

  it("picks up TEAMS_WEBHOOK_URL and a custom WEB_BASE_URL independently of SMTP", () => {
    const c = loadConfig({
      ...base,
      TEAMS_WEBHOOK_URL: "https://outlook.office.com/webhook/abc",
      WEB_BASE_URL: "https://irp.bistec.example",
    });
    expect(c.teamsWebhookUrl).toBe("https://outlook.office.com/webhook/abc");
    expect(c.webBaseUrl).toBe("https://irp.bistec.example");
    expect(c.smtp).toBeUndefined();
  });

  it("populates smtp only when the full SMTP block is present", () => {
    const c = loadConfig({
      ...base,
      SMTP_HOST: "smtp.office365.com",
      SMTP_PORT: "587",
      SMTP_USER: "svc@bistec.example",
      SMTP_PASS: "secret",
      NOTIFICATIONS_FROM_EMAIL: "svc@bistec.example",
    });
    expect(c.smtp).toEqual({
      host: "smtp.office365.com",
      port: 587,
      user: "svc@bistec.example",
      pass: "secret",
      fromEmail: "svc@bistec.example",
    });
  });

  it("does not fail to load, and leaves smtp undefined, when the SMTP block is only partially set", () => {
    const c = loadConfig({
      ...base,
      SMTP_HOST: "smtp.office365.com",
      // SMTP_USER, SMTP_PASS, NOTIFICATIONS_FROM_EMAIL all missing.
    });
    expect(c.smtp).toBeUndefined();
  });
});

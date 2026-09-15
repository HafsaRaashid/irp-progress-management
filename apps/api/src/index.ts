import { createRemoteJWKSet } from "jose";
import pino from "pino";
import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { createPrismaClient } from "./db/client.js";
import { createUserRepo } from "./db/user-repo.js";
import { createEntryRepo } from "./db/entry-repo.js";
import { createAbsenceRepo } from "./db/absence-repo.js";
import { createBatchRepo } from "./db/batch-repo.js";
import { createMentorRecordRepo } from "./db/mentor-record-repo.js";
import { selectSpanExporter } from "./exporter.js";
import { buildServer } from "./server.js";
import { registerShutdown } from "./shutdown.js";
import { createTracerProvider } from "./telemetry.js";
import { createDayService } from "./services/day-service.js";
import { createRosterService } from "./services/roster-service.js";
import { createDashboardService } from "./services/dashboard-service.js";
import { createNotificationService } from "./services/notification-service.js";
import { createTeamsWebhookSender, createSmtpEmailSender } from "./services/notification-senders.js";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig(process.env);
const prisma = createPrismaClient(config.databaseUrl);

const rawTimeout = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
const timeoutMs =
  Number.isInteger(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_SHUTDOWN_TIMEOUT_MS;

await bootstrap({
  start: async () => {
    const userRepo = createUserRepo(prisma);
    const entryRepo = createEntryRepo(prisma);
    const absenceRepo = createAbsenceRepo(prisma);
    const batchRepo = createBatchRepo(prisma);
    const mentorRecordRepo = createMentorRecordRepo(prisma);
    const dayService = createDayService({ entryRepo, absenceRepo, batchRepo });
    const rosterService = createRosterService({ batchRepo, dayService, mentorRecordRepo });
    const dashboardService = createDashboardService({ batchRepo, dayService });
    const getKey = createRemoteJWKSet(new URL(config.jwksUri));
    const tracerProvider = createTracerProvider(selectSpanExporter(process.env));

    // FR-21. Its own logger, independent of Fastify's request-scoped one —
    // notify() is called from route handlers but never awaited by them, so
    // its failures are dispatch-time, not request-time, events.
    const notificationLogger = pino({ name: "notifications" });
    const notificationService = createNotificationService({
      userRepo,
      teams: createTeamsWebhookSender(config.teamsWebhookUrl, notificationLogger),
      email: createSmtpEmailSender(config.smtp, notificationLogger),
      webBaseUrl: config.webBaseUrl,
      tracer: tracerProvider.getTracer("irp-api"),
      logger: notificationLogger,
    });

    const app = await buildServer({
      config, userRepo, entryRepo, absenceRepo, batchRepo, mentorRecordRepo,
      dayService, rosterService, dashboardService, notificationService, getKey, tracerProvider, prisma,
    });

    registerShutdown({
      close: () => app.close(),
      disconnect: () => prisma.$disconnect(),
      exit: (code) => {
        process.exit(code);
      },
      log: (event, err) => {
        if (err === undefined) {
          app.log.info(event);
        } else {
          app.log.error({ err }, event);
        }
      },
      timeoutMs,
      signals: ["SIGTERM", "SIGINT"],
      on: (signal, handler) => {
        process.on(signal, handler);
      },
    });

    await app.listen({ port: config.port, host: "0.0.0.0" });
  },
  disconnect: () => prisma.$disconnect(),
  // No app.log here on purpose: if buildServer rejected there is no app.
  fatal: (err) => {
    console.error(err);
    process.exit(1);
  },
});

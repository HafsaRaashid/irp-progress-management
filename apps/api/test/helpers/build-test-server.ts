import type { FastifyInstance } from "fastify";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { createPrismaClient } from "../../src/db/client.js";
import { createUserRepo } from "../../src/db/user-repo.js";
import { createEntryRepo } from "../../src/db/entry-repo.js";
import { createAbsenceRepo } from "../../src/db/absence-repo.js";
import { createBatchRepo } from "../../src/db/batch-repo.js";
import { createMentorRecordRepo } from "../../src/db/mentor-record-repo.js";
import { createDayService } from "../../src/services/day-service.js";
import { createRosterService } from "../../src/services/roster-service.js";
import { createDashboardService } from "../../src/services/dashboard-service.js";
import type { NotificationService } from "../../src/services/notification-service.js";
import { createTracerProvider } from "../../src/telemetry.js";
import { buildServer } from "../../src/server.js";
import { getLocalKeySet, testIssuer, testAudience } from "./keys.js";

// Every existing suite gets zero notification behaviour by default — FR-21
// tests override this explicitly (see notification-related cases in
// entries/absences/reviews-endpoint.test.ts).
const noopNotificationService: NotificationService = { notify: () => undefined };

export async function buildTestServer(
  databaseUrl: string,
  overrides: { notificationService?: NotificationService } = {},
): Promise<{
  app: FastifyInstance;
  exporter: InMemorySpanExporter;
  prisma: ReturnType<typeof createPrismaClient>;
}> {
  const prisma = createPrismaClient(databaseUrl);
  const exporter = new InMemorySpanExporter();
  const entryRepo = createEntryRepo(prisma);
  const absenceRepo = createAbsenceRepo(prisma);
  const batchRepo = createBatchRepo(prisma);
  const mentorRecordRepo = createMentorRecordRepo(prisma);
  const dayService = createDayService({ entryRepo, absenceRepo, batchRepo });
  const dashboardService = createDashboardService({ batchRepo, dayService });
  const app = await buildServer({
    config: {
      port: 3001, databaseUrl, jwksUri: "unused",
      jwtIssuer: testIssuer, jwtAudience: testAudience, version: "0.0.0", nodeEnv: "test",
      teamsWebhookUrl: undefined, smtp: undefined, webBaseUrl: "http://localhost:3100",
    },
    userRepo: createUserRepo(prisma),
    entryRepo,
    absenceRepo,
    batchRepo,
    mentorRecordRepo,
    dayService,
    rosterService: createRosterService({ batchRepo, dayService, mentorRecordRepo }),
    dashboardService,
    notificationService: overrides.notificationService ?? noopNotificationService,
    getKey: await getLocalKeySet(),
    tracerProvider: createTracerProvider(exporter),
    prisma,
  });
  return { app, exporter, prisma };
}

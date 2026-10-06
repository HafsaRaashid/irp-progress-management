import type { FastifyInstance } from "fastify";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { createPrismaClient } from "../../src/db/client.js";
import { createUserRepo } from "../../src/db/user-repo.js";
import { createEntryRepo } from "../../src/db/entry-repo.js";
import { createAbsenceRepo } from "../../src/db/absence-repo.js";
import { createBatchRepo } from "../../src/db/batch-repo.js";
import { createMentorRecordRepo } from "../../src/db/mentor-record-repo.js";
import { createEvaluationRepo } from "../../src/db/evaluation-repo.js";
import { createDayService } from "../../src/services/day-service.js";
import { createRosterService } from "../../src/services/roster-service.js";
import { createDashboardService } from "../../src/services/dashboard-service.js";
import { createEvaluationService } from "../../src/services/evaluation-service.js";
import type { NotificationService } from "../../src/services/notification-service.js";
import type { EvaluationAiClient } from "../../src/services/evaluation-ai-client.js";
import { createTracerProvider } from "../../src/telemetry.js";
import { buildServer } from "../../src/server.js";
import { getLocalKeySet, testIssuer, testAudience } from "./keys.js";
import { fakeEvaluationAiClient } from "./fake-evaluation-ai-client.js";

// Every existing suite gets zero notification behaviour by default — FR-21
// tests override this explicitly (see notification-related cases in
// entries/absences/reviews-endpoint.test.ts).
const noopNotificationService: NotificationService = { notify: () => undefined };

export async function buildTestServer(
  databaseUrl: string,
  overrides: { notificationService?: NotificationService; aiClient?: EvaluationAiClient } = {},
): Promise<{
  app: FastifyInstance;
  exporter: InMemorySpanExporter;
  prisma: ReturnType<typeof createPrismaClient>;
}> {
  const prisma = createPrismaClient(databaseUrl);
  const exporter = new InMemorySpanExporter();
  const userRepo = createUserRepo(prisma);
  const entryRepo = createEntryRepo(prisma);
  const absenceRepo = createAbsenceRepo(prisma);
  const batchRepo = createBatchRepo(prisma);
  const mentorRecordRepo = createMentorRecordRepo(prisma);
  const evaluationRepo = createEvaluationRepo(prisma);
  const dayService = createDayService({ entryRepo, absenceRepo, batchRepo });
  const dashboardService = createDashboardService({ batchRepo, dayService });
  // No suite ever makes a real network call here — the AI provider ADR (O-5)
  // is still pending, so a fixed, fake result is the only thing any test is
  // allowed to depend on. Overridable per-suite, same pattern as
  // notificationService.
  const evaluationService = createEvaluationService({
    batchRepo, entryRepo, mentorRecordRepo, absenceRepo, evaluationRepo, userRepo,
    aiClient: overrides.aiClient ?? fakeEvaluationAiClient(),
  });
  const app = await buildServer({
    config: {
      port: 3001, databaseUrl, jwksUri: "unused",
      jwtIssuer: testIssuer, jwtAudience: testAudience, version: "0.0.0", nodeEnv: "test",
      teamsWebhookUrl: undefined, smtp: undefined, webBaseUrl: "http://localhost:3100", azureOpenAi: undefined,
    },
    userRepo,
    entryRepo,
    absenceRepo,
    batchRepo,
    mentorRecordRepo,
    dayService,
    rosterService: createRosterService({ batchRepo, dayService, mentorRecordRepo }),
    dashboardService,
    notificationService: overrides.notificationService ?? noopNotificationService,
    evaluationService,
    getKey: await getLocalKeySet(),
    tracerProvider: createTracerProvider(exporter),
    prisma,
  });
  return { app, exporter, prisma };
}

import Fastify, { type FastifyInstance } from "fastify";
import type { JWTVerifyGetKey } from "jose";
import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { AppConfig } from "./config.js";
import type { UserRepo } from "./db/user-repo.js";
import type { EntryRepo } from "./db/entry-repo.js";
import type { AbsenceRepo } from "./db/absence-repo.js";
import type { BatchRepo } from "./db/batch-repo.js";
import type { MentorRecordRepo } from "./db/mentor-record-repo.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { createValidatorCompiler } from "./validation.js";
import { tracingPlugin } from "./telemetry.js";
import { problemDetailsPlugin } from "./plugins/problem-details.js";
import { authPlugin } from "./plugins/auth.js";
import { requireAuthPlugin } from "./plugins/require-auth.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { entryRoutes } from "./routes/entries.js";
import { meDaysRoutes } from "./routes/me-days.js";
import { absenceRoutes } from "./routes/absences.js";
import { batchRoutes } from "./routes/batches.js";
import { reviewRoutes } from "./routes/reviews.js";
import { userRoutes } from "./routes/users.js";
import { adminActionRoutes } from "./routes/admin-actions.js";
import { dashboardRoutes } from "./routes/dashboards.js";
import type { DayService } from "./services/day-service.js";
import type { RosterService } from "./services/roster-service.js";
import type { DashboardService } from "./services/dashboard-service.js";
import type { NotificationService } from "./services/notification-service.js";

export interface ServerDeps {
  config: AppConfig;
  userRepo: UserRepo;
  entryRepo: EntryRepo;
  absenceRepo: AbsenceRepo;
  batchRepo: BatchRepo;
  mentorRecordRepo: MentorRecordRepo;
  dayService: DayService;
  rosterService: RosterService;
  dashboardService: DashboardService;
  notificationService: NotificationService;
  getKey: JWTVerifyGetKey;
  tracerProvider: NodeTracerProvider;
  // Handed to userRoutes for exactly one call site — see the comment there.
  prisma: PrismaClient;
}

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.nodeEnv !== "test" });
  app.decorate("config", deps.config);
  // Wired now so the moment a request body lands (Plan 6) it is validated
  // against the spec's 2020-12 schema, not Fastify's draft-07 default.
  // The compiler picks a strict instance for bodies and a coercing one for
  // querystring/params/headers — see validation.ts.
  app.setValidatorCompiler(createValidatorCompiler());

  await app.register(tracingPlugin, { tracerProvider: deps.tracerProvider });
  await app.register(problemDetailsPlugin);
  await app.register(authPlugin, {
    getKey: deps.getKey,
    issuer: deps.config.jwtIssuer,
    audience: deps.config.jwtAudience,
    userRepo: deps.userRepo,
  });
  // Fail-closed for /api/* before routing. Order is enforced by fastify-plugin's
  // dependency graph, not by convention — a wrong order throws at boot.
  await app.register(requireAuthPlugin);
  await app.register(healthRoutes);
  await app.register(meRoutes);
  await app.register(entryRoutes, {
    entryRepo: deps.entryRepo,
    notificationService: deps.notificationService,
  });
  await app.register(absenceRoutes, {
    absenceRepo: deps.absenceRepo,
    notificationService: deps.notificationService,
  });
  await app.register(meDaysRoutes, { dayService: deps.dayService });
  await app.register(batchRoutes, { batchRepo: deps.batchRepo, rosterService: deps.rosterService });
  await app.register(dashboardRoutes, { dashboardService: deps.dashboardService });
  await app.register(reviewRoutes, {
    entryRepo: deps.entryRepo,
    userRepo: deps.userRepo,
    mentorRecordRepo: deps.mentorRecordRepo,
    dayService: deps.dayService,
    notificationService: deps.notificationService,
  });
  await app.register(userRoutes, {
    userRepo: deps.userRepo,
    batchRepo: deps.batchRepo,
    prisma: deps.prisma,
  });
  await app.register(adminActionRoutes, {
    userRepo: deps.userRepo,
    batchRepo: deps.batchRepo,
  });

  await app.ready();
  return app;
}

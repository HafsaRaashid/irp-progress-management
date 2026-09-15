import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SignJWT, generateKeyPair } from "jose";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { createTracerProvider } from "../src/telemetry.js";
import { buildServer } from "../src/server.js";
import { signToken, getLocalKeySet, testIssuer, testAudience } from "./helpers/keys.js";
import { fakeUserRepo } from "./helpers/fake-user-repo.js";
import { unusedEntryRepo } from "./helpers/fake-entry-repo.js";
import { unusedAbsenceRepo } from "./helpers/fake-absence-repo.js";
import { unusedBatchRepo } from "./helpers/fake-batch-repo.js";
import { unusedMentorRecordRepo } from "./helpers/fake-mentor-record-repo.js";
import { unusedDayService } from "./helpers/fake-day-service.js";
import { unusedRosterService } from "./helpers/fake-roster-service.js";
import { unusedDashboardService } from "./helpers/fake-dashboard-service.js";
import { unusedPrisma } from "./helpers/fake-prisma.js";

// This suite exercises only the auth plugin's key-getter branching — it never
// reaches `userRepo.findByExternalId` on any of the 503/401 paths below, so it
// needs no database. The stub repo is structurally required by `buildServer`
// but is never consulted; a real Prisma client here would be dead weight
// that gates pure-auth coverage behind a running Postgres for no reason.
const userRepo = fakeUserRepo([]);

describe("when the JWKS endpoint is unreachable", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({
      config: {
        port: 3001, databaseUrl: "unused", jwksUri: "unused",
        jwtIssuer: testIssuer, jwtAudience: testAudience,
        version: "0.0.0", nodeEnv: "test",
        teamsWebhookUrl: undefined, smtp: undefined, webBaseUrl: "http://localhost:3100",
      },
      userRepo,
      entryRepo: unusedEntryRepo(),
      absenceRepo: unusedAbsenceRepo(),
      batchRepo: unusedBatchRepo(),
      mentorRecordRepo: unusedMentorRecordRepo(),
      dayService: unusedDayService(),
      rosterService: unusedRosterService(),
      dashboardService: unusedDashboardService(),
      // Stands in for createRemoteJWKSet against a dead endpoint.
      getKey: () => {
        throw new Error("ECONNREFUSED: the JWKS endpoint is unreachable");
      },
      tracerProvider: createTracerProvider(new InMemorySpanExporter()),
      prisma: unusedPrisma(),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 503, not 401 — the token is fine, our key source is down", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${await signToken()}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it("does not tell the user their token is invalid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${await signToken()}` },
    });
    const body = res.json<{ title: string; detail: string }>();
    expect(body.detail).not.toMatch(/invalid|expired/i);
    expect(body.title).toMatch(/unavailable/i);
  });

  it("still returns 401 for a genuinely malformed token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    // Malformed input fails before the key-getter is ever consulted.
    expect(res.statusCode).toBe(401);
  });
});

describe("when a token's kid matches no published key", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({
      config: {
        port: 3001, databaseUrl: "unused", jwksUri: "unused",
        jwtIssuer: testIssuer, jwtAudience: testAudience,
        version: "0.0.0", nodeEnv: "test",
        teamsWebhookUrl: undefined, smtp: undefined, webBaseUrl: "http://localhost:3100",
      },
      userRepo,
      entryRepo: unusedEntryRepo(),
      absenceRepo: unusedAbsenceRepo(),
      batchRepo: unusedBatchRepo(),
      mentorRecordRepo: unusedMentorRecordRepo(),
      dayService: unusedDayService(),
      rosterService: unusedRosterService(),
      dashboardService: unusedDashboardService(),
      // A REAL key-getter over a healthy, reachable key set — this is not a
      // simulated outage. It simply does not contain the kid the forged
      // token below claims, which is exactly what a live server sees when
      // presented a token signed with an unpublished or rotated-out key.
      getKey: await getLocalKeySet(),
      tracerProvider: createTracerProvider(new InMemorySpanExporter()),
      prisma: unusedPrisma(),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401, not 503 — the key source is healthy, the token is forged", async () => {
    // A self-signed key pair standing in for an attacker's: it signs a
    // structurally valid, correctly-issued token, but its public half was
    // never published to the server's key set, so the server cannot find a
    // key for `kid: "rotated-key-99"`.
    const forgedKeys = await generateKeyPair("RS256", { extractable: true });

    const token = await new SignJWT({ oid: "oid-1" })
      .setProtectedHeader({ alg: "RS256", kid: "rotated-key-99" })
      .setIssuedAt()
      .setIssuer(testIssuer)
      .setAudience(testAudience)
      .setExpirationTime("5m")
      .sign(forgedKeys.privateKey);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ title: string; detail: string }>();
    expect(body.detail).not.toMatch(/retry/i);
  });
});

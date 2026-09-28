import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { JWTVerifyGetKey } from "jose";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { createTracerProvider, tracingPlugin } from "../src/telemetry.js";
import { problemDetailsPlugin } from "../src/plugins/problem-details.js";
import { buildServer } from "../src/server.js";
import { buildAjv, createValidatorCompiler } from "../src/validation.js";
import { fakeUserRepo } from "./helpers/fake-user-repo.js";
import { unusedEntryRepo } from "./helpers/fake-entry-repo.js";
import { unusedAbsenceRepo } from "./helpers/fake-absence-repo.js";
import { unusedBatchRepo } from "./helpers/fake-batch-repo.js";
import { unusedMentorRecordRepo } from "./helpers/fake-mentor-record-repo.js";
import { unusedDayService } from "./helpers/fake-day-service.js";
import { unusedRosterService } from "./helpers/fake-roster-service.js";
import { unusedDashboardService } from "./helpers/fake-dashboard-service.js";
import { unusedNotificationService } from "./helpers/fake-notification-service.js";
import { unusedPrisma } from "./helpers/fake-prisma.js";
import { problemSchema } from "./helpers/problem-schema.js";
import { getLocalKeySet, signToken, testIssuer, testAudience } from "./helpers/keys.js";

interface ProblemLike {
  status: number;
  detail?: string;
}

let app: FastifyInstance;
beforeAll(async () => {
  const getKey: JWTVerifyGetKey = await getLocalKeySet();
  app = await buildServer({
    config: {
      port: 3001, databaseUrl: "unused", jwksUri: "unused",
      jwtIssuer: testIssuer, jwtAudience: testAudience, version: "0.0.0", nodeEnv: "test",
      teamsWebhookUrl: undefined, smtp: undefined, webBaseUrl: "http://localhost:3100",
    },
    userRepo: fakeUserRepo([{ id: "u1", externalId: "oid-1", email: "a@bistecglobal.com", displayName: "Amaya", role: "STUDENT" }]),
    entryRepo: unusedEntryRepo(),
    absenceRepo: unusedAbsenceRepo(),
    batchRepo: unusedBatchRepo(),
    mentorRecordRepo: unusedMentorRecordRepo(),
    dayService: unusedDayService(),
    rosterService: unusedRosterService(),
    dashboardService: unusedDashboardService(),
    notificationService: unusedNotificationService(),
    getKey,
    tracerProvider: createTracerProvider(new InMemorySpanExporter()),
    prisma: unusedPrisma(),
  });
});

describe("buildServer", () => {
  it("serves GET /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", version: "0.0.0" });
  });

  it("serves GET /api/v1/me for a valid token and maps the role to API casing", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/v1/me",
      headers: { authorization: `Bearer ${await signToken({ oid: "oid-1" })}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "u1", email: "a@bistecglobal.com", displayName: "Amaya", role: "Student" });
  });

  it("rejects GET /api/v1/me with no token (401)", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/me" })).statusCode).toBe(401);
  });
});

/**
 * Fail-closed guard for the spec's document-level `security: [bearerAuth]`.
 *
 * `spec/openapi.yaml` makes a bearer token the default and requires an explicit
 * `security: []` to opt out. The implementation inverts that: auth is attached
 * per route via `preHandler: [app.authenticate]`, so a Plan 6 route author who
 * forgets it ships a publicly readable endpoint while the spec and the
 * generated client both say it needs a token — and nothing else catches it.
 *
 * Routes are discovered from the composed server rather than listed here, so a
 * new unguarded `/api/` route fails this test the day it lands. Restructuring
 * composition onto a global `onRequest` hook is the better end state; Plan 3
 * revisits auth wholesale when it wires real Entra JWKS.
 */
interface RouteEntry { label: string; hooks: string[] }

function parseRoutes(tree: string): RouteEntry[] {
  const routes: RouteEntry[] = [];
  for (const raw of tree.split("\n")) {
    // Strip Fastify's radix-tree box drawing; `•` prefixes a hook line.
    const line = raw.replace(/^[─-╿\s]+/u, "").trim();
    const [, hookName] = /^•\s*\((\w+)\)/u.exec(line) ?? [];
    if (hookName !== undefined) {
      routes.at(-1)?.hooks.push(hookName);
      continue;
    }
    const [, path, method] = /^(\/\S*)\s+\((\w+)\)$/u.exec(line) ?? [];
    if (path !== undefined && method !== undefined) {
      routes.push({ label: `${method} ${path}`, hooks: [] });
    }
  }
  return routes;
}

describe("fail-closed auth on /api/", () => {
  it("attaches a preHandler to every route under /api/", () => {
    const routes = parseRoutes(app.printRoutes({ includeHooks: true, commonPrefix: false }));
    // Guards the parser itself: an empty list would make the assertion vacuous.
    expect(routes.length).toBeGreaterThan(0);
    const apiRoutes = routes.filter((r) => r.label.includes(" /api/"));
    expect(apiRoutes.length).toBeGreaterThan(0);
    for (const route of apiRoutes) {
      expect(route.hooks, `${route.label} is not behind app.authenticate`).toContain("preHandler");
    }
  });

  it("rejects an unauthenticated request to every /api/ GET route with 401", async () => {
    const apiGets = parseRoutes(app.printRoutes({ includeHooks: true, commonPrefix: false }))
      .filter((r) => r.label.startsWith("GET /api/"));
    expect(apiGets.length).toBeGreaterThan(0);
    for (const route of apiGets) {
      const url = route.label.slice("GET ".length);
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, `${url} answered an anonymous caller`).toBe(401);
    }
  });
});

/**
 * `test/validation.test.ts` proves `buildAjv()` in isolation. These prove the
 * compiler is actually *wired* and that it discriminates on `httpPart`.
 *
 * Two layers, because Fastify refuses `app.post(...)` once `buildServer` has
 * awaited `ready()` (`FST_ERR_INSTANCE_ALREADY_LISTENING`, set by avvio's
 * `start` event — not only by `listen`). So the composed server is probed
 * through the compiler it published on the instance, and the HTTP leg —
 * `err.validation` → 400 Problem, spec §9 — is probed on a throwaway app wired
 * exactly as `server.ts:31` wires it. Throwaway routes only: nothing new ships
 * in `src/`. Same pattern as `problem-details.test.ts`'s `/boom`.
 */
const validateProblem = buildAjv().compile(problemSchema);

const bodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: { type: "string" }, count: { type: "integer" } },
};
const querySchema = {
  type: "object",
  required: ["n"],
  properties: { n: { type: "integer" } },
};

describe("the composed server's validator compiler", () => {
  it("published a validator compiler (setValidatorCompiler ran)", () => {
    expect(app.validatorCompiler).toBeTypeOf("function");
  });

  it("enforces additionalProperties:false on the body httpPart", () => {
    const validate = app.validatorCompiler!({
      schema: bodySchema, method: "POST", url: "/_probe", httpPart: "body",
    });
    expect(validate({ name: "ok" })).toBe(true);
    expect(validate({ name: "ok", extra: "nope" })).toBe(false);
  });

  // Query/param/header values arrive as strings over the wire. A non-coercing
  // ajv on those httpParts fails every `type: integer` parameter the spec
  // declares — Plan 6's page numbers and cycle ids — with "must be integer".
  it("coerces on the querystring httpPart but not on the body httpPart", () => {
    const query = app.validatorCompiler!({
      schema: querySchema, method: "GET", url: "/_probe", httpPart: "querystring",
    });
    expect(query({ n: "5" })).toBe(true);

    const body = app.validatorCompiler!({
      schema: bodySchema, method: "POST", url: "/_probe", httpPart: "body",
    });
    expect(body({ name: "ok", count: "3" })).toBe(false);
  });
});

describe("validation through the HTTP pipeline (err.validation → 400 Problem)", () => {
  let probe: FastifyInstance;
  beforeAll(async () => {
    probe = Fastify();
    probe.setValidatorCompiler(createValidatorCompiler());
    await probe.register(tracingPlugin, {
      tracerProvider: createTracerProvider(new InMemorySpanExporter()),
    });
    await probe.register(problemDetailsPlugin);
    probe.post("/_probe-body", { schema: { body: bodySchema } }, () => ({ ok: true }));
    probe.get("/_probe-query", { schema: { querystring: querySchema } },
      (req) => ({ n: (req.query as { n: number }).n }));
    await probe.ready();
  });
  afterAll(async () => { await probe.close(); });

  it("rejects an extra body property with a 400 Problem body", async () => {
    const res = await probe.inject({
      method: "POST", url: "/_probe-body", payload: { name: "ok", extra: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json<ProblemLike>();
    expect(body.status).toBe(400);
    expect(body.detail).toContain("additional properties");
    expect(validateProblem(body)).toBe(true);
  });

  it("accepts a valid body", async () => {
    const res = await probe.inject({
      method: "POST", url: "/_probe-body", payload: { name: "ok", count: 3 },
    });
    expect(res.statusCode).toBe(200);
  });

  it("coerces a querystring integer rather than rejecting the wire string", async () => {
    const res = await probe.inject({ method: "GET", url: "/_probe-query?n=5" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ n: 5 });
  });

  it("still rejects a non-numeric querystring integer", async () => {
    const res = await probe.inject({ method: "GET", url: "/_probe-query?n=abc" });
    expect(res.statusCode).toBe(400);
    expect(validateProblem(res.json())).toBe(true);
  });

  // The other half: coercion must NOT leak into bodies, where JSON already
  // carries types and a string-for-integer is a real client bug.
  it("does not coerce in a request body — a string for an integer is still a 400", async () => {
    const res = await probe.inject({
      method: "POST", url: "/_probe-body", payload: { name: "ok", count: "3" },
    });
    expect(res.statusCode).toBe(400);
    expect(validateProblem(res.json())).toBe(true);
  });
});

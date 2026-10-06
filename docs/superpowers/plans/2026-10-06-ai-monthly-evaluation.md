# AI Monthly Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At a cycle's close, let a mentor generate an AI summary + fixed-rubric score for one
student's month (FR-22–27), with an override path (FR-24), replacing the Cycles page's permanent
"Awaiting evaluation" placeholder with a real action and a real result.

**Architecture:** A new `EvaluationService` assembles a cycle's `Entry`/`MentorDayRecord`/
`AbsenceRecord` rows, calls a hand-written Azure OpenAI client for a structured JSON response (five
0–100 criterion scores + a summary), computes `performanceIndex` from the fixed weights in this
codebase (never the AI), and persists `Evaluation` (lazily materialising `Cycle`, same principle as
`ADR-0019`). Three new endpoints; the Cycles page gains an "Evaluate" button and an override form;
the student dashboard's existing `strengthsAndWeaknesses` field starts carrying real text.

**Tech Stack:** Prisma 7, Fastify 5, OpenAPI 3.1 + generation, Vitest, Next.js 16 Server Actions,
hand-written `fetch` against Azure OpenAI's REST chat-completions endpoint (no SDK).

**Spec:** `docs/superpowers/specs/2026-10-06-ai-monthly-evaluation-design.md`

## Global Constraints

- **O-5 override, logged at every call site.** Mark `// ASSUMPTION: O-5` on the Azure OpenAI
  client's exports and on `EvaluationService`'s orchestrating function. This is not optional
  decoration — see the spec's §0.
- **Mentor-initiated, on-demand, per student per cycle** (spec D1/D2) — no scheduled job.
- **`temperature: 0`** on every AI call (NFR-15, spec D5).
- **Never persist a fabricated or out-of-range score.** One retry on a transient failure or
  invalid response, then a clean `502`/`503` (spec D6).
- **`performanceIndex` is always computed in this codebase**, from the fixed weights
  attendance 20% / taskCompletion 25% / contributionInitiative 25% / effortTime 10% /
  mentorEvaluation 20% — verified against the brief's own rubric table (§5), not the AI's output.
- **Request bodies `additionalProperties: false`; every OpenAPI schema/parameter needs an
  example/description** (`CLAUDE.md`'s API contract rules). Every endpoint: `200`/`400`/`401`/`500`
  at minimum, plus the specific 4xx codes each operation needs.
- **`spec/openapi.yaml` changes before any handler code** — regenerate `packages/types`/
  `packages/client` (`pnpm generate` then `pnpm --filter @irp/client build`) before writing routes
  or web code against them.
- **Local Postgres is on port 5433**; `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public`
  must be set before any direct `prisma` command.
- **`apps/web` changes need `pnpm --filter @irp/web build` (`AUTH_DEV_BYPASS=false`), not just
  `pnpm typecheck`**, per `CLAUDE.md`'s recorded `next build`-vs-`tsc` trap — re-run typecheck
  *after* the build too (the `.next/types` vs `.next/dev/types` staleness trap).
- **FR-25: the AI summary is never editable.** There is no update-summary endpoint anywhere in
  this plan — do not add one, even as a convenience.
- **FR-30: nothing in this slice exposes a score, rank, or another student's data to a Student.**
  `strengthsAndWeaknesses` (prose only) is the one field that reaches the student-facing API.

## Review Focus

- **A cycle that is still open (hasn't reached its `endDate`) gets an "Evaluate" request** —
  must `409`, not silently evaluate a partial month.
- **A student who transferred batches mid-cycle (FR-27)** — the enrolment doesn't span the whole
  cycle, so generation must `409`, not produce a score for a month the student wasn't fully part of.
- **The AI returns a criterion outside 0–100, or omits a field, or isn't valid JSON at all** — must
  retry once then `502`, never silently clamp, default to 0, or drop the malformed field.
- **A second "Evaluate" request for an already-evaluated cycle** — must `409` naming the existing
  evaluation, not create a duplicate `Evaluation` row (the schema's `@unique` on `Override.evaluationId`
  and the cycle+student grain both assume exactly one).
- **The Azure OpenAI config is partially set** (e.g. endpoint but no key) — must behave like the
  all-or-nothing SMTP config (`loadSmtpConfig`): treated as fully absent, not a half-working client
  that throws confusingly deep in a request.

---

### Task 1: Domain errors and config

**Files:**
- Modify: `apps/api/src/domain/errors.ts`
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/test/config.test.ts`

**Interfaces:**
- Produces: `CycleNotClosedError`, `EvaluationExistsError`, `EnrolmentDoesNotSpanCycleError`,
  `EvaluationNotFoundError`, `AiProviderUnavailableError`, `AiResponseInvalidError` (all
  `DomainError` subclasses); `AppConfig.azureOpenAi: AzureOpenAiConfig | undefined`;
  `AzureOpenAiConfig { endpoint: string; apiKey: string; deployment: string; apiVersion: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to apps/api/test/config.test.ts
describe("loadConfig — Azure OpenAI", () => {
  const base = {
    DATABASE_URL: "postgresql://x", JWKS_URI: "https://x", JWT_ISSUER: "https://x", JWT_AUDIENCE: "x",
  };

  it("leaves azureOpenAi undefined when unset", () => {
    expect(loadConfig(base).azureOpenAi).toBeUndefined();
  });

  it("is all-or-nothing: a partial config is treated as fully absent", () => {
    const config = loadConfig({
      ...base,
      AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
      // AZURE_OPENAI_API_KEY deliberately missing
      AZURE_OPENAI_DEPLOYMENT: "gpt-4o-mini",
    });
    expect(config.azureOpenAi).toBeUndefined();
  });

  it("loads all four fields when fully set", () => {
    const config = loadConfig({
      ...base,
      AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
      AZURE_OPENAI_API_KEY: "secret",
      AZURE_OPENAI_DEPLOYMENT: "gpt-4o-mini",
      AZURE_OPENAI_API_VERSION: "2024-10-21",
    });
    expect(config.azureOpenAi).toEqual({
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "gpt-4o-mini",
      apiVersion: "2024-10-21",
    });
  });

  it("defaults the API version when the other three are set", () => {
    const config = loadConfig({
      ...base,
      AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
      AZURE_OPENAI_API_KEY: "secret",
      AZURE_OPENAI_DEPLOYMENT: "gpt-4o-mini",
    });
    expect(config.azureOpenAi?.apiVersion).toBe("2024-10-21");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @irp/api test config -- --run`
Expected: FAIL — `azureOpenAi` does not exist on the returned config (TypeScript will also flag
this at the `toBeUndefined`/`toEqual` call sites once you add the typed property in step 3's
interface; run the test after step 3's interface exists but before its loader logic, or accept the
initial failure is "property does not exist").

- [ ] **Step 3: Implement**

In `apps/api/src/config.ts`:

```typescript
export interface AzureOpenAiConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}
```

Add `azureOpenAi: AzureOpenAiConfig | undefined;` to `AppConfig`. Add to the return object in
`loadConfig`: `azureOpenAi: loadAzureOpenAiConfig(env),`. Add the loader, mirroring
`loadSmtpConfig`'s all-or-nothing shape:

```typescript
/**
 * All-or-nothing, same principle as loadSmtpConfig: a partial config is
 * treated as fully absent rather than booting a half-working AI client.
 */
function loadAzureOpenAiConfig(env: Env): AzureOpenAiConfig | undefined {
  const { AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION } = env;
  if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_API_KEY || !AZURE_OPENAI_DEPLOYMENT) return undefined;
  return {
    endpoint: AZURE_OPENAI_ENDPOINT,
    apiKey: AZURE_OPENAI_API_KEY,
    deployment: AZURE_OPENAI_DEPLOYMENT,
    apiVersion: AZURE_OPENAI_API_VERSION ?? "2024-10-21",
  };
}
```

In `apps/api/src/domain/errors.ts`, add:

```typescript
export class CycleNotClosedError extends DomainError {
  readonly code = "cycle-not-closed";
  readonly status = 409;
  readonly title = "Cycle has not closed";
  constructor(endDate: string) {
    super(`This cycle does not close until ${endDate} — it cannot be evaluated yet (FR-22).`);
  }
}

export class EvaluationExistsError extends DomainError {
  readonly code = "evaluation-exists";
  readonly status = 409;
  readonly title = "Already evaluated";
  constructor(evaluationId: string) {
    super(`This cycle already has an evaluation (${evaluationId}) — generation runs once per cycle.`);
  }
}

export class EnrolmentDoesNotSpanCycleError extends DomainError {
  readonly code = "enrolment-does-not-span-cycle";
  readonly status = 409;
  readonly title = "Not enrolled for the whole cycle";
  constructor(studentId: string) {
    super(`Student ${studentId} was not enrolled in this batch for the whole cycle — not evaluated for it (FR-27).`);
  }
}

export class EvaluationNotFoundError extends DomainError {
  readonly code = "evaluation-not-found";
  readonly status = 404;
  readonly title = "Evaluation not found";
  constructor(id: string) {
    super(`No evaluation exists with id ${id}.`);
  }
}

// // ASSUMPTION: O-5 — these two map an Azure OpenAI call failure to a
// client-facing response; the provider itself is the O-5 override (see
// docs/superpowers/specs/2026-10-06-ai-monthly-evaluation-design.md §0).
export class AiProviderUnavailableError extends DomainError {
  readonly code = "ai-provider-unavailable";
  readonly status = 503;
  readonly title = "Evaluation service unavailable";
  constructor(detail: string) {
    super(detail);
  }
}

export class AiResponseInvalidError extends DomainError {
  readonly code = "ai-response-invalid";
  readonly status = 502;
  readonly title = "Evaluation provider returned an invalid response";
  constructor(detail: string) {
    super(detail);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @irp/api test config -- --run`
Expected: PASS, all 4 new cases plus the existing suite green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/domain/errors.ts apps/api/src/config.ts apps/api/test/config.test.ts
git commit -m "feat(api): add evaluation domain errors and Azure OpenAI config (FR-22-27)"
```

---

### Task 2: Evaluation repository

**Files:**
- Create: `apps/api/src/db/evaluation-repo.ts`
- Test: `apps/api/test/evaluation-repo.test.ts`

**Interfaces:**
- Consumes: the generated Prisma client (`Cycle`, `Evaluation`, `Override` models).
- Produces:

```typescript
export interface EvaluationScores {
  attendance: number;
  taskCompletion: number;
  contributionInitiative: number;
  effortTime: number;
  mentorEvaluation: number;
}

export interface EvaluationRecord extends EvaluationScores {
  id: string;
  cycleId: string;
  /**
   * Joined from Cycle, not a column on Evaluation itself — Cycle.seq is the
   * ADR-0019 1-based sequence. Included on every read so the override path
   * (service Task 4) never needs a SEPARATE Cycle lookup just to answer
   * "which cycle number was this": the PUT /evaluations/{id}/override route
   * (Task 6) has only the evaluation's id in its path, no cycle context.
   */
  cycleSeq: number;
  studentId: string;
  performanceIndex: string; // Decimal as string, same convention as Prisma's Decimal mapping elsewhere
  summary: string;
  modelVersion: string;
  createdAt: Date;
}

export interface OverrideRecord {
  id: string;
  evaluationId: string;
  mentorId: string;
  newScore: string;
  originalScore: string;
  reason: string;
  createdAt: Date;
}

export interface EvaluationRepo {
  /** Upserts the Cycle row (lazy materialisation, ADR-0019) and returns its id. */
  upsertCycle(batchId: string, seq: number, bounds: { start: string; end: string }): Promise<string>;
  findEvaluation(cycleId: string, studentId: string): Promise<EvaluationRecord | null>;
  /** By primary key — the override path (service Task 4) has only the evaluation's id, not its cycleId. */
  findEvaluationById(id: string): Promise<EvaluationRecord | null>;
  createEvaluation(input: EvaluationScores & {
    cycleId: string; studentId: string; performanceIndex: number; summary: string; modelVersion: string;
  }): Promise<EvaluationRecord>;
  findOverride(evaluationId: string): Promise<OverrideRecord | null>;
  createOverride(input: {
    evaluationId: string; mentorId: string; newScore: number; originalScore: number; reason: string;
  }): Promise<OverrideRecord>;
}
```

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/evaluation-repo.test.ts
import { describe, expect, it, beforeAll } from "vitest";
import { createPrismaClient } from "../src/db/client.js";
import { createEvaluationRepo } from "../src/db/evaluation-repo.js";
import { createBatchRepo } from "../src/db/batch-repo.js";
import { createUserRepo } from "../src/db/user-repo.js";

const prisma = createPrismaClient(process.env.DATABASE_URL!);
const repo = createEvaluationRepo(prisma);
const batchRepo = createBatchRepo(prisma);
const userRepo = createUserRepo(prisma);

describe("evaluation-repo", () => {
  it("upserts a Cycle row once, returning the same id on a second call", async () => {
    const batch = await batchRepo.create({ name: `Batch ${Date.now()}`, startDate: "2026-01-10", endDate: "2030-01-10" });
    const first = await repo.upsertCycle(batch.id, 1, { start: "2026-01-10", end: "2026-02-09" });
    const second = await repo.upsertCycle(batch.id, 1, { start: "2026-01-10", end: "2026-02-09" });
    expect(second).toBe(first);
  });

  it("creates and finds an evaluation, then an override", async () => {
    const batch = await batchRepo.create({ name: `Batch ${Date.now()}`, startDate: "2026-01-10", endDate: "2030-01-10" });
    const student = await userRepo.create({
      externalId: `s-${Date.now()}`, email: `s-${Date.now()}@dev.local`, displayName: "Test Student", role: "STUDENT",
    });
    const cycleId = await repo.upsertCycle(batch.id, 1, { start: "2026-01-10", end: "2026-02-09" });

    expect(await repo.findEvaluation(cycleId, student.id)).toBeNull();

    const evaluation = await repo.createEvaluation({
      cycleId, studentId: student.id,
      attendance: 80, taskCompletion: 90, contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85,
      performanceIndex: 79.5, summary: "Solid month.", modelVersion: "gpt-4o-mini-2024-10",
    });
    expect(await repo.findEvaluation(cycleId, student.id)).toMatchObject({ id: evaluation.id });
    expect(await repo.findEvaluationById(evaluation.id)).toMatchObject({ id: evaluation.id });
    expect(await repo.findEvaluationById("00000000-0000-0000-0000-000000000000")).toBeNull();

    expect(await repo.findOverride(evaluation.id)).toBeNull();
    const override = await repo.createOverride({
      evaluationId: evaluation.id, mentorId: student.id, newScore: 85, originalScore: 79.5, reason: "Strong finish.",
    });
    expect(await repo.findOverride(evaluation.id)).toMatchObject({ id: override.id });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public pnpm --filter @irp/api test evaluation-repo -- --run`
Expected: FAIL — `../src/db/evaluation-repo.js` does not exist.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/db/evaluation-repo.ts
import type { PrismaClient } from "../generated/prisma/client.js";
import { toDbDate } from "./civil-date-map.js";
import type { CivilDate } from "@irp/core";

export interface EvaluationScores {
  attendance: number;
  taskCompletion: number;
  contributionInitiative: number;
  effortTime: number;
  mentorEvaluation: number;
}

export interface EvaluationRecord extends EvaluationScores {
  id: string;
  cycleId: string;
  studentId: string;
  performanceIndex: string;
  summary: string;
  modelVersion: string;
  createdAt: Date;
}

export interface OverrideRecord {
  id: string;
  evaluationId: string;
  mentorId: string;
  newScore: string;
  originalScore: string;
  reason: string;
  createdAt: Date;
}

export interface EvaluationRepo {
  upsertCycle(batchId: string, seq: number, bounds: { start: CivilDate; end: CivilDate }): Promise<string>;
  findEvaluation(cycleId: string, studentId: string): Promise<EvaluationRecord | null>;
  findEvaluationById(id: string): Promise<EvaluationRecord | null>;
  createEvaluation(input: EvaluationScores & {
    cycleId: string; studentId: string; performanceIndex: number; summary: string; modelVersion: string;
  }): Promise<EvaluationRecord>;
  findOverride(evaluationId: string): Promise<OverrideRecord | null>;
  createOverride(input: {
    evaluationId: string; mentorId: string; newScore: number; originalScore: number; reason: string;
  }): Promise<OverrideRecord>;
}

function mapEvaluation(e: {
  id: string; cycleId: string; studentId: string; attendance: number; taskCompletion: number;
  contributionInitiative: number; effortTime: number; mentorEvaluation: number;
  performanceIndex: { toString(): string }; summary: string; modelVersion: string; createdAt: Date;
  cycle: { seq: number };
}): EvaluationRecord {
  const { cycle, ...rest } = e;
  return { ...rest, cycleSeq: cycle.seq, performanceIndex: e.performanceIndex.toString() };
}

/** Every read includes the parent Cycle's seq (see EvaluationRecord.cycleSeq's own comment). */
const WITH_CYCLE_SEQ = { include: { cycle: { select: { seq: true } } } } as const;

function mapOverride(o: {
  id: string; evaluationId: string; mentorId: string;
  newScore: { toString(): string }; originalScore: { toString(): string }; reason: string; createdAt: Date;
}): OverrideRecord {
  return { ...o, newScore: o.newScore.toString(), originalScore: o.originalScore.toString() };
}

export function createEvaluationRepo(prisma: PrismaClient): EvaluationRepo {
  return {
    async upsertCycle(batchId, seq, bounds) {
      const cycle = await prisma.cycle.upsert({
        where: { batchId_seq: { batchId, seq } },
        create: { batchId, seq, startDate: toDbDate(bounds.start), endDate: toDbDate(bounds.end) },
        update: {},
      });
      return cycle.id;
    },
    async findEvaluation(cycleId, studentId) {
      const e = await prisma.evaluation.findFirst({ where: { cycleId, studentId }, ...WITH_CYCLE_SEQ });
      return e === null ? null : mapEvaluation(e);
    },
    async findEvaluationById(id) {
      const e = await prisma.evaluation.findUnique({ where: { id }, ...WITH_CYCLE_SEQ });
      return e === null ? null : mapEvaluation(e);
    },
    async createEvaluation(input) {
      const e = await prisma.evaluation.create({ data: input, ...WITH_CYCLE_SEQ });
      return mapEvaluation(e);
    },
    async findOverride(evaluationId) {
      const o = await prisma.override.findUnique({ where: { evaluationId } });
      return o === null ? null : mapOverride(o);
    },
    async createOverride(input) {
      const o = await prisma.override.create({ data: input });
      return mapOverride(o);
    },
  };
}
```

Check `apps/api/src/db/civil-date-map.ts` for the exact `toDbDate`/`fromDbDate` export names before
writing the import — this plan assumes the same names `batch-repo.ts` already imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public pnpm --filter @irp/api test evaluation-repo -- --run`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/evaluation-repo.ts apps/api/test/evaluation-repo.test.ts
git commit -m "feat(api): add EvaluationRepo (FR-22-24)"
```

---

### Task 3: Azure OpenAI client

**Files:**
- Create: `apps/api/src/services/evaluation-ai-client.ts`
- Test: `apps/api/test/evaluation-ai-client.test.ts`

**Interfaces:**
- Consumes: `AzureOpenAiConfig` (Task 1), `AiProviderUnavailableError`/`AiResponseInvalidError` (Task 1).
- Produces:

```typescript
export interface EvaluationPrompt {
  studentName: string;
  cycleStart: string;
  cycleEnd: string;
  entries: { date: string; body: string; isLate: boolean; isExtra: boolean }[];
  mentorRecords: { date: string; attended: boolean; tasksCompleted: boolean; note: string | null }[];
  absences: { date: string; reason: string }[];
}

export interface EvaluationAiResult {
  attendance: number;
  taskCompletion: number;
  contributionInitiative: number;
  effortTime: number;
  mentorEvaluation: number;
  summary: string;
}

export interface EvaluationAiClient {
  evaluate(prompt: EvaluationPrompt): Promise<{ result: EvaluationAiResult; modelVersion: string }>;
}

export function createAzureOpenAiEvaluator(
  config: AzureOpenAiConfig | undefined,
  fetchImpl: typeof fetch,
): EvaluationAiClient;
```

`fetchImpl` is an injected dependency (not the global `fetch`) specifically so tests never make a
real network call — the same principle `build-test-server.ts` already applies to JWKS.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/evaluation-ai-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { createAzureOpenAiEvaluator } from "../src/services/evaluation-ai-client.js";
import { AiProviderUnavailableError, AiResponseInvalidError } from "../src/domain/errors.js";

const CONFIG = {
  endpoint: "https://example.openai.azure.com",
  apiKey: "secret",
  deployment: "gpt-4o-mini",
  apiVersion: "2024-10-21",
};

const PROMPT = {
  studentName: "Test Student", cycleStart: "2026-01-10", cycleEnd: "2026-02-09",
  entries: [], mentorRecords: [], absences: [],
};

function fakeFetchReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

const VALID_COMPLETION = {
  choices: [{ message: { content: JSON.stringify({
    attendance: 80, taskCompletion: 90, contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85,
    summary: "Solid month.",
  }) } }],
  model: "gpt-4o-mini-2024-10-21",
};

describe("createAzureOpenAiEvaluator", () => {
  it("throws AiProviderUnavailableError when config is undefined", async () => {
    const client = createAzureOpenAiEvaluator(undefined, fakeFetchReturning({}));
    await expect(client.evaluate(PROMPT)).rejects.toBeInstanceOf(AiProviderUnavailableError);
  });

  it("calls the configured endpoint/deployment/api-version and parses a valid response", async () => {
    const fetchImpl = fakeFetchReturning(VALID_COMPLETION);
    const client = createAzureOpenAiEvaluator(CONFIG, fetchImpl);

    const { result, modelVersion } = await client.evaluate(PROMPT);

    expect(result).toEqual({
      attendance: 80, taskCompletion: 90, contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85,
      summary: "Solid month.",
    });
    expect(modelVersion).toBe("gpt-4o-mini-2024-10-21");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://example.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21",
    );
    expect(init.headers).toMatchObject({ "api-key": "secret" });
    const sentBody = JSON.parse(init.body as string) as { temperature: number };
    expect(sentBody.temperature).toBe(0);
  });

  it("retries once on a 500, then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(VALID_COMPLETION) });
    const client = createAzureOpenAiEvaluator(CONFIG, fetchImpl as unknown as typeof fetch);

    const { result } = await client.evaluate(PROMPT);
    expect(result.summary).toBe("Solid month.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws AiResponseInvalidError after two failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    const client = createAzureOpenAiEvaluator(CONFIG, fetchImpl as unknown as typeof fetch);

    await expect(client.evaluate(PROMPT)).rejects.toBeInstanceOf(AiResponseInvalidError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws AiResponseInvalidError when a criterion is out of range, without retrying a well-formed-but-wrong response twice unnecessarily", async () => {
    const outOfRange = {
      choices: [{ message: { content: JSON.stringify({
        attendance: 150, taskCompletion: 90, contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85,
        summary: "Solid month.",
      }) } }],
      model: "gpt-4o-mini-2024-10-21",
    };
    const fetchImpl = fakeFetchReturning(outOfRange);
    const client = createAzureOpenAiEvaluator(CONFIG, fetchImpl);

    await expect(client.evaluate(PROMPT)).rejects.toBeInstanceOf(AiResponseInvalidError);
  });

  it("throws AiResponseInvalidError on malformed JSON content", async () => {
    const malformed = { choices: [{ message: { content: "not json" } }], model: "gpt-4o-mini-2024-10-21" };
    const fetchImpl = fakeFetchReturning(malformed);
    const client = createAzureOpenAiEvaluator(CONFIG, fetchImpl);

    await expect(client.evaluate(PROMPT)).rejects.toBeInstanceOf(AiResponseInvalidError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @irp/api test evaluation-ai-client -- --run`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/services/evaluation-ai-client.ts
import type { AzureOpenAiConfig } from "../config.js";
import { AiProviderUnavailableError, AiResponseInvalidError } from "../domain/errors.js";

export interface EvaluationPrompt {
  studentName: string;
  cycleStart: string;
  cycleEnd: string;
  entries: { date: string; body: string; isLate: boolean; isExtra: boolean }[];
  mentorRecords: { date: string; attended: boolean; tasksCompleted: boolean; note: string | null }[];
  absences: { date: string; reason: string }[];
}

export interface EvaluationAiResult {
  attendance: number;
  taskCompletion: number;
  contributionInitiative: number;
  effortTime: number;
  mentorEvaluation: number;
  summary: string;
}

export interface EvaluationAiClient {
  evaluate(prompt: EvaluationPrompt): Promise<{ result: EvaluationAiResult; modelVersion: string }>;
}

const CRITERIA = ["attendance", "taskCompletion", "contributionInitiative", "effortTime", "mentorEvaluation"] as const;

const RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "evaluation_result",
    schema: {
      type: "object",
      additionalProperties: false,
      required: [...CRITERIA, "summary"],
      properties: {
        attendance: { type: "integer", minimum: 0, maximum: 100 },
        taskCompletion: { type: "integer", minimum: 0, maximum: 100 },
        contributionInitiative: { type: "integer", minimum: 0, maximum: 100 },
        effortTime: { type: "integer", minimum: 0, maximum: 100 },
        mentorEvaluation: { type: "integer", minimum: 0, maximum: 100 },
        summary: { type: "string" },
      },
    },
  },
} as const;

/**
 * // ASSUMPTION: O-5 — Azure OpenAI is the chosen provider (spec §0/D3), kept
 * inside this repo's own Azure tenant rather than a separate third-party one.
 */
function systemPrompt(): string {
  return [
    "You are evaluating one IRP student's month for the Bistec Hearts Academy Industry Readiness Programme.",
    "Score five criteria, each 0-100: attendance (meetings/sessions attended, from the mentor's records);",
    "taskCompletion (work submitted and confirmed done, from both sides); contributionInitiative (value added,",
    "from both sides); effortTime (consistent daily effort, from the student's own entries);",
    "mentorEvaluation (the mentor's overall judgement, weighted most heavily on the mentor's own notes).",
    "Weekend ('extra') entries are positive context only -- never penalise a week for lacking them.",
    "An absence is excused and carries no penalty by itself.",
    "Write `summary` as the exact text that will appear in the student's report, unedited: second person,",
    "factual, based only on the supplied data, with no invented specifics.",
  ].join(" ");
}

function userPrompt(prompt: EvaluationPrompt): string {
  return JSON.stringify(prompt);
}

function buildUrl(config: AzureOpenAiConfig): string {
  return `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;
}

function parseAndValidate(raw: unknown): EvaluationAiResult {
  let parsed: unknown;
  try {
    const content = (raw as { choices: { message: { content: string } }[] }).choices[0]?.message.content;
    if (content === undefined) throw new Error("no choices[0].message.content");
    parsed = JSON.parse(content);
  } catch (err) {
    throw new AiResponseInvalidError(`Could not parse the AI response as JSON: ${String(err)}`);
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of CRITERIA) {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
      throw new AiResponseInvalidError(`"${key}" must be an integer 0-100, got: ${JSON.stringify(value)}`);
    }
  }
  if (typeof obj.summary !== "string" || obj.summary.trim().length === 0) {
    throw new AiResponseInvalidError("\"summary\" must be a non-empty string.");
  }
  return {
    attendance: obj.attendance as number,
    taskCompletion: obj.taskCompletion as number,
    contributionInitiative: obj.contributionInitiative as number,
    effortTime: obj.effortTime as number,
    mentorEvaluation: obj.mentorEvaluation as number,
    summary: obj.summary as string,
  };
}

export function createAzureOpenAiEvaluator(
  config: AzureOpenAiConfig | undefined,
  fetchImpl: typeof fetch,
): EvaluationAiClient {
  return {
    async evaluate(prompt) {
      if (config === undefined) {
        throw new AiProviderUnavailableError(
          "No AI provider is configured (AZURE_OPENAI_ENDPOINT/API_KEY/DEPLOYMENT). " +
          "// ASSUMPTION: O-5 -- see docs/superpowers/specs/2026-10-06-ai-monthly-evaluation-design.md §0.",
        );
      }

      const body = JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt() },
          { role: "user", content: userPrompt(prompt) },
        ],
        temperature: 0,
        response_format: RESPONSE_SCHEMA,
      });

      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetchImpl(buildUrl(config), {
            method: "POST",
            headers: { "content-type": "application/json", "api-key": config.apiKey },
            body,
          });
          if (!res.ok) {
            lastError = new AiResponseInvalidError(`Azure OpenAI responded ${String(res.status)}`);
            continue;
          }
          const json: unknown = await res.json();
          const result = parseAndValidate(json);
          const modelVersion = (json as { model?: string }).model ?? config.deployment;
          return { result, modelVersion };
        } catch (err) {
          lastError = err instanceof Error ? err : new AiResponseInvalidError(String(err));
        }
      }
      throw lastError instanceof Error ? lastError : new AiResponseInvalidError("Unknown AI client failure.");
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @irp/api test evaluation-ai-client -- --run`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/evaluation-ai-client.ts apps/api/test/evaluation-ai-client.test.ts
git commit -m "feat(api): add hand-written Azure OpenAI evaluation client (FR-22/23, NFR-15, O-5)"
```

---

### Task 4: Evaluation service

**Files:**
- Create: `apps/api/src/services/evaluation-service.ts`
- Test: `apps/api/test/evaluation-service.test.ts`

**Interfaces:**
- Consumes: `EvaluationRepo` (Task 2), `EvaluationAiClient` (Task 3), `BatchRepo`, `EntryRepo`,
  `MentorRecordRepo`, `AbsenceRepo` (all existing), `CycleNotClosedError`/`EvaluationExistsError`/
  `EnrolmentDoesNotSpanCycleError`/`BatchNotFoundError`/`StudentNotFoundError` (Task 1 + existing).
- Produces:

```typescript
export interface EvaluationView {
  id: string;
  studentId: string;
  cycleSeq: number;
  attendance: number;
  taskCompletion: number;
  contributionInitiative: number;
  effortTime: number;
  mentorEvaluation: number;
  performanceIndex: number;
  summary: string;
  modelVersion: string;
  override: { newScore: number; originalScore: number; reason: string } | null;
}

export interface EvaluationService {
  generateForCycle(batchId: string, studentId: string, seq: number, now: Date): Promise<EvaluationView>;
  getEvaluation(batchId: string, studentId: string, seq: number): Promise<EvaluationView | null>;
  override(evaluationId: string, mentorId: string, newScore: number, reason: string): Promise<EvaluationView>;
}
```

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/evaluation-service.test.ts
import { describe, expect, it, vi } from "vitest";
import { civilDate } from "@irp/core";
import { createEvaluationService } from "../src/services/evaluation-service.js";
import {
  CycleNotClosedError, EvaluationExistsError, EnrolmentDoesNotSpanCycleError, BatchNotFoundError,
  EvaluationNotFoundError,
} from "../src/domain/errors.js";

const BATCH = { id: "b1", name: "Batch 1", startDate: civilDate("2026-01-10"), endDate: civilDate("2030-01-10") };

function deps(overrides: Record<string, unknown> = {}) {
  return {
    batchRepo: {
      getBatch: vi.fn().mockResolvedValue(BATCH),
      listEnrolments: vi.fn().mockResolvedValue([
        { id: "e1", studentId: "s1", batchId: "b1", startDate: civilDate("2026-01-10"), endDate: null },
      ]),
      ...((overrides.batchRepo as object) ?? {}),
    },
    entryRepo: { listEntries: vi.fn().mockResolvedValue([]) },
    mentorRecordRepo: { listForStudent: vi.fn().mockResolvedValue([]) },
    absenceRepo: { listForStudent: vi.fn().mockResolvedValue([]) },
    evaluationRepo: {
      upsertCycle: vi.fn().mockResolvedValue("cycle-1"),
      findEvaluation: vi.fn().mockResolvedValue(null),
      createEvaluation: vi.fn().mockImplementation((input: Record<string, unknown>) =>
        Promise.resolve({ id: "eval-1", cycleSeq: 1, ...input, performanceIndex: String(input.performanceIndex) })),
      findOverride: vi.fn().mockResolvedValue(null),
      createOverride: vi.fn(),
      ...((overrides.evaluationRepo as object) ?? {}),
    },
    aiClient: {
      evaluate: vi.fn().mockResolvedValue({
        result: {
          attendance: 80, taskCompletion: 90, contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85,
          summary: "Solid month.",
        },
        modelVersion: "gpt-4o-mini-2024-10-21",
      }),
    },
    userRepo: { findById: vi.fn().mockResolvedValue({ id: "s1", displayName: "Test Student" }) },
  };
}

describe("EvaluationService.generateForCycle", () => {
  it("computes performanceIndex from the fixed weights (20/25/25/10/20)", async () => {
    const service = createEvaluationService(deps());
    // Cycle 1 of a batch starting 2026-01-10 closes 2026-02-09; "now" after that.
    const view = await service.generateForCycle("b1", "s1", 1, new Date("2026-02-15T00:00:00Z"));
    // 80*.20 + 90*.25 + 70*.25 + 60*.10 + 85*.20 = 16 + 22.5 + 17.5 + 6 + 17 = 79
    expect(view.performanceIndex).toBeCloseTo(79, 5);
  });

  it("409s when the cycle has not closed yet", async () => {
    const service = createEvaluationService(deps());
    await expect(
      service.generateForCycle("b1", "s1", 1, new Date("2026-01-20T00:00:00Z")),
    ).rejects.toBeInstanceOf(CycleNotClosedError);
  });

  it("409s when an evaluation already exists for this cycle+student", async () => {
    const d = deps({
      evaluationRepo: { findEvaluation: vi.fn().mockResolvedValue({ id: "existing-eval" }) },
    });
    const service = createEvaluationService(d);
    await expect(
      service.generateForCycle("b1", "s1", 1, new Date("2026-02-15T00:00:00Z")),
    ).rejects.toBeInstanceOf(EvaluationExistsError);
  });

  it("409s when the student's enrolment does not span the whole cycle (FR-27)", async () => {
    const d = deps({
      batchRepo: {
        listEnrolments: vi.fn().mockResolvedValue([
          // Joined mid-cycle -- does not cover the cycle's start.
          { id: "e1", studentId: "s1", batchId: "b1", startDate: civilDate("2026-01-20"), endDate: null },
        ]),
      },
    });
    const service = createEvaluationService(d);
    await expect(
      service.generateForCycle("b1", "s1", 1, new Date("2026-02-15T00:00:00Z")),
    ).rejects.toBeInstanceOf(EnrolmentDoesNotSpanCycleError);
  });

  it("404s via BatchNotFoundError when the batch doesn't exist", async () => {
    const d = deps({ batchRepo: { getBatch: vi.fn().mockResolvedValue(null) } });
    const service = createEvaluationService(d);
    await expect(
      service.generateForCycle("no-such-batch", "s1", 1, new Date("2026-02-15T00:00:00Z")),
    ).rejects.toBeInstanceOf(BatchNotFoundError);
  });
});

describe("EvaluationService.override", () => {
  it("stores the new score, the original AI score, and the reason (FR-24)", async () => {
    const d = deps({
      evaluationRepo: {
        findEvaluationById: vi.fn().mockResolvedValue({
          id: "eval-1", cycleId: "cycle-1", cycleSeq: 1, studentId: "s1",
          attendance: 80, taskCompletion: 90, contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85,
          performanceIndex: "79", summary: "Solid month.", modelVersion: "gpt-4o-mini-2024-10-21", createdAt: new Date(),
        }),
        // override() calls createOverride then toView(evaluation) — cycleSeq
        // comes from the evaluation record itself (its joined Cycle.seq),
        // not a parameter. toView reads the override back via findOverride
        // exactly once — it does not take createOverride's own return value
        // as the source of truth, so this mock is what the assertion below
        // actually reads.
        findOverride: vi.fn().mockResolvedValue({
          id: "ov1", evaluationId: "eval-1", mentorId: "m1", newScore: "85", originalScore: "79", reason: "Strong finish.",
        }),
        createOverride: vi.fn().mockResolvedValue({
          id: "ov1", evaluationId: "eval-1", mentorId: "m1", newScore: "85", originalScore: "79", reason: "Strong finish.",
        }),
      },
    });
    const service = createEvaluationService(d);
    const result = await service.override("eval-1", "m1", 85, "Strong finish.");
    expect(result.cycleSeq).toBe(1);
    expect(result.studentId).toBe("s1");
    expect(result.override).toEqual({ newScore: 85, originalScore: 79, reason: "Strong finish." });
  });

  it("404s via EvaluationNotFoundError when the evaluation id does not exist", async () => {
    const d = deps({ evaluationRepo: { findEvaluationById: vi.fn().mockResolvedValue(null) } });
    const service = createEvaluationService(d);
    await expect(service.override("no-such-eval", "m1", 85, "x")).rejects.toBeInstanceOf(EvaluationNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @irp/api test evaluation-service -- --run`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/services/evaluation-service.ts
import { cycleContaining, cycleFor, compareDates, firstEvaluatedCycleStart, shiftCycle, toProgrammeDate, type CycleBounds } from "@irp/core";
import type { BatchRepo } from "../db/batch-repo.js";
import type { EntryRepo } from "../db/entry-repo.js";
import type { MentorRecordRepo } from "../db/mentor-record-repo.js";
import type { AbsenceRepo } from "../db/absence-repo.js";
import type { EvaluationRepo } from "../db/evaluation-repo.js";
import type { UserRepo } from "../db/user-repo.js";
import type { EvaluationAiClient } from "./evaluation-ai-client.js";
import {
  BatchNotFoundError, CycleNotClosedError, EvaluationExistsError, EnrolmentDoesNotSpanCycleError,
  EvaluationNotFoundError, StudentNotFoundError,
} from "../domain/errors.js";

export interface EvaluationView {
  id: string;
  studentId: string;
  cycleSeq: number;
  attendance: number;
  taskCompletion: number;
  contributionInitiative: number;
  effortTime: number;
  mentorEvaluation: number;
  performanceIndex: number;
  summary: string;
  modelVersion: string;
  override: { newScore: number; originalScore: number; reason: string } | null;
}

export interface EvaluationServiceDeps {
  batchRepo: Pick<BatchRepo, "getBatch" | "listEnrolments">;
  entryRepo: Pick<EntryRepo, "listEntries">;
  mentorRecordRepo: Pick<MentorRecordRepo, "listForStudent">;
  absenceRepo: Pick<AbsenceRepo, "listForStudent">;
  evaluationRepo: EvaluationRepo;
  aiClient: EvaluationAiClient;
  userRepo: Pick<UserRepo, "findById">;
}

export interface EvaluationService {
  generateForCycle(batchId: string, studentId: string, seq: number, now: Date): Promise<EvaluationView>;
  getEvaluation(batchId: string, studentId: string, seq: number): Promise<EvaluationView | null>;
  override(evaluationId: string, mentorId: string, newScore: number, reason: string): Promise<EvaluationView>;
}

// Brief §5: Attendance 20, Task completion 25, Contribution & initiative 25, Effort/time 10, Mentor evaluation 20.
function weightedIndex(s: {
  attendance: number; taskCompletion: number; contributionInitiative: number; effortTime: number; mentorEvaluation: number;
}): number {
  return s.attendance * 0.20 + s.taskCompletion * 0.25 + s.contributionInitiative * 0.25
    + s.effortTime * 0.10 + s.mentorEvaluation * 0.20;
}

function resolveBounds(batchStartDate: CycleBounds["start"], seq: number): CycleBounds {
  const first = firstEvaluatedCycleStart(batchStartDate);
  return cycleContaining(shiftCycle(first, seq - 1));
}

export function createEvaluationService(deps: EvaluationServiceDeps): EvaluationService {
  async function toView(
    evalRow: { id: string; studentId: string; cycleSeq: number } & Record<string, unknown>,
  ): Promise<EvaluationView> {
    const override = await deps.evaluationRepo.findOverride(evalRow.id);
    return {
      id: evalRow.id,
      studentId: evalRow.studentId,
      cycleSeq: evalRow.cycleSeq,
      attendance: evalRow.attendance as number,
      taskCompletion: evalRow.taskCompletion as number,
      contributionInitiative: evalRow.contributionInitiative as number,
      effortTime: evalRow.effortTime as number,
      mentorEvaluation: evalRow.mentorEvaluation as number,
      performanceIndex: Number(evalRow.performanceIndex),
      summary: evalRow.summary as string,
      modelVersion: evalRow.modelVersion as string,
      override: override === null ? null : {
        newScore: Number(override.newScore), originalScore: Number(override.originalScore), reason: override.reason,
      },
    };
  }

  return {
    async generateForCycle(batchId, studentId, seq, now) {
      const batch = await deps.batchRepo.getBatch(batchId);
      if (batch === null) throw new BatchNotFoundError(batchId);

      const bounds = resolveBounds(batch.startDate, seq);
      if (compareDates(bounds.end, toProgrammeDate(now)) >= 0) {
        throw new CycleNotClosedError(bounds.end);
      }

      const enrolments = await deps.batchRepo.listEnrolments(studentId);
      const spansWholeCycle = enrolments.some(
        (e) => e.batchId === batchId
          && compareDates(e.startDate, bounds.start) <= 0
          && (e.endDate === null || compareDates(e.endDate, bounds.end) >= 0),
      );
      if (!spansWholeCycle) throw new EnrolmentDoesNotSpanCycleError(studentId);

      const cycleId = await deps.evaluationRepo.upsertCycle(batchId, seq, bounds);
      const existing = await deps.evaluationRepo.findEvaluation(cycleId, studentId);
      if (existing !== null) throw new EvaluationExistsError(existing.id);

      const student = await deps.userRepo.findById(studentId);
      if (student === null) throw new StudentNotFoundError(studentId);

      const [entries, mentorRecords, absences] = await Promise.all([
        deps.entryRepo.listEntries(studentId, bounds.start, bounds.end),
        deps.mentorRecordRepo.listForStudent(studentId, bounds.start, bounds.end),
        deps.absenceRepo.listForStudent(studentId, bounds.start, bounds.end),
      ]);

      const { result, modelVersion } = await deps.aiClient.evaluate({
        studentName: student.displayName,
        cycleStart: bounds.start,
        cycleEnd: bounds.end,
        entries: entries.map((e) => ({ date: e.entryDate, body: e.body, isLate: e.isLate, isExtra: e.isExtra })),
        mentorRecords: mentorRecords.map((r) => ({
          date: r.date, attended: r.attended, tasksCompleted: r.tasksCompleted, note: r.note,
        })),
        absences: absences.map((a) => ({ date: a.date, reason: a.reason })),
      });

      const performanceIndex = weightedIndex(result);
      const created = await deps.evaluationRepo.createEvaluation({
        cycleId, studentId, ...result, performanceIndex, modelVersion,
      });
      return toView(created);
    },

    async getEvaluation(batchId, studentId, seq) {
      const batch = await deps.batchRepo.getBatch(batchId);
      if (batch === null) throw new BatchNotFoundError(batchId);
      const bounds = resolveBounds(batch.startDate, seq);
      const cycleId = await deps.evaluationRepo.upsertCycle(batchId, seq, bounds);
      const existing = await deps.evaluationRepo.findEvaluation(cycleId, studentId);
      return existing === null ? null : toView(existing);
    },

    async override(evaluationId, mentorId, newScore, reason) {
      const evaluation = await deps.evaluationRepo.findEvaluationById(evaluationId);
      if (evaluation === null) throw new EvaluationNotFoundError(evaluationId);
      await deps.evaluationRepo.createOverride({
        evaluationId, mentorId, newScore, originalScore: Number(evaluation.performanceIndex), reason,
      });
      return toView(evaluation);
    },
  };
}
```

Add `EvaluationNotFoundError` to this file's import from `../domain/errors.js` (Task 1 added it
there).

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public pnpm --filter @irp/api test evaluation-service -- --run`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/evaluation-service.ts apps/api/src/db/evaluation-repo.ts apps/api/test/evaluation-service.test.ts
git commit -m "feat(api): add EvaluationService — generation, retrieval, override (FR-22-27)"
```

---

### Task 5: OpenAPI spec additions

**Files:**
- Modify: `spec/openapi.yaml`

**Interfaces:**
- Produces: the three operations and schemas consumed by Task 6 (routes) and Task 7 (web).

- [ ] **Step 1: Add the `Evaluation` and `EvaluationOverrideRequest` schemas**

Add to `spec/openapi.yaml`'s `components/schemas` (alongside `CycleCounts`/`ReviewProgress`):

```yaml
    Evaluation:
      type: object
      title: Evaluation
      description: |
        One student's AI-generated monthly evaluation (FR-22/23). The score of
        record is `performanceIndex` unless `override` is present, in which
        case `override.newScore` is the score of record (FR-24).
      required: [
        id, studentId, cycleSeq, attendance, taskCompletion, contributionInitiative,
        effortTime, mentorEvaluation, performanceIndex, summary, modelVersion, override,
      ]
      additionalProperties: false
      properties:
        id:
          type: string
          format: uuid
          examples: ['5a3c2b1d-0e9f-4a8b-b7c6-d5e4f3a2b1c0']
        studentId:
          type: string
          format: uuid
          examples: ['3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8']
        cycleSeq:
          type: integer
          minimum: 1
          description: The 1-based cycle sequence this evaluation covers (ADR-0019).
          examples: [3]
        attendance:
          type: integer
          minimum: 0
          maximum: 100
          description: Weight 20% (brief §5).
          examples: [80]
        taskCompletion:
          type: integer
          minimum: 0
          maximum: 100
          description: Weight 25% (brief §5).
          examples: [90]
        contributionInitiative:
          type: integer
          minimum: 0
          maximum: 100
          description: Weight 25% (brief §5).
          examples: [70]
        effortTime:
          type: integer
          minimum: 0
          maximum: 100
          description: Weight 10% (brief §5).
          examples: [60]
        mentorEvaluation:
          type: integer
          minimum: 0
          maximum: 100
          description: Weight 20% (brief §5).
          examples: [85]
        performanceIndex:
          type: number
          minimum: 0
          maximum: 100
          description: The AI-computed weighted score (FR-23) — always computed by the API, never taken verbatim from the AI.
          examples: [79]
        summary:
          type: string
          description: The AI-generated prose summary (FR-22). Never editable (FR-25).
          examples: ["You submitted on time for 18 of 20 required days this cycle..."]
        modelVersion:
          type: string
          description: The AI model identifier used, persisted for NFR-15's determinism audit trail.
          examples: ['gpt-4o-mini-2024-10-21']
        override:
          oneOf:
            - type: object
              required: [newScore, originalScore, reason]
              additionalProperties: false
              properties:
                newScore:
                  type: number
                  minimum: 0
                  maximum: 100
                  examples: [85]
                originalScore:
                  type: number
                  minimum: 0
                  maximum: 100
                  examples: [79]
                reason:
                  type: string
                  examples: ["Strong finish to the cycle not fully reflected in the AI summary."]
            - type: 'null'
          description: Null until a mentor overrides the score (FR-24).

    EvaluationOverrideRequest:
      type: object
      title: EvaluationOverrideRequest
      description: FR-24 — a mentor's override of an evaluation's score.
      required: [newScore, reason]
      additionalProperties: false
      properties:
        newScore:
          type: number
          minimum: 0
          maximum: 100
          examples: [85]
        reason:
          type: string
          minLength: 1
          maxLength: 1000
          examples: ["Strong finish to the cycle not fully reflected in the AI summary."]
```

- [ ] **Step 2: Add the three paths**

```yaml
  /api/v1/students/{id}/evaluations:
    post:
      operationId: generateEvaluation
      summary: Generate the AI evaluation for one student's closed cycle
      description: |
        FR-22/23. Mentor-only. The cycle named by `cycle` must have closed
        (its end date has passed) and must not already have an evaluation.
        The student's enrolment in this batch must span the whole cycle
        (FR-27) — a student who joined or left partway through is not
        evaluated for it.
      tags: [Evaluations]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
          description: The student's user id.
          examples: { student: { value: '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8' } }
        - name: cycle
          in: query
          required: true
          schema: { type: integer, minimum: 1 }
          description: The 1-based cycle sequence to evaluate.
          examples: { cycle: { value: 3 } }
      responses:
        '201':
          description: The newly generated evaluation.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Evaluation' }
              examples:
                generated:
                  value:
                    id: 5a3c2b1d-0e9f-4a8b-b7c6-d5e4f3a2b1c0
                    studentId: 3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8
                    cycleSeq: 3
                    attendance: 80
                    taskCompletion: 90
                    contributionInitiative: 70
                    effortTime: 60
                    mentorEvaluation: 85
                    performanceIndex: 79
                    summary: "You submitted on time for 18 of 20 required days this cycle..."
                    modelVersion: gpt-4o-mini-2024-10-21
                    override: null
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409':
          description: The cycle has not closed yet, already has an evaluation, or the student's enrolment does not span it.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/ProblemDetails' }
              examples:
                notClosed: { value: { type: 'https://irp.bistec.example/problems/cycle-not-closed', title: 'Cycle has not closed', status: 409, detail: 'This cycle does not close until 2026-02-09 — it cannot be evaluated yet (FR-22).' } }
        '502':
          description: The AI provider returned an invalid response.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/ProblemDetails' }
        '503':
          description: The AI provider is unavailable or unconfigured.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/ProblemDetails' }
        '500': { $ref: '#/components/responses/InternalServerError' }

  /api/v1/students/{id}/evaluations/{cycle}:
    get:
      operationId: getEvaluation
      summary: The evaluation for one student's cycle, if one exists
      description: FR-22/23/24. Mentor-only. 404 before an evaluation has been generated.
      tags: [Evaluations]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
          description: The student's user id.
          examples: { student: { value: '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8' } }
        - name: cycle
          in: path
          required: true
          schema: { type: integer, minimum: 1 }
          description: The 1-based cycle sequence.
          examples: { cycle: { value: 3 } }
      responses:
        '200':
          description: The evaluation.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Evaluation' }
              examples:
                evaluated: { value: { id: 5a3c2b1d-0e9f-4a8b-b7c6-d5e4f3a2b1c0, studentId: 3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8, cycleSeq: 3, attendance: 80, taskCompletion: 90, contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85, performanceIndex: 79, summary: "You submitted on time for 18 of 20 required days this cycle...", modelVersion: gpt-4o-mini-2024-10-21, override: null } }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalServerError' }

  /api/v1/evaluations/{id}/override:
    put:
      operationId: overrideEvaluation
      summary: Override an evaluation's score
      description: FR-24. Mentor-only. Stores the new score, the original AI score, and the mentor's reason.
      tags: [Evaluations]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
          description: The evaluation's id.
          examples: { evaluation: { value: '5a3c2b1d-0e9f-4a8b-b7c6-d5e4f3a2b1c0' } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/EvaluationOverrideRequest' }
      responses:
        '200':
          description: The evaluation with its override applied.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Evaluation' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalServerError' }
```

Confirm `#/components/responses/NotFound` already exists (it is used elsewhere, e.g. student/batch
404s) before relying on the `$ref` — if it does not, add it alongside `BadRequest`/`Unauthorized`/
etc. following their exact shape.

- [ ] **Step 3: Add `evaluation` to `StudentCycleSummary`**

Find `StudentCycleSummary` (the Cycles page's per-student row) and add `evaluation` to its
`required` list and `properties`, `oneOf [Evaluation, 'null']`, null when ungenerated — same
pattern as `strengthsAndWeaknesses`.

- [ ] **Step 4: Lint and regenerate**

Run: `pnpm spec:lint`
Expected: zero errors, zero warnings (the `recommended-strict` + four-response custom assertion
gate — `CLAUDE.md`'s API contract rules). Fix any `no-unused-components`/missing-example finding
before moving on — a partial spec change cannot lint clean, so this step is not optional polish.

Run: `pnpm generate && pnpm --filter @irp/client build`
Expected: regenerates `packages/types`/`packages/client` with the three new operations and the
`Evaluation`/`EvaluationOverrideRequest` schemas, and `@irp/client`'s `dist` rebuilds so `apps/web`
sees the new types (the `pnpm generate` doesn't rebuild `dist` trap `CLAUDE.md` records).

- [ ] **Step 5: Commit**

```bash
git add spec/openapi.yaml packages/types packages/client
git commit -m "feat(api): add Evaluation schema and the three evaluation endpoints to the spec (FR-22-24)"
```

(`packages/types`/`packages/client` are git-ignored per `CLAUDE.md` — if `git add` reports nothing
there, that is correct; only `spec/openapi.yaml` should actually be staged.)

---

### Task 6: API routes

**Files:**
- Create: `apps/api/src/routes/evaluations.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/routes/schemas.ts`
- Test: `apps/api/test/evaluations-endpoint.test.ts`

**Interfaces:**
- Consumes: `EvaluationService` (Task 4), `resolveStudent` (exported from `reviews.ts`, reused as-is).
- Produces: the three registered routes; `ServerDeps.evaluationService: EvaluationService`.

- [ ] **Step 1: Write the failing integration test**

```typescript
// apps/api/test/evaluations-endpoint.test.ts
import { describe, expect, it, beforeAll } from "vitest";
import { buildTestServer } from "./helpers/build-test-server.js";
import type { FastifyInstance } from "fastify";

describe("evaluations endpoints", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let studentId: string;
  let batchId: string;

  beforeAll(async () => {
    ({ app, adminToken, studentId, batchId } = await buildTestServer({
      // Fake AI client, matching the fake-notification-service precedent --
      // check test/helpers/ for the exact existing fixture-setup pattern
      // before writing this from scratch; it likely already seeds a batch
      // old enough to have a closed first cycle, which this test needs.
    }));
  });

  it("404s before generation, 201s on generation, 200s after", async () => {
    const before = await app.inject({
      method: "GET", url: `/api/v1/students/${studentId}/evaluations/1`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(before.statusCode).toBe(404);

    const generated = await app.inject({
      method: "POST", url: `/api/v1/students/${studentId}/evaluations?cycle=1`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(generated.statusCode).toBe(201);
    const evaluation = generated.json();
    expect(evaluation.override).toBeNull();

    const after = await app.inject({
      method: "GET", url: `/api/v1/students/${studentId}/evaluations/1`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().id).toBe(evaluation.id);
  });

  it("409s a second generation request for the same cycle", async () => {
    await app.inject({
      method: "POST", url: `/api/v1/students/${studentId}/evaluations?cycle=1`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const second = await app.inject({
      method: "POST", url: `/api/v1/students/${studentId}/evaluations?cycle=1`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(second.statusCode).toBe(409);
  });

  it("PUT override persists the new score, original score, and reason", async () => {
    const generated = await app.inject({
      method: "POST", url: `/api/v1/students/${studentId}/evaluations?cycle=2`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const evaluationId = generated.json().id as string;
    const originalScore = generated.json().performanceIndex as number;

    const overridden = await app.inject({
      method: "PUT", url: `/api/v1/evaluations/${evaluationId}/override`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { newScore: 95, reason: "Exceptional final week." },
    });
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json().override).toEqual({
      newScore: 95, originalScore, reason: "Exceptional final week.",
    });
  });
});
```

Read `apps/api/test/helpers/build-test-server.ts` and an existing integration test (e.g.
`reviews-endpoint.test.ts`) in full before writing this step — this plan sketches the shape, but
the exact `buildTestServer` fixture options (how a batch/student/closed-cycle gets seeded, how a
fake AI client is injected) must match that file's real signature, not be invented here. Use a fake
`EvaluationAiClient` (Task 3's interface) returning a fixed valid result — no real network call,
same principle as every other integration test in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public pnpm --filter @irp/api test evaluations-endpoint -- --run`
Expected: FAIL — routes do not exist yet.

- [ ] **Step 3: Implement the routes**

Add to `apps/api/src/routes/schemas.ts`:

```typescript
export const EVALUATION_GENERATE_QUERY = {
  type: "object",
  required: ["cycle"],
  additionalProperties: false,
  properties: { cycle: { type: "integer", minimum: 1 } },
} as const;

export const CYCLE_PARAM = {
  type: "object",
  required: ["id", "cycle"],
  additionalProperties: false,
  properties: { id: { type: "string", format: "uuid" }, cycle: { type: "integer", minimum: 1 } },
} as const;

export const EVALUATION_OVERRIDE_BODY = {
  type: "object",
  required: ["newScore", "reason"],
  additionalProperties: false,
  properties: {
    newScore: { type: "number", minimum: 0, maximum: 100 },
    reason: { type: "string", minLength: 1, maxLength: 1000 },
  },
} as const;
```

```typescript
// apps/api/src/routes/evaluations.ts
import type { FastifyPluginAsync } from "fastify";
import type { components } from "@irp/types";
import type { EvaluationService, EvaluationView } from "../services/evaluation-service.js";
import type { UserRepo } from "../db/user-repo.js";
import { requireAdmin } from "../plugins/roles.js";
import { resolveStudent } from "./reviews.js";
import { UUID_PARAM, EVALUATION_GENERATE_QUERY, CYCLE_PARAM, EVALUATION_OVERRIDE_BODY } from "./schemas.js";

type ApiEvaluation = components["schemas"]["Evaluation"];

function toApiEvaluation(v: EvaluationView): ApiEvaluation {
  return {
    id: v.id,
    studentId: v.studentId,
    cycleSeq: v.cycleSeq,
    attendance: v.attendance,
    taskCompletion: v.taskCompletion,
    contributionInitiative: v.contributionInitiative,
    effortTime: v.effortTime,
    mentorEvaluation: v.mentorEvaluation,
    performanceIndex: v.performanceIndex,
    summary: v.summary,
    modelVersion: v.modelVersion,
    override: v.override,
  };
}

export const evaluationRoutes: FastifyPluginAsync<{
  evaluationService: EvaluationService;
  userRepo: UserRepo;
  // eslint-disable-next-line @typescript-eslint/require-await
}> = async (app, opts) => {
  app.post<{ Params: { id: string }; Querystring: { cycle: number } }>(
    "/api/v1/students/:id/evaluations",
    { schema: { params: UUID_PARAM, querystring: EVALUATION_GENERATE_QUERY }, preHandler: [app.authenticate] },
    async (req, reply): Promise<ApiEvaluation> => {
      requireAdmin(req);
      const student = await resolveStudent(opts.userRepo, req.params.id);
      // batchId: this plan's route reads it from the student's CURRENT open
      // enrolment (opts.userRepo doesn't carry this -- use
      // opts.evaluationService... no, EvaluationService doesn't resolve
      // batch membership either. Fix before implementing: thread
      // `batchRepo.openEnrolment(student.id)` into this route's deps (add
      // `batchRepo: Pick<BatchRepo, "openEnrolment">` to this plugin's
      // options, matching how admin-actions.ts already depends on batchRepo)
      // and 404 via StudentNotFoundError if there is no open enrolment to
      // evaluate against.
      const enrolment = await opts.batchRepo.openEnrolment(student.id);
      if (enrolment === null) throw new StudentNotFoundError(student.id);
      const view = await opts.evaluationService.generateForCycle(
        enrolment.batchId, student.id, req.query.cycle, new Date(),
      );
      reply.code(201);
      return toApiEvaluation(view);
    },
  );

  app.get<{ Params: { id: string; cycle: number } }>(
    "/api/v1/students/:id/evaluations/:cycle",
    { schema: { params: CYCLE_PARAM }, preHandler: [app.authenticate] },
    async (req, reply): Promise<ApiEvaluation | undefined> => {
      requireAdmin(req);
      const student = await resolveStudent(opts.userRepo, req.params.id);
      const enrolment = await opts.batchRepo.openEnrolment(student.id);
      if (enrolment === null) throw new StudentNotFoundError(student.id);
      const view = await opts.evaluationService.getEvaluation(enrolment.batchId, student.id, req.params.cycle);
      if (view === null) {
        reply.code(404);
        return undefined;
      }
      return toApiEvaluation(view);
    },
  );

  app.put<{ Params: { id: string }; Body: { newScore: number; reason: string } }>(
    "/api/v1/evaluations/:id/override",
    { schema: { params: UUID_PARAM, body: EVALUATION_OVERRIDE_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiEvaluation> => {
      requireAdmin(req);
      const view = await opts.evaluationService.override(
        req.params.id, req.user!.id, req.body.newScore, req.body.reason,
      );
      return toApiEvaluation(view);
    },
  );
};
```

**This route sketch needs `batchRepo` added to the plugin's options** (noted inline above) — add
`batchRepo: Pick<BatchRepo, "openEnrolment">` to `evaluationRoutes`'s `FastifyPluginAsync` generic
and import `BatchRepo`'s type, then pass `batchRepo: deps.batchRepo` at the registration call in
`server.ts` below. The override route's call to `opts.evaluationService.override` already matches
Task 4's final 4-argument signature (`evaluationId, mentorId, newScore, reason`) — `cycleSeq`
comes from the evaluation record's own joined `Cycle.seq` (Task 2), not a route-supplied parameter.

In `apps/api/src/server.ts`:

```typescript
import { evaluationRoutes } from "./routes/evaluations.js";
import type { EvaluationService } from "./services/evaluation-service.js";
// add to ServerDeps:
  evaluationService: EvaluationService;
// add to buildServer, after reviewRoutes:
  await app.register(evaluationRoutes, {
    evaluationService: deps.evaluationService,
    userRepo: deps.userRepo,
    batchRepo: deps.batchRepo,
  });
```

In `apps/api/src/index.ts`:

```typescript
import { createEvaluationRepo } from "./db/evaluation-repo.js";
import { createEvaluationAiClient } from "./services/evaluation-ai-client.js"; // Note: Task 3 names the export createAzureOpenAiEvaluator -- use that exact name here, not createEvaluationAiClient.
import { createEvaluationService } from "./services/evaluation-service.js";
// inside start(), alongside the other repo/service construction:
    const evaluationRepo = createEvaluationRepo(prisma);
    const aiClient = createAzureOpenAiEvaluator(config.azureOpenAi, fetch);
    const evaluationService = createEvaluationService({
      batchRepo, entryRepo, mentorRecordRepo, absenceRepo, evaluationRepo, aiClient, userRepo,
    });
// add evaluationService to the buildServer(...) call's object.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public pnpm --filter @irp/api test evaluations-endpoint -- --run`
Expected: PASS, 3/3.

- [ ] **Step 5: Run the whole apps/api suite**

Run: `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public pnpm --filter @irp/api test -- --run`
Expected: every test green, not just this task's own file — a route-registration change touches
the whole server.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/evaluations.ts apps/api/src/routes/schemas.ts apps/api/src/server.ts apps/api/src/index.ts apps/api/test/evaluations-endpoint.test.ts
git commit -m "feat(api): wire the three evaluation endpoints into the server (FR-22-24)"
```

---

### Task 7: Mentor UI — Cycles page "Evaluate" action and override form

**Files:**
- Modify: `apps/web/app/(app)/cycles/page.tsx`
- Create: `apps/web/app/(app)/cycles/evaluate-action.ts`
- Create: `apps/web/components/evaluation/evaluation-cell.tsx`
- Test: `apps/web/test/cycles-page.test.tsx` (modify existing)
- Test: `apps/web/test/evaluation-cell.test.tsx`

**Interfaces:**
- Consumes: `generateEvaluation`/`overrideEvaluation` from `@irp/client` (Task 5's generated SDK);
  `StudentCycleSummary.evaluation` (Task 5).

- [ ] **Step 1: Write the failing component test**

```typescript
// apps/web/test/evaluation-cell.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvaluationCell } from "@/components/evaluation/evaluation-cell";

describe("EvaluationCell", () => {
  it("shows an Evaluate button and no score when ungenerated and the cycle is closed", () => {
    render(<EvaluationCell studentId="s1" cycleSeq={1} evaluation={null} cycleIsClosed />);
    expect(screen.getByRole("button", { name: "Evaluate" })).toBeInTheDocument();
    expect(screen.queryByText(/performance/i)).not.toBeInTheDocument();
  });

  it("shows 'Awaiting evaluation', no button, when the cycle has not closed yet", () => {
    render(<EvaluationCell studentId="s1" cycleSeq={1} evaluation={null} cycleIsClosed={false} />);
    expect(screen.getByText("Awaiting evaluation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Evaluate" })).not.toBeInTheDocument();
  });

  it("shows the AI score and an Override control when evaluated with no override", () => {
    render(
      <EvaluationCell
        studentId="s1"
        cycleSeq={1}
        cycleIsClosed
        evaluation={{
          id: "eval-1", studentId: "s1", cycleSeq: 1, attendance: 80, taskCompletion: 90,
          contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85, performanceIndex: 79,
          summary: "Solid month.", modelVersion: "gpt-4o-mini-2024-10-21", override: null,
        }}
      />,
    );
    expect(screen.getByText("79")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Override" })).toBeInTheDocument();
  });

  it("shows the override score, not the AI score, once overridden", () => {
    render(
      <EvaluationCell
        studentId="s1"
        cycleSeq={1}
        cycleIsClosed
        evaluation={{
          id: "eval-1", studentId: "s1", cycleSeq: 1, attendance: 80, taskCompletion: 90,
          contributionInitiative: 70, effortTime: 60, mentorEvaluation: 85, performanceIndex: 79,
          summary: "Solid month.", modelVersion: "gpt-4o-mini-2024-10-21",
          override: { newScore: 85, originalScore: 79, reason: "Strong finish." },
        }}
      />,
    );
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText(/overridden from 79/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @irp/web test evaluation-cell -- --run`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the Server Action and component**

```typescript
// apps/web/app/(app)/cycles/evaluate-action.ts
"use server";

import { revalidatePath } from "next/cache";
import { generateEvaluation, overrideEvaluation } from "@irp/client";
import { apiClient } from "@/lib/api-client";

export async function evaluateAction(studentId: string, cycle: number): Promise<void> {
  const client = await apiClient();
  await generateEvaluation({ client, path: { id: studentId }, query: { cycle } });
  revalidatePath("/cycles");
}

export async function overrideAction(evaluationId: string, newScore: number, reason: string): Promise<void> {
  const client = await apiClient();
  await overrideEvaluation({ client, path: { id: evaluationId }, body: { newScore, reason } });
  revalidatePath("/cycles");
}
```

Check an existing Server Action (e.g. the Review page's save-record action, or `absence-toggle.tsx`'s)
for this repo's exact error-surfacing convention before finalising — this sketch omits error
handling for the generate/override call failing (a `409`/`502`/`503`), which the real
implementation must surface to the mentor rather than silently swallow. Match whatever pattern
`entry-actions.ts` or the review page's action already establishes for turning a client-error
response into something the calling component can render as an alert.

```typescript
// apps/web/components/evaluation/evaluation-cell.tsx
import type { components } from "@irp/types";
import { evaluateAction, overrideAction } from "@/app/(app)/cycles/evaluate-action";

type Evaluation = components["schemas"]["Evaluation"];

export function EvaluationCell({
  studentId, cycleSeq, evaluation, cycleIsClosed,
}: {
  studentId: string;
  cycleSeq: number;
  evaluation: Evaluation | null;
  cycleIsClosed: boolean;
}) {
  if (evaluation === null) {
    if (!cycleIsClosed) return <span>Awaiting evaluation</span>;
    return (
      <form action={evaluateAction.bind(null, studentId, cycleSeq)}>
        <button type="submit" className="btn">Evaluate</button>
      </form>
    );
  }

  const score = evaluation.override?.newScore ?? evaluation.performanceIndex;
  return (
    <div>
      <span className="tabular" style={{ fontWeight: 600 }}>{Math.round(score)}</span>
      {evaluation.override !== null && (
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          Overridden from {Math.round(evaluation.override.originalScore)} — {evaluation.override.reason}
        </p>
      )}
      {evaluation.override === null && (
        <form
          action={async (formData: FormData) => {
            "use server";
            await overrideAction(evaluation.id, Number(formData.get("newScore")), String(formData.get("reason")));
          }}
        >
          <input type="number" name="newScore" min={0} max={100} required aria-label="New score" />
          <input type="text" name="reason" required aria-label="Override reason" />
          <button type="submit" className="btn">Override</button>
        </form>
      )}
    </div>
  );
}
```

The inline `"use server"` closure above is a sketch — check whether this codebase's existing forms
(e.g. the absence toggle, or the review page's record form) use a bound top-level action or an
inline one, and match that convention exactly rather than introducing a second pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @irp/web test evaluation-cell -- --run`
Expected: PASS, 4/4.

- [ ] **Step 5: Wire into the Cycles page**

In `apps/web/app/(app)/cycles/page.tsx`, replace:

```typescript
<Td data-testid={`evaluation-${student.id}`} style={{ color: "var(--ink-muted)" }}>
  Awaiting evaluation
</Td>
```

with:

```typescript
<Td data-testid={`evaluation-${student.id}`}>
  <EvaluationCell
    studentId={student.id}
    cycleSeq={data.cycle.seq!}
    evaluation={evaluation ?? null}
    cycleIsClosed={/* compareDates(data.cycle.endDate, toProgrammeDate(new Date())) < 0 -- import these from @irp/core */}
  />
</Td>
```

where `evaluation` comes from the per-student `StudentCycleSummary.evaluation` field Task 5 added
(confirm the exact destructured name matches what `data.students.map(({ student, counts,
reviewProgress, evaluation }) => ...)` actually receives once the generated types exist — Task 5's
schema change is what fixes this binding, so write this step after Task 5, not before). Note
`data.cycle.seq!` is non-null here only because this `Td` renders inside the
`data.students.length === 0 ? ... : <Table>` branch, which only reaches cells when `data !==
undefined` — but `data.cycle.seq` is independently nullable (a batch with no evaluated cycle yet).
Guard it: if `data.cycle.seq === null`, render nothing in this column (there is no cycle to
evaluate), matching the existing `data.cycle.seq === null` branch already handled a few lines above
for the Panel title.

- [ ] **Step 6: Update the existing Cycles page test and run it**

`apps/web/test/cycles-page.test.tsx` likely asserts the literal text "Awaiting evaluation" somewhere
for every row — read it first, then update affected cases: one row with a closed, ungenerated cycle
should now assert the "Evaluate" button instead; add a case for an evaluated row rendering a score.

Run: `pnpm --filter @irp/web test cycles-page evaluation-cell -- --run`
Expected: PASS.

- [ ] **Step 7: Full web verification**

Run: `pnpm --filter @irp/web typecheck && pnpm --filter @irp/web test -- --run && AUTH_DEV_BYPASS=false pnpm --filter @irp/web build && pnpm --filter @irp/web typecheck`
Expected: all green; typecheck clean both before AND after the build (the `.next/types` staleness
trap `CLAUDE.md` records).

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/\(app\)/cycles/ apps/web/components/evaluation/ apps/web/test/cycles-page.test.tsx apps/web/test/evaluation-cell.test.tsx
git commit -m "feat(web): add Evaluate/Override actions to the Cycles page (FR-22-24)"
```

---

### Task 8: Student-facing summary and e2e coverage

**Files:**
- Modify: `apps/api/src/services/dashboard-service.ts` (wire real `strengthsAndWeaknesses`)
- Test: `apps/api/test/dashboard-service.test.ts` (modify existing)
- Modify: `apps/web/e2e/dashboard-flows.spec.ts` or a new `apps/web/e2e/evaluation-flows.spec.ts`

**Interfaces:**
- Consumes: `EvaluationRepo.findEvaluation` (Task 2) or equivalent read path, from
  `dashboard-service.ts`'s `studentDashboard` function.

- [ ] **Step 1: Read `dashboard-service.ts`'s `studentDashboard` function in full**

Find exactly where `strengthsAndWeaknesses: null` is currently hard-coded (per handoff.md: "the
student My month page renders the designed empty state... rather than any fabricated score" — this
is a literal `null` in the response builder, not a TODO). This task replaces that literal with a
real lookup.

- [ ] **Step 2: Write the failing test**

```typescript
// Add to apps/api/test/dashboard-service.test.ts
it("surfaces the latest evaluation's summary once one exists for the student's current cycle", async () => {
  // Arrange a student, a batch, and — via the real evaluation flow or a direct
  // Prisma insert matching evaluation-repo.test.ts's pattern — an Evaluation
  // row for this student's current cycle with a known summary string.
  // Then assert getMyDashboard-equivalent service call's strengthsAndWeaknesses
  // equals that string, not null.
});

it("stays null when no evaluation exists yet for the student's current cycle", async () => {
  // Existing behaviour, pinned explicitly rather than left implicit now that
  // the field is no longer hard-coded.
});
```

Write the actual arrange/act/assert code once you have read the real function and its existing
test file's fixture-setup conventions in Step 1 — do not guess at `dashboard-service.ts`'s exact
internal shape from this plan alone.

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public pnpm --filter @irp/api test dashboard-service -- --run`
Expected: FAIL on the first new case (still hard-coded null), PASS on the second (already true).

- [ ] **Step 4: Implement**

Replace the hard-coded `strengthsAndWeaknesses: null` with a lookup: resolve the student's current
cycle bounds (this function already does this for other fields — reuse its own `bounds`/`seq`
locals rather than recomputing), call `evaluationRepo.findEvaluation` (requires threading
`evaluationRepo` into `DashboardService`'s deps — add it alongside `batchRepo`/`dayService`), and
return the evaluation's `summary` if one exists, else `null`.

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public pnpm --filter @irp/api test dashboard-service -- --run`
Expected: PASS, both new cases plus the full existing suite.

- [ ] **Step 6: Update `index.ts`/`server.ts` wiring**

`createDashboardService` now needs `evaluationRepo` in its deps — add it at both construction call
sites (`index.ts`), matching how `evaluationRepo` was already constructed in Task 6.

- [ ] **Step 7: Add e2e coverage**

Add one Playwright case: sign in as mentor, navigate to Cycles, evaluate a student in a closed
cycle (use a seeded persona whose first cycle has already closed — check `run-seed.ts`/
`@irp/fixtures` for one, the same way `mentor-flows.spec.ts` already picks personas by name), assert
the score renders; then (same test or a second one) sign in as that student, confirm
"Strengths and areas to develop" now shows real prose instead of the empty state.

- [ ] **Step 8: Run the full verification suite**

Run: `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public pnpm --filter @irp/api test -- --run && pnpm --filter @irp/web test -- --run && pnpm --filter @irp/web typecheck && AUTH_DEV_BYPASS=false pnpm --filter @irp/web build && pnpm --filter @irp/web typecheck`

Note: the e2e case needs a real `AZURE_OPENAI_*` config or a test-time fake — **this plan does not
resolve which**, since Playwright drives a real running server (`next dev` + the real `apps/api`),
not a mocked one. If no real Azure OpenAI credentials are available to CI/local runs, this e2e case
cannot pass against a real AI call; ledger this as a finding for the final review rather than
inventing a mid-plan mock-server workaround. A manual run against real credentials may be the only
way to exercise this path before merge, mirroring NFR-15's own manual-gate treatment.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/dashboard-service.ts apps/api/test/dashboard-service.test.ts apps/api/src/index.ts apps/web/e2e/
git commit -m "feat(api): surface the real evaluation summary on the student dashboard (FR-22, FR-29)"
```

---

### Task 9: ADRs and documentation

**Files:**
- Create: `docs/adr/0031-azure-openai-for-ai-evaluation-o-5-override.md`
- Create: `docs/adr/0032-hand-written-azure-openai-client-over-sdk.md`
- Modify: `docs/interview-and-prd.md` (O-5 row)
- Modify: `handoff.md`
- Modify: `.env.example` files (both `apps/api/.env.example` if present, and any onboarding doc
  listing required env vars)

**Interfaces:** None — documentation only.

- [ ] **Step 1: Write ADR-0031**

```markdown
# ADR-0031: Azure OpenAI as the AI evaluation provider — an O-5 override

## Status
Accepted, proceeding ahead of O-5's own required process (see context).

## Context
`CLAUDE.md` states O-5 (the AI provider decision) needs an ADR and leadership escalation before
any AI call is implemented, and the PRD lists O-5 as Undecided as of this ADR's date. This ADR
records a provider choice made WITHOUT that escalation, on the explicit instruction of the spec
lead, who accepts the risk — see `docs/superpowers/specs/2026-10-06-ai-monthly-evaluation-design.md`
§0 for the full reasoning. This is the technical half of O-5 only; the leadership/data-processing
sign-off itself remains outstanding.

## Decision
Azure OpenAI, via the Azure resource/subscription this project already deploys to.

## Rejected alternatives
1. **OpenAI direct API.** Moves student submission text (personal data) to a separate
   third-party tenant outside Azure — the exact risk O-5's own wording raises.
2. **Anthropic's API.** Same cross-tenant data-residency concern as OpenAI direct.
3. **Wait for the leadership escalation before implementing anything.** Rejected by the spec
   lead's explicit instruction. Cost if this is later reversed: a provider swap touches only
   `apps/api/src/services/evaluation-ai-client.ts` and its tests — the data-assembly and rubric
   maths underneath have no provider dependency.

## Consequences
If leadership's eventual answer rejects Azure OpenAI, this ADR is superseded, not merely amended —
record that decision as its own ADR naming this one.
```

- [ ] **Step 2: Write ADR-0032**

```markdown
# ADR-0032: Hand-written Azure OpenAI client over the `openai` SDK

## Status
Accepted.

## Context
Calling Azure OpenAI needs either the `openai` npm package (configured for Azure) or a direct
`fetch` against its REST endpoint. This repo already made the equivalent choice twice: ADR-0024
(Teams webhook over the Graph API SDK) and ADR-0025 (SMTP over a vendor SDK).

## Decision
A hand-written `fetch` client (`apps/api/src/services/evaluation-ai-client.ts`), matching
`createTeamsWebhookSender`/`createSmtpEmailSender`'s shape: a small interface, a factory taking
config and (here) an injectable `fetch`, tested against a fake with no real network call.

## Rejected alternatives
1. **The `openai` npm SDK.** Pulls in a dependency this repo otherwise avoids for exactly this
   kind of integration (ADR-0024/0025 precedent), for an API surface (one chat-completions POST)
   simple enough that the SDK buys little beyond typed request/response shapes this codebase
   already types itself via the OpenAPI-generated `Evaluation` schema.

## Consequences
The client is easy to test (inject a fake `fetch`, exactly like the Teams/SMTP senders already
do) and easy to swap if ADR-0031 is later reversed.
```

- [ ] **Step 3: Update O-5's row in `docs/interview-and-prd.md`**

Change its third column from "ADR + escalation... before implementation" to something recording
that the technical half shipped ahead of that process — mirror O-18's own "DECIDED"/reversal
language style, but for an override rather than a reversal:

```markdown
| O-5 | AI provider and data-processing terms | Undecided — no leadership sign-off exists. Azure OpenAI is now wired up regardless, on the spec lead's explicit instruction ([ADR-0031](adr/0031-azure-openai-for-ai-evaluation-o-5-override.md)) | **Leadership escalation still outstanding.** If the eventual answer differs from Azure OpenAI, ADR-0031 is superseded and the provider swap is contained to `evaluation-ai-client.ts` per its own §9/Consequences |
```

- [ ] **Step 4: `handoff.md` entry**

Dated entry: what shipped (the three endpoints, the Cycles page actions, the student summary), the
O-5 override and its exact scope (technical only, not leadership sign-off), the quarterly-vs-monthly
ambiguity flagged for the requester, and the e2e gap from Task 8 Step 8 (no real AI credentials
available this session, if that remains true when this task runs).

- [ ] **Step 5: Env var documentation**

Add `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`,
`AZURE_OPENAI_API_VERSION` (optional, defaults to `2024-10-21`) to `apps/api/.env.example` with a
one-line comment each, matching the existing `TEAMS_WEBHOOK_URL`/`SMTP_*` entries' style exactly.

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0031-azure-openai-for-ai-evaluation-o-5-override.md docs/adr/0032-hand-written-azure-openai-client-over-sdk.md docs/interview-and-prd.md handoff.md apps/api/.env.example
git commit -m "docs: add ADR-0031/0032, update O-5 and handoff for the AI monthly evaluation slice"
```

---

### Task 10: NFR-15 determinism verification (go/no-go gate)

**Files:** None modified — this is a manual verification task, the same shape the cycle calendar
plan's Task 8 (NFR-13) used.

- [ ] **Step 1: Confirm real Azure OpenAI credentials are available**

This task cannot run without a real, configured `AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_API_KEY`/
`AZURE_OPENAI_DEPLOYMENT`. If none are available, **stop and say so explicitly in the final
report** — do not mark this task done on the strength of the unit/integration tests alone, which
exercise a fake client (Tasks 3/6) and prove nothing about the real provider's actual output
variance.

- [ ] **Step 2: Generate the same evaluation several times against real data**

Using a seeded student with a real, closed, unevaluated cycle (or by resetting between runs — do
not reuse `EvaluationExistsError`'s 409 to skip this step): call `POST
/api/v1/students/{id}/evaluations?cycle={n}` five times in a row against the same underlying
Entry/MentorDayRecord/AbsenceRecord data (delete the prior `Evaluation` row between calls via a
direct `prisma.evaluation.delete`, or run against five different students with identical seeded
data), and record each run's five criterion scores and `performanceIndex`.

- [ ] **Step 3: Confirm the ±2-point spec**

Compare the five `performanceIndex` values. Per NFR-15 and the spec's D5: the spread between the
highest and lowest value must be at most 2 points. If it exceeds that, this is a stop-the-plan
finding per the spec's own framing (same severity as the cycle calendar's NFR-13 gate) — it means
`temperature: 0` alone is not sufficient for this deployment/model, and the finding goes back to
the spec (a different model, or a format change) rather than being silently accepted.

- [ ] **Step 4: Record the result**

Write the five runs' scores and the measured spread into `handoff.md`'s dated entry for this slice
(Task 9 Step 4), alongside the model/deployment name used.

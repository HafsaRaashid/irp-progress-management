# Per-Submission Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a mentor score and give feedback on each of a student's daily entries individually, and mark which ones count toward the student's monthly evaluation — replacing the current whole-day-only review model.

**Architecture:** Three new nullable/defaulted columns on the existing `Entry` table (`score`, `mentorFeedback`, `countsTowardEvaluation`), one new mentor-only endpoint (`PUT /api/v1/entries/{id}/review`) reusing the existing lock-on-Evaluated pattern from `entry-repo.ts`, and a mentor/student API schema split (`Entry` vs a new `StudentEntry`) so the new fields never reach a student through `GET /api/v1/me/days` or the student's own `POST /api/v1/entries` response.

**Tech Stack:** Prisma 7 (migration), Fastify 5 (route), OpenAPI 3.1 + `openapi-typescript`/`@hey-api/openapi-ts` (spec-first generation), Vitest (unit/integration), Next.js 16 Server Actions (web), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-15-per-submission-review-design.md`

## Global Constraints

- Score is a **0–100 integer**, nullable until reviewed (spec D3).
- Once a day's `DailyReport` is `EVALUATED`, its entries' score/feedback/flag are **locked** — reuse `LockedDayError`, the same 409 `entry-repo.ts` already throws for a post-lock entry write (spec D4).
- **`score` and `countsTowardEvaluation` must never reach a student.** `GET /api/v1/me/days` and the student's own `POST /api/v1/entries` response use a new `StudentEntry` schema that omits both — this plan does **not** add `mentorFeedback` to that student-facing shape either (that is the next spec/plan, `student-feedback-visibility`, which explicitly "gains one line" for it — see the note in Task 4).
- Request bodies are `additionalProperties: false`; every OpenAPI schema/parameter needs an example/description (`CLAUDE.md`'s API contract rules).
- `spec/openapi.yaml` changes before any handler code — regenerate `packages/types`/`packages/client` (`pnpm generate`) before writing the route.
- This entire feature is logged as **O-18** — it supersedes FR-22–24's AI-scored-cycle model. Mark the calculation's/route's assumption inline as `// ASSUMPTION: O-18`.
- Local Postgres is on port 5433; `DATABASE_URL=postgresql://irp:irp@127.0.0.1:5433/irp?schema=public` must be set in the shell before any direct `prisma` command (it is not auto-loaded — see `ONBOARDING.md` §5).

---

### Task 1: Prisma schema, migration, and generated client

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (the `Entry` model)
- Create: a new migration under `apps/api/prisma/migrations/` (auto-named by Prisma)

**Interfaces:**
- Produces: three new `Entry` columns — `score Int?`, `mentorFeedback String?`, `countsTowardEvaluation Boolean @default(false)` — that Task 2's repo layer reads/writes via the regenerated Prisma client at `apps/api/src/generated/prisma`.

- [ ] **Step 1: Edit the `Entry` model in `apps/api/prisma/schema.prisma`**

Find the current `Entry` model:

```prisma
model Entry {
  id          String   @id @default(uuid())
  studentId   String
  entryDate   DateTime @db.Date
  body        String
  submittedAt DateTime @db.Timestamptz(3)
  isLate      Boolean
  isExtra     Boolean
  createdAt   DateTime @default(now()) @db.Timestamptz(3)

  student User @relation(fields: [studentId], references: [id])

  @@index([studentId, entryDate])
}
```

Replace it with:

```prisma
/// FR-19 (context), extended for per-submission mentor review (O-18):
/// score/mentorFeedback/countsTowardEvaluation are null/false until a
/// mentor reviews the entry via PUT /api/v1/entries/{id}/review. Locked
/// once the entry's day is EVALUATED (FR-20), same as the entry body.
model Entry {
  id                     String   @id @default(uuid())
  studentId              String
  entryDate              DateTime @db.Date
  body                   String
  submittedAt            DateTime @db.Timestamptz(3)
  isLate                 Boolean
  isExtra                Boolean
  score                  Int?
  mentorFeedback         String?
  countsTowardEvaluation Boolean  @default(false)
  createdAt              DateTime @default(now()) @db.Timestamptz(3)

  student User @relation(fields: [studentId], references: [id])

  @@index([studentId, entryDate])
}
```

- [ ] **Step 2: Generate and apply the migration**

```powershell
$env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
pnpm --filter @irp/api exec prisma migrate dev --name entry_review_fields
```

Expected: a new directory under `apps/api/prisma/migrations/` (e.g.
`<timestamp>_entry_review_fields/migration.sql`) containing three `ALTER TABLE "Entry" ADD COLUMN ...` statements, and the command reports the migration applied successfully against the local dev database.

- [ ] **Step 3: Regenerate the Prisma client**

```powershell
pnpm --filter @irp/api exec prisma generate
```

Expected: `apps/api/src/generated/prisma` regenerates with `score`, `mentorFeedback`, `countsTowardEvaluation` on the `Entry` model's types (this directory is git-ignored — nothing to commit here beyond the schema and migration files).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): add score, mentorFeedback, countsTowardEvaluation to Entry"
```

---

### Task 2: Domain error and `EntryRepo.reviewEntry`

**Files:**
- Modify: `apps/api/src/domain/errors.ts`
- Modify: `apps/api/src/db/entry-repo.ts`
- Test: `apps/api/test/entry-repo.test.ts`

**Interfaces:**
- Consumes: the regenerated Prisma client from Task 1 (`prisma.entry.findUnique`, `prisma.entry.update`, `prisma.dailyReport.findUnique`), `lockStudentDay` from `apps/api/src/db/day-lock.ts` (existing), `LockedDayError` (existing).
- Produces: `EntryNotFoundError` (new, `apps/api/src/domain/errors.ts`) and `EntryRepo.reviewEntry(entryId: string, input: { score: number; feedback: string; countsTowardEvaluation: boolean }): Promise<EntryRecord>` — `EntryRecord` now carries `score: number | null`, `mentorFeedback: string | null`, `countsTowardEvaluation: boolean`. Both are consumed by Task 3's route handler.

- [ ] **Step 1: Add `EntryNotFoundError`**

In `apps/api/src/domain/errors.ts`, add after `ReportNotFoundError` (keeps not-found errors grouped):

```ts
export class EntryNotFoundError extends DomainError {
  readonly code = "entry-not-found";
  readonly status = 404;
  readonly title = "Entry not found";
  constructor(id: string) {
    super(`No entry exists with id ${id}.`);
  }
}
```

- [ ] **Step 2: Write the failing repo tests**

In `apps/api/test/entry-repo.test.ts`, add to the `import` from `../src/domain/errors.js`:

```ts
import {
  AbsentDayConflictError,
  EntryNotFoundError,
  LockedDayError,
  SubmissionWindowClosedError,
} from "../src/domain/errors.js";
```

Then add these `it` blocks inside the existing `describe.skipIf(!dbUrl)("createEntryRepo", ...)` block, after the last existing test:

```ts
  it("reviewEntry sets score, feedback, and the evaluation flag (O-18)", async () => {
    const s = await student("e-7");
    const entry = await repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "reviewable", submittedAt: MONDAY_5PM });

    const reviewed = await repo.reviewEntry(entry.id, {
      score: 85,
      feedback: "Solid work, clean tests.",
      countsTowardEvaluation: true,
    });

    expect(reviewed.score).toBe(85);
    expect(reviewed.mentorFeedback).toBe("Solid work, clean tests.");
    expect(reviewed.countsTowardEvaluation).toBe(true);

    const row = await prisma.entry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.score).toBe(85);
    expect(row.mentorFeedback).toBe("Solid work, clean tests.");
    expect(row.countsTowardEvaluation).toBe(true);
  });

  it("reviewEntry overwrites a prior review on a second call", async () => {
    const s = await student("e-8");
    const entry = await repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "reviewable twice", submittedAt: MONDAY_5PM });
    await repo.reviewEntry(entry.id, { score: 40, feedback: "needs work", countsTowardEvaluation: false });

    const reviewed = await repo.reviewEntry(entry.id, { score: 90, feedback: "much better on redo", countsTowardEvaluation: true });

    expect(reviewed.score).toBe(90);
    expect(reviewed.countsTowardEvaluation).toBe(true);
  });

  it("rejects reviewEntry on an unknown entry id with EntryNotFoundError", async () => {
    await expect(
      repo.reviewEntry("00000000-0000-0000-0000-000000000000", { score: 50, feedback: "x", countsTowardEvaluation: false }),
    ).rejects.toThrow(EntryNotFoundError);
  });

  it("rejects reviewEntry on an entry whose day is EVALUATED with LockedDayError (FR-20)", async () => {
    const s = await student("e-9");
    const entry = await repo.addEntry({ studentId: s.id, entryDate: MONDAY, body: "will be locked", submittedAt: MONDAY_5PM });
    await prisma.dailyReport.updateMany({
      where: { studentId: s.id }, data: { status: "EVALUATED", evaluatedAt: new Date() },
    });

    await expect(
      repo.reviewEntry(entry.id, { score: 50, feedback: "too late", countsTowardEvaluation: false }),
    ).rejects.toThrow(LockedDayError);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

```powershell
$env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
pnpm --filter @irp/api exec vitest run test/entry-repo.test.ts
```

Expected: FAIL — `repo.reviewEntry is not a function` (and `EntryNotFoundError` import fails to resolve until Step 1's edit is picked up — Step 1 already applied, so only the missing method fails).

- [ ] **Step 4: Implement `reviewEntry`**

In `apps/api/src/db/entry-repo.ts`:

Update the imports:

```ts
import {
  AbsentDayConflictError,
  EntryNotFoundError,
  LockedDayError,
  ReportNotFoundError,
  InvalidTransitionError,
} from "../domain/errors.js";
```

Extend `EntryRecord`:

```ts
export interface EntryRecord {
  id: string;
  studentId: string;
  entryDate: CivilDate;
  body: string;
  submittedAt: Date;
  isLate: boolean;
  isExtra: boolean;
  score: number | null;
  mentorFeedback: string | null;
  countsTowardEvaluation: boolean;
}
```

Add the method to the `EntryRepo` interface, after `transition`:

```ts
  reviewEntry(
    entryId: string,
    input: { score: number; feedback: string; countsTowardEvaluation: boolean },
  ): Promise<EntryRecord>;
```

Extend `DbEntry` and `mapEntry`:

```ts
interface DbEntry {
  id: string; studentId: string; entryDate: Date; body: string;
  submittedAt: Date; isLate: boolean; isExtra: boolean;
  score: number | null; mentorFeedback: string | null; countsTowardEvaluation: boolean;
}

function mapEntry(e: DbEntry): EntryRecord {
  return {
    id: e.id,
    studentId: e.studentId,
    entryDate: fromDbDate(e.entryDate),
    body: e.body,
    submittedAt: e.submittedAt,
    isLate: e.isLate,
    isExtra: e.isExtra,
    score: e.score,
    mentorFeedback: e.mentorFeedback,
    countsTowardEvaluation: e.countsTowardEvaluation,
  };
}
```

Add the implementation inside `createEntryRepo`'s returned object, after `transition(...)`:

```ts
    // Mirrors addEntry's find-then-lock-then-check shape: the entry is
    // looked up first (to learn its studentId/entryDate), then the
    // student-day lock is taken, then the parent report's status is
    // checked -- an EVALUATED day rejects the review exactly like it
    // rejects a new entry (FR-20). ASSUMPTION: O-18 -- this mentor-set
    // score replaces the AI-scored-cycle model FR-22-24 originally
    // specified; see docs/superpowers/specs/2026-09-15-per-submission-review-design.md.
    async reviewEntry(entryId, input) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.entry.findUnique({ where: { id: entryId } });
        if (!existing) throw new EntryNotFoundError(entryId);
        const entryDate = fromDbDate(existing.entryDate);
        await lockStudentDay(tx, existing.studentId, entryDate);
        const report = await tx.dailyReport.findUnique({
          where: {
            studentId_reportDate: { studentId: existing.studentId, reportDate: existing.entryDate },
          },
        });
        if (report?.status === "EVALUATED") {
          throw new LockedDayError(entryDate);
        }
        const updated = await tx.entry.update({
          where: { id: entryId },
          data: {
            score: input.score,
            mentorFeedback: input.feedback,
            countsTowardEvaluation: input.countsTowardEvaluation,
          },
        });
        return mapEntry(updated);
      });
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

```powershell
$env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
pnpm --filter @irp/api exec vitest run test/entry-repo.test.ts
```

Expected: PASS, all tests including the four new ones.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/domain/errors.ts apps/api/src/db/entry-repo.ts apps/api/test/entry-repo.test.ts
git commit -m "feat(api): add EntryRepo.reviewEntry and EntryNotFoundError"
```

---

### Task 3: OpenAPI spec — Entry/StudentEntry split and the review endpoint

**Files:**
- Modify: `spec/openapi.yaml`

**Interfaces:**
- Produces: extended `Entry` schema (mentor-facing, gains `score`/`mentorFeedback`/`countsTowardEvaluation`), new `StudentEntry` schema (the **old** `Entry` shape, unchanged — six fields, no new ones), new `StudentDaySummary` schema (mirrors `DaySummary` but `entries: StudentEntry[]`), new `EntryReview` request schema, and a new path `PUT /api/v1/entries/{id}/review`. `GET /api/v1/me/days`'s response switches from `DaySummary` to `StudentDaySummary`. `POST /api/v1/entries`'s response switches from `Entry` to `StudentEntry` — this is a **correction caught during planning**: that endpoint is student-only (`requireStudent`), so its response must not use the mentor `Entry` schema either, or a student's own submission response would leak `score`.
- Consumed by: Task 4 (route handlers, off the regenerated `packages/types`), Task 5 (web SDK calls, off the regenerated `packages/client`).

**Note for the next plan (`student-feedback-visibility`):** `StudentEntry` here is deliberately the **unchanged** old `Entry` shape (no `mentorFeedback` either) — that plan is what adds `mentorFeedback` to it. Do not add it here even though the per-submission-review spec's prose reads ambiguously on this point; the later spec is explicit that `StudentEntry` "gains one line" for `mentorFeedback`, which only makes sense if it isn't there yet.

- [ ] **Step 1: Extend the `Entry` schema**

In `spec/openapi.yaml`, find the `Entry` schema (search for `    Entry:`) and replace it:

```yaml
    Entry:
      type: object
      title: Entry
      description: |
        One stored entry with server-computed flags, plus the mentor's
        per-submission review (O-18) — score, feedback, and whether it
        counts toward the student's monthly evaluation. Mentor-facing
        only; see StudentEntry for what a student receives instead.
      required: [id, entryDate, body, submittedAt, isLate, isExtra, score, mentorFeedback, countsTowardEvaluation]
      additionalProperties: false
      properties:
        id:
          type: string
          format: uuid
          description: Entry identifier.
          examples:
            - 7be9f1d2-3c44-4f8a-9a01-2b3c4d5e6f70
        entryDate:
          type: string
          format: date
          description: The civil date the entry targets.
          examples:
            - '2026-08-03'
        body:
          type: string
          description: The submitted text.
          examples:
            - Implemented the roster endpoint and its tests.
        submittedAt:
          type: string
          format: date-time
          description: UTC instant the entry was accepted.
          examples:
            - '2026-08-03T11:30:00.000Z'
        isLate:
          type: boolean
          description: True when a required day's entry arrived after that day ended but inside grace. Weekends are never late.
          examples:
            - false
        isExtra:
          type: boolean
          description: True for entries on optional (weekend) days — FR-33.
          examples:
            - false
        score:
          oneOf:
            - type: integer
              minimum: 0
              maximum: 100
            - type: 'null'
          description: The mentor's score for this submission, 0-100. Null until reviewed.
          examples:
            - 85
        mentorFeedback:
          oneOf:
            - type: string
            - type: 'null'
          description: The mentor's feedback on this submission. Null until reviewed.
          examples:
            - Solid work, clean tests.
        countsTowardEvaluation:
          type: boolean
          description: Whether this submission counts toward the student's monthly evaluation. False until the mentor both scores and ticks it.
          examples:
            - true
```

- [ ] **Step 2: Add `StudentEntry`, directly after `Entry`**

```yaml
    StudentEntry:
      type: object
      title: StudentEntry
      description: |
        One stored entry as a student receives it — the score,
        mentorFeedback, and countsTowardEvaluation fields on Entry are
        deliberately absent here, not merely null, so a student's own
        entry responses never carry them (no student-visible score).
      required: [id, entryDate, body, submittedAt, isLate, isExtra]
      additionalProperties: false
      properties:
        id:
          type: string
          format: uuid
          description: Entry identifier.
          examples:
            - 7be9f1d2-3c44-4f8a-9a01-2b3c4d5e6f70
        entryDate:
          type: string
          format: date
          description: The civil date the entry targets.
          examples:
            - '2026-08-03'
        body:
          type: string
          description: The submitted text.
          examples:
            - Implemented the roster endpoint and its tests.
        submittedAt:
          type: string
          format: date-time
          description: UTC instant the entry was accepted.
          examples:
            - '2026-08-03T11:30:00.000Z'
        isLate:
          type: boolean
          description: True when a required day's entry arrived after that day ended but inside grace. Weekends are never late.
          examples:
            - false
        isExtra:
          type: boolean
          description: True for entries on optional (weekend) days — FR-33.
          examples:
            - false
```

- [ ] **Step 3: Add `StudentDaySummary`, directly after `DaySummary`**

```yaml
    StudentDaySummary:
      type: object
      title: StudentDaySummary
      description: Everything on record for one student and one calendar day, as the student themselves receives it (no mentor-only entry fields).
      required: [date, status, reportStatus, reportId, absenceReason, entries]
      additionalProperties: false
      properties:
        date:
          type: string
          format: date
          description: The civil date (Asia/Colombo).
          examples:
            - '2026-07-31'
        status:
          $ref: '#/components/schemas/DayStatus'
        reportStatus:
          oneOf:
            - $ref: '#/components/schemas/ReportStatus'
            - type: 'null'
          description: Review state of the day's report, or null when no entry has created one.
        reportId:
          oneOf:
            - type: string
              format: uuid
            - type: 'null'
          description: The DailyReport id. Null until a first entry exists.
          examples:
            - 5a3c2b1d-0e9f-4a8b-b7c6-d5e4f3a2b1c0
        absenceReason:
          oneOf:
            - type: string
            - type: 'null'
          description: The recorded absence reason, when the day is marked absent.
          examples:
            - medical appointment
        entries:
          type: array
          description: The day's entries, earliest first. Empty when nothing was submitted.
          items:
            $ref: '#/components/schemas/StudentEntry'
```

- [ ] **Step 4: Add `EntryReview`, directly after `EntryCreate`**

```yaml
    EntryReview:
      type: object
      title: EntryReview
      description: A mentor's per-submission review (O-18) — replaces the score, feedback, and evaluation-inclusion flag on the target entry in full.
      required: [score, feedback, countsTowardEvaluation]
      additionalProperties: false
      properties:
        score:
          type: integer
          minimum: 0
          maximum: 100
          description: The score for this submission, 0-100.
          examples:
            - 85
        feedback:
          type: string
          maxLength: 500
          description: Feedback on this specific submission.
          examples:
            - Solid work, clean tests.
        countsTowardEvaluation:
          type: boolean
          description: Whether this submission should count toward the student's monthly evaluation.
          examples:
            - true
```

- [ ] **Step 5: Switch `GET /api/v1/me/days` to `StudentDaySummary`**

Find the `/api/v1/me/days` path's `200` response (search for `operationId: listMyDays`) and change the schema `$ref` from `DaySummary` to `StudentDaySummary`:

```yaml
        '200':
          description: The day-by-day view, oldest first.
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/StudentDaySummary'
```

(Leave the rest of that response block — description, examples, other status codes — unchanged.)

- [ ] **Step 6: Switch `POST /api/v1/entries`'s response to `StudentEntry`**

Find the `/api/v1/entries` path's `200` response (search for `operationId: createEntry`) and change the schema `$ref`:

```yaml
        '200':
          description: The stored entry, with server-computed flags.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StudentEntry'
              examples:
                onTime:
                  summary: Submitted on the target day
                  value:
                    id: 7be9f1d2-3c44-4f8a-9a01-2b3c4d5e6f70
                    entryDate: '2026-08-03'
                    body: Implemented the roster endpoint and its tests.
                    submittedAt: '2026-08-03T11:30:00.000Z'
                    isLate: false
                    isExtra: false
```

(Only the `$ref` line changes — the example is unchanged since `StudentEntry`'s shape matches the old `Entry` shape exactly.)

- [ ] **Step 7: Add the new path, directly after `/api/v1/entries`'s block**

```yaml
  /api/v1/entries/{id}/review:
    put:
      operationId: reviewEntry
      summary: Score and give feedback on one submission
      description: |
        A mentor's per-submission review (O-18): a score (0-100), free-text
        feedback, and whether it counts toward the student's monthly
        evaluation. Full replace on every call, same convention as
        upsertDayRecord — there is one review per entry, not a history.
        Rejected once the entry's day is EVALUATED (409) — corrections
        happen at the monthly evaluation, same as every other locked
        per-day mentor write (FR-20).

        This replaces the AI-scored-cycle model FR-22-24 originally
        specified; see O-18.
      tags: [Reviews]
      parameters:
        - name: id
          in: path
          required: true
          description: The entry id.
          schema:
            type: string
            format: uuid
            examples:
              - 7be9f1d2-3c44-4f8a-9a01-2b3c4d5e6f70
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/EntryReview'
      responses:
        '200':
          description: The entry with its stored review.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Entry'
              examples:
                reviewed:
                  summary: A scored, counted submission
                  value:
                    id: 7be9f1d2-3c44-4f8a-9a01-2b3c4d5e6f70
                    entryDate: '2026-08-03'
                    body: Implemented the roster endpoint and its tests.
                    submittedAt: '2026-08-03T11:30:00.000Z'
                    isLate: false
                    isExtra: false
                    score: 85
                    mentorFeedback: Solid work, clean tests.
                    countsTowardEvaluation: true
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
        '409':
          $ref: '#/components/responses/Conflict'
        '500':
          $ref: '#/components/responses/InternalServerError'
```

- [ ] **Step 8: Lint and regenerate**

```powershell
pnpm spec:lint
```

Expected: zero errors, zero warnings (`recommended-strict` — if `no-unused-components` complains, confirm every new schema is referenced by the paths above; if the four-response assertion complains about the new path, confirm it has 200/400/401/500 at minimum, which it does).

```powershell
pnpm generate
```

Expected: `packages/types/src/schema.ts` and `packages/client/src` regenerate with no errors, now exporting `reviewEntry` and the `StudentEntry`/`StudentDaySummary`/`EntryReview` types.

- [ ] **Step 9: Commit**

```bash
git add spec/openapi.yaml
git commit -m "feat(spec): add PUT /entries/{id}/review and the Entry/StudentEntry split"
```

(`packages/types`/`packages/client` are git-ignored — nothing to add there.)

---

### Task 4: Route handlers — `toApiEntryForStudent`, `toApiStudentDay`, and the review endpoint

**Files:**
- Modify: `apps/api/src/routes/entries.ts`
- Modify: `apps/api/src/routes/me-days.ts`
- Modify: `apps/api/src/routes/schemas.ts`
- Modify: `apps/api/src/routes/reviews.ts`

**Interfaces:**
- Consumes: `EntryRepo.reviewEntry` (Task 2), the regenerated `components["schemas"]` types (Task 3).
- Produces: `toApiEntryForStudent(e: EntryRecord): ApiStudentEntry` (in `entries.ts`, exported for `me-days.ts`), `toApiStudentDay(v: DayView): ApiStudentDaySummary` (in `me-days.ts`), `ENTRY_REVIEW_BODY` (in `schemas.ts`), and the `PUT /api/v1/entries/{id}/review` handler (in `reviews.ts`).

- [ ] **Step 1: Split `toApiEntry` in `apps/api/src/routes/entries.ts`**

Replace the file's type alias and `toApiEntry` function:

```ts
type ApiEntry = components["schemas"]["Entry"];
type ApiStudentEntry = components["schemas"]["StudentEntry"];
```

```ts
export function toApiEntry(e: EntryRecord): ApiEntry {
  return {
    id: e.id,
    entryDate: e.entryDate,
    body: e.body,
    submittedAt: e.submittedAt.toISOString(),
    isLate: e.isLate,
    isExtra: e.isExtra,
    score: e.score,
    mentorFeedback: e.mentorFeedback,
    countsTowardEvaluation: e.countsTowardEvaluation,
  };
}

/**
 * The student-safe view of an entry — score, mentorFeedback, and
 * countsTowardEvaluation are omitted from the object entirely (not set to
 * null), so JSON.stringify drops the keys rather than emitting them as
 * null. Used for POST /api/v1/entries's own response (a student's own
 * submission) and, via me-days.ts, GET /api/v1/me/days.
 */
export function toApiEntryForStudent(e: EntryRecord): ApiStudentEntry {
  return {
    id: e.id,
    entryDate: e.entryDate,
    body: e.body,
    submittedAt: e.submittedAt.toISOString(),
    isLate: e.isLate,
    isExtra: e.isExtra,
  };
}
```

Update the `POST /api/v1/entries` handler's return to use the new function:

```ts
  app.post<{ Body: components["schemas"]["EntryCreate"] }>(
    "/api/v1/entries",
    { schema: { body: ENTRY_CREATE_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiStudentEntry> => {
      requireStudent(req);
      const entry = await opts.entryRepo.addEntry({
        studentId: req.user!.id,
        entryDate: civilDate(req.body.entryDate),
        body: req.body.body,
        submittedAt: new Date(),
      });
      return toApiEntryForStudent(entry);
    },
  );
```

- [ ] **Step 2: Split `toApiDay` in `apps/api/src/routes/me-days.ts`**

Update the imports:

```ts
import { toApiEntry, toApiEntryForStudent } from "./entries.js";
```

Add the new student-day type alias and mapper, right after the existing `toApiDay`:

```ts
type ApiStudentDaySummary = components["schemas"]["StudentDaySummary"];

export function toApiStudentDay(v: DayView): ApiStudentDaySummary {
  return {
    date: v.date,
    status: v.status,
    reportId: v.reportId,
    reportStatus: v.reportStatus === null ? null : REPORT_STATUS_TO_API[v.reportStatus],
    absenceReason: v.absenceReason,
    entries: v.entries.map(toApiEntryForStudent),
  };
}
```

Update the `GET /api/v1/me/days` handler to use it:

```ts
  app.get<{ Querystring: { from?: string; to?: string } }>(
    "/api/v1/me/days",
    { schema: { querystring: DAYS_QUERY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiStudentDaySummary[]> => {
      const now = new Date();
      const { from, to } = resolveRange(req.query.from, req.query.to, now);
      const days = await opts.dayService.listDays(req.user!.id, from, to, now);
      return days.map(toApiStudentDay);
    },
  );
```

(`toApiDay` itself stays exactly as it is — `reviews.ts`'s `GET /api/v1/students/{id}/days` keeps importing and using it, unchanged, since that route is mentor-facing.)

- [ ] **Step 3: Add `ENTRY_REVIEW_BODY` to `apps/api/src/routes/schemas.ts`**

Add after `ENTRY_CREATE_BODY`:

```ts
export const ENTRY_REVIEW_BODY = {
  type: "object",
  required: ["score", "feedback", "countsTowardEvaluation"],
  additionalProperties: false,
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    feedback: { type: "string", maxLength: 500 },
    countsTowardEvaluation: { type: "boolean" },
  },
} as const;
```

- [ ] **Step 4: Add the route handler to `apps/api/src/routes/reviews.ts`**

Update the imports:

```ts
import { StudentNotFoundError, WeekendDayRecordError, EntryNotFoundError } from "../domain/errors.js";
```

Wait — `EntryNotFoundError` doesn't need importing here for a type check; it's thrown by the repo layer and caught by the problem-details plugin, same as every other domain error in this file. Do **not** add it to this import — leave `reviews.ts`'s existing error imports unchanged. (This note exists to stop an implementer from adding an unused import that ESLint will then flag.)

Update the `toApiEntry` import — it already comes from `me-days.js`'s re-export chain via `toApiDay`, but `toApiEntry` itself is imported directly for the new handler's response mapping. Add:

```ts
import { toApiEntry } from "./entries.js";
```

Add `ENTRY_REVIEW_BODY` to the existing schemas import:

```ts
import { TRANSITION_BODY, DAY_RECORD_BODY, ENTRY_REVIEW_BODY, UUID_PARAM, STUDENT_DATE_PARAM } from "./schemas.js";
```

Add the handler, after the `transition` route (`app.post(".../transition", ...)`) and before the `PUT .../day-records/:date` route:

```ts
  app.put<{ Params: { id: string }; Body: components["schemas"]["EntryReview"] }>(
    "/api/v1/entries/:id/review",
    { schema: { params: UUID_PARAM, body: ENTRY_REVIEW_BODY }, preHandler: [app.authenticate] },
    async (req): Promise<ApiEntry> => {
      requireAdmin(req);
      const entry = await opts.entryRepo.reviewEntry(req.params.id, {
        score: req.body.score,
        feedback: req.body.feedback,
        countsTowardEvaluation: req.body.countsTowardEvaluation,
      });
      return toApiEntry(entry);
    },
  );
```

- [ ] **Step 5: Typecheck**

```powershell
pnpm --filter @irp/api typecheck
```

Expected: no errors. (If `toApiEntry`'s import already existed transitively and this creates a duplicate-import error, resolve by using the single import line shown in Step 4 rather than adding a second one.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/entries.ts apps/api/src/routes/me-days.ts apps/api/src/routes/schemas.ts apps/api/src/routes/reviews.ts
git commit -m "feat(api): wire the entry review endpoint and the student-safe entry mapping"
```

---

### Task 5: Route-level integration tests

**Files:**
- Modify: `apps/api/test/reviews-endpoint.test.ts`
- Modify: `apps/api/test/entries-endpoint.test.ts` (or whichever existing file covers `POST /api/v1/entries` and `GET /api/v1/me/days` — locate it first; if no single file covers both, add to whichever covers `GET /api/v1/me/days`, and add the `POST` case to whichever covers `POST /api/v1/entries`)

**Interfaces:**
- Consumes: `buildTestServer`, `resetDb`, `signToken`, `dbUrl` (existing test helpers), the live route from Task 4.

- [ ] **Step 1: Locate the existing entries/me-days test file**

```powershell
Get-ChildItem apps/api/test -Filter "*entr*"
Get-ChildItem apps/api/test -Filter "*me-days*"
```

Read whichever file(s) exist and confirm the exact `describe`/`it` structure and the `bearer`/`signToken`/`student`/`mentor` helper shapes already in use there (they should match the ones in `reviews-endpoint.test.ts`, shown in Task 2's step 2 — adjust the snippets below to that file's local helper names if they differ).

- [ ] **Step 2: Write the failing tests in `reviews-endpoint.test.ts`**

Add a new `describe("entry review", ...)` block inside the existing top-level `describe.skipIf(!dbUrl)(...)`, after the `describe("day records", ...)` block:

```ts
    describe("entry review", () => {
      async function submittedEntry(studentExternalId: string): Promise<{ studentId: string; entryId: string }> {
        const s = await student(studentExternalId);
        const target = weekdayInWindow();
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/entries",
          headers: bearer(await signToken({ oid: studentExternalId })),
          payload: { entryDate: target, body: "Work for the review test." },
        });
        expect(res.statusCode).toBe(200);
        const entry = await prisma.entry.findFirstOrThrow({ where: { studentId: s.id } });
        return { studentId: s.id, entryId: entry.id };
      }

      it("scores, feeds back, and flags an entry (200)", async () => {
        const { entryId } = await submittedEntry("rev-e1-student");
        await mentor("rev-e1-mentor");

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/entries/${entryId}/review`,
          headers: bearer(await signToken({ oid: "rev-e1-mentor" })),
          payload: { score: 85, feedback: "Solid work.", countsTowardEvaluation: true },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<{ id: string; score: number; mentorFeedback: string; countsTowardEvaluation: boolean }>();
        expect(body.score).toBe(85);
        expect(body.mentorFeedback).toBe("Solid work.");
        expect(body.countsTowardEvaluation).toBe(true);
      });

      it("rejects a score above 100 with 400", async () => {
        const { entryId } = await submittedEntry("rev-e2-student");
        await mentor("rev-e2-mentor");

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/entries/${entryId}/review`,
          headers: bearer(await signToken({ oid: "rev-e2-mentor" })),
          payload: { score: 150, feedback: "x", countsTowardEvaluation: false },
        });

        expect(res.statusCode).toBe(400);
        expect(res.headers["content-type"]).toContain("application/problem+json");
      });

      it("rejects review of an EVALUATED entry with 409 day-locked", async () => {
        const { studentId, entryId } = await submittedEntry("rev-e3-student");
        await mentor("rev-e3-mentor");
        await prisma.dailyReport.updateMany({
          where: { studentId }, data: { status: "EVALUATED", evaluatedAt: new Date() },
        });

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/entries/${entryId}/review`,
          headers: bearer(await signToken({ oid: "rev-e3-mentor" })),
          payload: { score: 50, feedback: "too late", countsTowardEvaluation: false },
        });

        expect(res.statusCode).toBe(409);
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/day-locked");
      });

      it("rejects an unknown entry id with 404 entry-not-found", async () => {
        await mentor("rev-e4-mentor");

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/entries/${UNKNOWN_UUID}/review`,
          headers: bearer(await signToken({ oid: "rev-e4-mentor" })),
          payload: { score: 50, feedback: "x", countsTowardEvaluation: false },
        });

        expect(res.statusCode).toBe(404);
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/entry-not-found");
      });

      it("rejects a student token with 403 admin-only", async () => {
        const { entryId } = await submittedEntry("rev-e5-student");

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/entries/${entryId}/review`,
          headers: bearer(await signToken({ oid: "rev-e5-student" })),
          payload: { score: 50, feedback: "x", countsTowardEvaluation: false },
        });

        expect(res.statusCode).toBe(403);
        const body = res.json<ProblemLike>();
        expect(body.type).toBe("https://irp.bistec.example/problems/admin-only");
      });

      it("countsTowardEvaluation defaults false at creation and stays false until explicitly set true", async () => {
        const { entryId } = await submittedEntry("rev-e6-student");
        await mentor("rev-e6-mentor");

        const created = await prisma.entry.findUniqueOrThrow({ where: { id: entryId } });
        expect(created.countsTowardEvaluation).toBe(false);
        expect(created.score).toBeNull();

        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/entries/${entryId}/review`,
          headers: bearer(await signToken({ oid: "rev-e6-mentor" })),
          payload: { score: 60, feedback: "borderline", countsTowardEvaluation: false },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ countsTowardEvaluation: boolean }>().countsTowardEvaluation).toBe(false);

        const stillFalse = await prisma.entry.findUniqueOrThrow({ where: { id: entryId } });
        expect(stillFalse.countsTowardEvaluation).toBe(false);
      });

      it("GET /students/:id/days returns the three new fields on a reviewed entry (mentor view)", async () => {
        const { studentId, entryId } = await submittedEntry("rev-e7-student");
        await mentor("rev-e7-mentor");
        const bearerHeader = bearer(await signToken({ oid: "rev-e7-mentor" }));

        const reviewRes = await app.inject({
          method: "PUT",
          url: `/api/v1/entries/${entryId}/review`,
          headers: bearerHeader,
          payload: { score: 92, feedback: "excellent", countsTowardEvaluation: true },
        });
        expect(reviewRes.statusCode).toBe(200);

        const target = weekdayInWindow();
        const res = await app.inject({
          method: "GET",
          url: `/api/v1/students/${studentId}/days?from=${target}&to=${target}`,
          headers: bearerHeader,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<{ entries: { score: number; mentorFeedback: string; countsTowardEvaluation: boolean }[] }[]>();
        expect(body[0]!.entries[0]!.score).toBe(92);
        expect(body[0]!.entries[0]!.mentorFeedback).toBe("excellent");
        expect(body[0]!.entries[0]!.countsTowardEvaluation).toBe(true);
      });
    });
```

- [ ] **Step 3: Write the failing "score never reaches a student" test**

In whichever file covers `GET /api/v1/me/days` (or add a new small file `apps/api/test/me-days-student-safety.test.ts` if none isolates it cleanly — follow the exact `describe.skipIf(!dbUrl)` / `buildTestServer` / `resetDb` scaffold from `reviews-endpoint.test.ts`'s top if creating a new file), add:

```ts
it("never includes score/countsTowardEvaluation in a student's own /me/days response, not even as null", async () => {
  const s = await student("safety-1-student");
  const m = await mentor("safety-1-mentor");
  const target = weekdayInWindow();

  const entryRes = await app.inject({
    method: "POST",
    url: "/api/v1/entries",
    headers: bearer(await signToken({ oid: "safety-1-student" })),
    payload: { entryDate: target, body: "should stay score-free" },
  });
  expect(entryRes.statusCode).toBe(200);
  expect(entryRes.json()).not.toHaveProperty("score");
  expect(entryRes.json()).not.toHaveProperty("countsTowardEvaluation");

  const entry = await prisma.entry.findFirstOrThrow({ where: { studentId: s.id } });
  const reviewRes = await app.inject({
    method: "PUT",
    url: `/api/v1/entries/${entry.id}/review`,
    headers: bearer(await signToken({ oid: "safety-1-mentor" })),
    payload: { score: 77, feedback: "reviewed", countsTowardEvaluation: true },
  });
  expect(reviewRes.statusCode).toBe(200);

  const meDaysRes = await app.inject({
    method: "GET",
    url: `/api/v1/me/days?from=${target}&to=${target}`,
    headers: bearer(await signToken({ oid: "safety-1-student" })),
  });
  expect(meDaysRes.statusCode).toBe(200);
  const day = meDaysRes.json<{ entries: Record<string, unknown>[] }[]>()[0]!;
  expect(day.entries[0]).not.toHaveProperty("score");
  expect(day.entries[0]).not.toHaveProperty("countsTowardEvaluation");
  expect(day.entries[0]).not.toHaveProperty("mentorFeedback"); // not yet, per this plan's Task 3 note
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```powershell
$env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
pnpm --filter @irp/api exec vitest run test/reviews-endpoint.test.ts
```

Expected: FAIL (the route doesn't exist yet if Task 4 wasn't completed first — but Task 4 precedes this task, so at this point it should already be implemented; if these fail for a different reason than "not implemented," stop and investigate rather than proceeding).

- [ ] **Step 5: Run the tests to verify they pass**

```powershell
$env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
pnpm --filter @irp/api exec vitest run test/reviews-endpoint.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the full API test suite**

```powershell
$env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
pnpm --filter @irp/api test
```

Expected: PASS — no regression in the existing `entries`/`me-days`/`absences` suites, which were touched by Task 4's schema split.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test
git commit -m "test(api): cover the entry review endpoint and the student-safety boundary"
```

---

### Task 6: Web — the review form and its Server Action

**Files:**
- Create: `apps/web/app/(app)/review/[studentId]/entry-review-form.tsx`
- Modify: `apps/web/app/(app)/review/[studentId]/review-actions.ts`

**Interfaces:**
- Consumes: `reviewEntry` from `@irp/client` (Task 3's regenerated SDK).
- Produces: `EntryReviewForm` (client component) and `reviewEntry` (server action, name collision with the SDK import is intentional-avoiding — see Step 2's import alias), for Task 7 to wire into the page.

- [ ] **Step 1: Add the server action to `review-actions.ts`**

Add this import alongside the existing ones:

```ts
import { transitionDailyReport, upsertDayRecord, reviewEntry as reviewEntrySdk } from "@irp/client";
```

Add this function, after `saveDayRecord`:

```ts
/**
 * Driven by EntryReviewForm via plain useActionState — same reducer shape
 * as saveDayRecord. reviewEntry is a full replace (one review per entry,
 * not a merge), so this returns `{ ok: true }` on success for the same
 * reason saveDayRecord does: a silent success would look identical to a
 * defect that reverted the score/flag to their pre-review defaults.
 */
export async function reviewEntry(
  _prev: { ok: true } | { error: string } | null,
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const client = await apiClient();
  const studentId = formString(formData.get("studentId"));
  const entryId = formString(formData.get("entryId"));
  const scoreRaw = formString(formData.get("score"));
  const score = Number(scoreRaw);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    return { error: "Score must be a whole number from 0 to 100." };
  }
  const feedback = formString(formData.get("feedback"));
  const { error } = await reviewEntrySdk({
    client,
    path: { id: entryId },
    body: { score, feedback, countsTowardEvaluation: formData.get("countsTowardEvaluation") === "on" },
  });
  if (error !== undefined) return { error: problemMessage(error, "The review was not saved.") };
  revalidatePath(`/review/${studentId}`);
  return { ok: true };
}
```

- [ ] **Step 2: Write `entry-review-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { reviewEntry } from "./review-actions";

export interface EntryReviewDefaults {
  score: number | null;
  mentorFeedback: string | null;
  countsTowardEvaluation: boolean;
}

/**
 * A mentor's per-submission review (O-18) — score, feedback, and whether
 * this entry counts toward the student's monthly evaluation. Mirrors
 * DayRecordForm's shape: uncontrolled inputs seeded once from `defaults`,
 * a full-replace Server Action, and an explicit ok/error state rather than
 * a silently discarded return.
 *
 * Never rendered for an Evaluated day (FR-20 locks it) — that gate lives
 * in page.tsx, same as DayRecordForm's.
 */
export function EntryReviewForm({
  studentId,
  entryId,
  defaults,
}: {
  studentId: string;
  entryId: string;
  defaults?: EntryReviewDefaults;
}) {
  const [state, action, pending] = useActionState(reviewEntry, null);

  return (
    <form
      action={action}
      className="mt-2 flex flex-col gap-2 border-t pt-2"
      style={{ borderColor: "var(--line)" }}
    >
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="entryId" value={entryId} />
      <SectionLabel>Review this submission</SectionLabel>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
          Score
          <input
            type="number"
            name="score"
            min={0}
            max={100}
            step={1}
            defaultValue={defaults?.score ?? ""}
            aria-label={`Score for entry ${entryId}`}
            className="control w-20"
          />
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
          <input
            type="checkbox"
            name="countsTowardEvaluation"
            defaultChecked={defaults?.countsTowardEvaluation ?? false}
          />
          Counts toward evaluation
        </label>
      </div>
      <input
        name="feedback"
        maxLength={500}
        defaultValue={defaults?.mentorFeedback ?? ""}
        placeholder="Feedback on this submission"
        aria-label={`Feedback for entry ${entryId}`}
        className="control"
      />
      {state !== null && "error" in state && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
          {state.error ?? "Something went wrong."}
        </p>
      )}
      {state !== null && "ok" in state && (
        <p role="status" className="text-sm" style={{ color: "var(--st-ok)" }}>Review saved.</p>
      )}
      <div>
        <Button type="submit" variant="quiet" loading={pending}>
          Save review
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck**

```powershell
pnpm --filter @irp/web typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/review/[studentId]/entry-review-form.tsx" "apps/web/app/(app)/review/[studentId]/review-actions.ts"
git commit -m "feat(web): add the per-entry review form and its Server Action"
```

---

### Task 7: Wire the review form into the review page

**Files:**
- Modify: `apps/web/app/(app)/review/[studentId]/page.tsx`

**Interfaces:**
- Consumes: `EntryReviewForm` (Task 6).

- [ ] **Step 1: Import the new component**

Add to the imports:

```ts
import { EntryReviewForm } from "./entry-review-form";
```

- [ ] **Step 2: Render it under each entry**

Find the existing `day.entries.map((entry) => ( ... ))` block (in the middle of the day `Panel`'s children) and add `EntryReviewForm` after each entry's existing row, gated on the day not being locked:

```tsx
                {day.entries.map((entry) => (
                  <div key={entry.id} className="mb-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="prose" style={{ color: "var(--ink)" }}>{entry.body}</p>
                      <div
                        className="flex shrink-0 items-center gap-2 text-sm"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        <span>{ENTRY_TIME_FORMAT.format(new Date(entry.submittedAt))}</span>
                        <StatusPill status={entry.isLate ? "late" : entry.isExtra ? "extra" : "onTime"} />
                      </div>
                    </div>
                    {day.reportStatus !== "Evaluated" && (
                      <EntryReviewForm
                        studentId={studentId}
                        entryId={entry.id}
                        defaults={{
                          score: entry.score,
                          mentorFeedback: entry.mentorFeedback,
                          countsTowardEvaluation: entry.countsTowardEvaluation,
                        }}
                      />
                    )}
                  </div>
                ))}
```

This replaces the existing `<div key={entry.id} className="mb-3 flex items-start justify-between gap-3">...</div>` block — the outer `flex items-start justify-between` wrapper moves one level in, around just the body/time/status row, so the new form can sit below it inside the same per-entry `<div>`.

- [ ] **Step 3: Typecheck and build**

```powershell
pnpm --filter @irp/web typecheck
pnpm --filter @irp/web build
```

Expected: both succeed. (Recall the house rule: `tsc` alone is not sufficient/trustworthy for `apps/web` — the `build` step is required, per `CLAUDE.md`'s Plan-3 lessons.)

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/review/[studentId]/page.tsx"
git commit -m "feat(web): show the per-entry review form on the review page"
```

---

### Task 8: End-to-end coverage

**Files:**
- Modify: `apps/web/e2e/mentor-flows.spec.ts`

**Interfaces:**
- Consumes: the running dev server (`AUTH_DEV_BYPASS=true`), seeded demo data, `signInAsMentor`/`switchToBatch` helpers already in `apps/web/e2e/helpers.ts`.

- [ ] **Step 1: Read the existing test's full setup**

Re-read `apps/web/e2e/mentor-flows.spec.ts` lines 1–50 (imports, `signInAsMentor`, `switchToBatch`, `dayPanelByHiddenDate`/`dayPanelByLabel`/`panelDateLabel` helpers) to match this new test's locator style exactly — do not invent new locator helpers if an existing one already does the job.

- [ ] **Step 2: Write a new test, as its own `test(...)` block (not modifying the existing "roster -> review -> record -> transition -> lock" test, to avoid destabilizing its already-precise locator sequencing)**

Add, inside the existing `test.describe("mentor flows (dev-admin-1)", ...)` block, after the "roster -> review -> record -> transition -> lock" test:

```ts
  test("scores and gives feedback on a submission, and it persists across reload", async ({ page }) => {
    await signInAsMentor(page);
    await page.goto("/roster");
    await switchToBatch(page, SEED_BATCH_NAMES.B);

    const chamodiRow = page.locator("table tbody tr").filter({ hasText: "Chamodi Herath" });
    await chamodiRow.getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL(/\/review\//);

    const scoreInput = page.getByRole("spinbutton", { name: /^Score for entry/ }).first();
    await expect(scoreInput).toBeVisible();
    const feedbackInput = page.getByRole("textbox", { name: /^Feedback for entry/ }).first();
    const countsCheckbox = page
      .locator("form", { has: scoreInput })
      .getByRole("checkbox", { name: "Counts toward evaluation" });

    await scoreInput.fill("85");
    await feedbackInput.fill("E2E review feedback");
    await countsCheckbox.check();
    await page.locator("form", { has: scoreInput }).getByRole("button", { name: "Save review" }).click();
    await expect(page.getByText("Review saved.")).toBeVisible();

    // Fresh GET proves persistence server-side, same standard the day-record
    // test applies (page.goto, not reload() — reload() risks resubmitting
    // the last Server Action form post as a duplicate).
    await page.goto(page.url());
    const reloadedScore = page.getByRole("spinbutton", { name: /^Score for entry/ }).first();
    await expect(reloadedScore).toHaveValue("85");
    const reloadedFeedback = page.getByRole("textbox", { name: /^Feedback for entry/ }).first();
    await expect(reloadedFeedback).toHaveValue("E2E review feedback");
    const reloadedCheckbox = page
      .locator("form", { has: reloadedScore })
      .getByRole("checkbox", { name: "Counts toward evaluation" });
    await expect(reloadedCheckbox).toBeChecked();
  });
```

- [ ] **Step 3: Run the e2e suite**

```powershell
pnpm --filter @irp/web exec playwright test mentor-flows.spec.ts
```

Expected: PASS, including the new test. (Requires `next dev` running with `AUTH_DEV_BYPASS=true` and a freshly seeded database, per `playwright.config.ts`'s existing setup — if this is the first e2e run this session, follow `ONBOARDING.md` §6/§7 first.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/mentor-flows.spec.ts
git commit -m "test(e2e): cover scoring and feedback on a submission"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/interview-and-prd.md`
- Modify: `handoff.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Add O-18 to `docs/interview-and-prd.md` §5's open-points table**

Add a new row (after O-17, which the `cycle-calendar` plan/spec owns):

```markdown
| O-18 | **Mentor-scored submissions replace AI-scored cycles.** FR-22 ("AI generates a summary") and FR-23 ("AI scores... producing a performance index") are not built; instead, a mentor scores each submission directly via `PUT /api/v1/entries/{id}/review`, and FR-24's "AI score to override" no longer has an AI score to point to | Implemented per `docs/superpowers/specs/2026-09-15-per-submission-review-design.md` — this is the one open point in this task-list sequence most needing confirmation before it's built on further (the monthly-score-calculation and monthly-winner-pdf plans both assume it holds) | Mentor/stakeholder sign-off outstanding |
```

- [ ] **Step 2: Annotate FR-22/23/24 in the same file's FR table**

Find FR-22, FR-23, and FR-24 in §3's requirements table and append a note to each description (do not delete the original text — the FR table is the historical record of what was originally specified):

```markdown
| FR-22 | At cycle close, the system generates an AI summary of the student's month from all their submissions plus the mentor's attendance and task records. *(Superseded — see O-18: no AI summary is generated; a mentor scores submissions directly.)* |
```

Apply the same `*(Superseded — see O-18: ...)*` pattern to FR-23 and the AI-score half of FR-24, using each row's own original wording as the base.

- [ ] **Step 3: Add a dated entry to `handoff.md` §1**

Add, following that section's existing entry format (a dated `###` heading with a short prose summary):

```markdown
### 2026-09-23 — Per-submission review (tasks 1-4, O-18)

`Entry` gains `score`/`mentorFeedback`/`countsTowardEvaluation`. New mentor-only
`PUT /api/v1/entries/{id}/review`, locked once the entry's day is Evaluated
(FR-20). `GET /api/v1/me/days` and a student's own `POST /api/v1/entries`
response now use a new `StudentEntry`/`StudentDaySummary` schema pair that
omits the mentor-only fields entirely, rather than sharing `Entry`/`DaySummary`
with the mentor-facing routes as before. This is the foundational slice of a
four-part sequence — `student-feedback-visibility`, `monthly-score-calculation`,
and `monthly-winner-pdf` all build on it. Logged as **O-18**: this supersedes
FR-22-24's AI-scored-cycle model with mentor-scored submissions; see
`docs/superpowers/specs/2026-09-15-per-submission-review-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/interview-and-prd.md handoff.md
git commit -m "docs: log O-18 and annotate FR-22-24 as superseded"
```

---

### Task 10: Full verification pass and PR

**Files:** None — verification only.

- [ ] **Step 1: Run the complete gate set**

```powershell
$env:DATABASE_URL = "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public"
pnpm spec:lint
pnpm generate
pnpm typecheck
pnpm --filter @irp/web build
pnpm --filter @irp/api test
pnpm --filter @irp/web test
pnpm lint
```

Expected: every command exits 0. If `pnpm generate` produces a diff against what's already committed in a prior task's regeneration, that's expected and fine — `packages/types`/`packages/client` are git-ignored, this just confirms regeneration is still clean.

- [ ] **Step 2: Run the e2e suite in full (not just the one new test)**

```powershell
pnpm --filter @irp/web exec playwright test
```

Expected: PASS — confirms Task 4's `Entry`/`StudentEntry` split didn't regress any existing student- or mentor-facing flow.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin <branch-name>
gh pr create --repo HafsaRaashid/irp-progress-management --base main --title "feat: per-submission review — scoring, feedback, evaluation flag (tasks 1-4, O-18)" --body "$(cat <<'EOF'
## Summary
- Extends Entry with score, mentorFeedback, and countsTowardEvaluation (0-100 mentor score, per-submission feedback, evaluation-inclusion flag).
- New mentor-only PUT /api/v1/entries/{id}/review, locked once the entry's day is Evaluated (FR-20).
- Splits the Entry/DaySummary API schemas into mentor-facing and student-facing versions so score/countsTowardEvaluation never reach a student, including on a student's own POST /api/v1/entries response (a leak this plan catches and fixes before it ships).
- Logs O-18: this supersedes FR-22-24's AI-scored-cycle model with mentor-scored submissions — needs mentor/stakeholder sign-off, called out explicitly in the spec and in interview-and-prd.md.

Spec: docs/superpowers/specs/2026-09-15-per-submission-review-design.md
Plan: docs/superpowers/plans/2026-09-23-per-submission-review.md

## Test plan
- [x] apps/api unit + integration tests (entry-repo, reviews-endpoint)
- [x] apps/web typecheck + build
- [x] Playwright e2e (full suite, plus the new scoring/feedback test)
- [x] pnpm spec:lint zero warnings
EOF
)"
```

Expected: a PR opens against `HafsaRaashid/irp-progress-management:main`. Report the PR URL back to the user.

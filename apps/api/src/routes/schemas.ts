/**
 * Route-level JSON Schemas (2020-12), mirroring spec/openapi.yaml request
 * shapes. The spec is the source of truth; these literals exist because
 * Fastify validates per-route and the generated packages export TypeScript
 * types, not JSON Schema. A mismatch here is a bug — fix the spec first,
 * then this mirror. Keep additionalProperties: false on every body.
 */
export const ENTRY_CREATE_BODY = {
  type: "object",
  required: ["entryDate", "body"],
  additionalProperties: false,
  properties: {
    entryDate: { type: "string", format: "date" },
    body: { type: "string", minLength: 1, maxLength: 4000 },
  },
} as const;

export const ABSENCE_CREATE_BODY = {
  type: "object",
  required: ["date", "reason"],
  additionalProperties: false,
  properties: {
    date: { type: "string", format: "date" },
    reason: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

export const DATE_PARAM = {
  type: "object",
  required: ["date"],
  additionalProperties: false,
  properties: { date: { type: "string", format: "date" } },
} as const;

export const BATCH_CREATE_BODY = {
  type: "object",
  required: ["name", "startDate", "endDate"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    startDate: { type: "string", format: "date" },
    endDate: { type: "string", format: "date" },
  },
} as const;

export const UUID_PARAM = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", format: "uuid" } },
} as const;

export const ROSTER_QUERY = {
  type: "object",
  additionalProperties: false,
  properties: { date: { type: "string", format: "date" } },
} as const;

export const TRANSITION_BODY = {
  type: "object",
  required: ["to"],
  additionalProperties: false,
  properties: {
    to: { type: "string", enum: ["InReview", "Evaluated"] },
  },
} as const;

export const DAY_RECORD_BODY = {
  type: "object",
  required: ["attended", "tasksCompleted"],
  additionalProperties: false,
  properties: {
    attended: { type: "boolean" },
    tasksCompleted: { type: "boolean" },
    note: { type: "string", maxLength: 500 },
  },
} as const;

export const USER_CREATE_BODY = {
  type: "object",
  required: ["externalId", "email", "displayName", "role"],
  additionalProperties: false,
  properties: {
    externalId: { type: "string", minLength: 1, maxLength: 200 },
    email: { type: "string", format: "email" },
    displayName: { type: "string", minLength: 1, maxLength: 200 },
    role: { type: "string", enum: ["Admin", "Student"] },
    enrolment: {
      type: "object",
      required: ["batchId", "startDate"],
      additionalProperties: false,
      properties: {
        batchId: { type: "string", format: "uuid" },
        startDate: { type: "string", format: "date" },
      },
    },
  },
} as const;

export const USERS_QUERY = {
  type: "object",
  additionalProperties: false,
  properties: {
    role: { type: "string", enum: ["Admin", "Student"] },
    // The wire (coercing) ajv instance turns the querystring's "true"/"false"
    // into a boolean here — see validation.ts.
    archived: { type: "boolean" },
  },
} as const;

export const TRANSFER_BODY = {
  type: "object",
  required: ["toBatchId", "effectiveDate"],
  additionalProperties: false,
  properties: {
    toBatchId: { type: "string", format: "uuid" },
    effectiveDate: { type: "string", format: "date" },
  },
} as const;

export const CYCLE_QUERY = {
  type: "object",
  additionalProperties: false,
  // The wire (coercing) ajv instance turns the querystring's "2" into a
  // number here — see validation.ts, and the note in CLAUDE.md about why a
  // coercing compiler exists for querystrings at all.
  properties: { cycle: { type: "integer", minimum: 1 } },
} as const;

export const STUDENT_DATE_PARAM = {
  type: "object",
  required: ["id", "date"],
  additionalProperties: false,
  properties: {
    id: { type: "string", format: "uuid" },
    date: { type: "string", format: "date" },
  },
} as const;

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

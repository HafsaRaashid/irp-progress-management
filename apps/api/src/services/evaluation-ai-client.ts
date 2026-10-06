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
 * Azure OpenAI is the chosen provider (spec §0/D3), kept inside this repo's
 * own Azure tenant rather than a separate third-party one. The O-5 marker
 * itself lives on `evaluate()`'s actual `fetchImpl` call below, not here —
 * this function builds a prompt string, it doesn't call anything.
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
          "No AI provider is configured (AZURE_OPENAI_ENDPOINT/API_KEY/DEPLOYMENT).",
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

      let lastError: Error = new AiProviderUnavailableError("The AI provider did not respond.");
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // ASSUMPTION: O-5 -- this is the one call in the whole plan that
          // sends a student's real submission data to a third-party AI
          // provider, ahead of the project's required leadership sign-off.
          // See docs/superpowers/specs/2026-10-06-ai-monthly-evaluation-design.md §0.
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
          // A rejected fetchImpl (DNS failure, connection refused, timeout)
          // is the provider being unreachable, not a malformed response --
          // AiProviderUnavailableError (503), not AiResponseInvalidError
          // (502). A thrown AiResponseInvalidError from parseAndValidate
          // above is re-classified as itself on purpose: `instanceof
          // AiResponseInvalidError` wins over the network-failure default.
          lastError = err instanceof AiResponseInvalidError
            ? err
            : new AiProviderUnavailableError(
                `Azure OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`,
              );
        }
      }
      throw lastError;
    },
  };
}

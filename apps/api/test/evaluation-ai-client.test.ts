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

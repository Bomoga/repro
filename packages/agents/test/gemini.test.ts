import * as z from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  GeminiError,
  MemoryInteractionLog,
  RequestBudget,
  createGeminiClient,
  isBudgetExhausted,
  isDailyQuotaExhausted,
  modelFor,
  parseStructured,
  toGeminiSchema,
  type InteractionsSdk,
} from "../src/gemini.js";

/** Replays `create` outcomes in order; `polls` holds what successive `get` calls return. */
function fakeSdk(...outcomes: (unknown | Error)[]) {
  const calls: { params: Record<string, unknown>; options?: Record<string, unknown> }[] = [];
  const polls: (unknown | Error)[] = [];
  const cancelled: string[] = [];
  const sdk: InteractionsSdk = {
    interactions: {
      create: vi.fn(async (params, options) => {
        calls.push({ params, options });
        const next = outcomes.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
      get: vi.fn(async () => {
        const next = polls.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
      cancel: vi.fn(async (id: string) => {
        cancelled.push(id);
      }),
    },
  };
  return { sdk, calls, polls, cancelled };
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

const completed = {
  id: "int-1",
  model: "gemini-3.8-flash",
  status: "completed",
  output_text: '{"ok":true}',
  steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "text", text: '{"ok":true}' }] }],
  usage: { total_input_tokens: 10, total_output_tokens: 5, total_cached_tokens: 0, total_thought_tokens: 3 },
};

describe("modelFor", () => {
  it("defaults to section 10's table and honours the env overrides", () => {
    expect(modelFor("diagnose", {})).toBe("gemini-3.1-pro-preview");
    expect(modelFor("challenger", {})).toBe("gemini-3.1-pro-preview");
    expect(modelFor("repair", {})).toBe("gemini-3.8-flash");
    expect(modelFor("narrator", {})).toBe("gemini-3.8-flash");
    expect(modelFor("diagnose", { REPRO_MODEL_DIAGNOSE: "gemini-3.8-flash" })).toBe("gemini-3.8-flash");
  });
});

describe("createGeminiClient", () => {
  it("sends the role's model, thinking level, tools, schema, and chain id every turn", async () => {
    const { sdk, calls } = fakeSdk(completed);
    const client = createGeminiClient({ sdk, env: { REPRO_MODEL_REPAIR: "gemini-3.8-flash" } });
    await client.interact({
      role: "repair",
      systemInstruction: "sys",
      input: [
        { type: "function_result", callId: "c1", name: "read_file", result: "text" },
        { type: "text", text: "continue" },
      ],
      previousInteractionId: "int-0",
      tools: [{ name: "read_file", description: "d", parameters: { type: "object" } }],
      responseSchema: { type: "object" },
    });
    expect(calls[0]!.params).toEqual({
      model: "gemini-3.8-flash",
      system_instruction: "sys",
      input: [
        { type: "function_result", call_id: "c1", name: "read_file", result: "text" },
        { type: "user_input", content: [{ type: "text", text: "continue" }] },
      ],
      generation_config: { thinking_level: "high" },
      previous_interaction_id: "int-0",
      tools: [{ type: "function", name: "read_file", description: "d", parameters: { type: "object" } }],
      response_format: { type: "text", mime_type: "application/json", schema: { type: "object" } },
    });
    // The wrapper owns retries; the SDK's own are switched off.
    expect(calls[0]!.options).toMatchObject({ maxRetries: 0 });
  });

  it("uses low thinking for the narrator", async () => {
    const { sdk, calls } = fakeSdk(completed);
    await createGeminiClient({ sdk, env: {} }).interact({ role: "narrator", systemInstruction: "s", input: "i" });
    expect(calls[0]!.params.generation_config).toEqual({ thinking_level: "low" });
  });

  it("normalizes the response, including function calls and usage", async () => {
    const { sdk } = fakeSdk({
      id: "int-2",
      model: "models/gemini-3.8-flash",
      status: "requires_action",
      steps: [
        { type: "thought" },
        { type: "function_call", id: "call-1", name: "read_file", arguments: { path: "src/db.js" } },
      ],
    });
    const response = await createGeminiClient({ sdk, env: {} }).interact({ role: "repair", systemInstruction: "s", input: "i" });
    expect(response).toMatchObject({
      interactionId: "int-2",
      model: "gemini-3.8-flash",
      status: "requires_action",
      outputText: "",
      functionCalls: [{ id: "call-1", name: "read_file", arguments: { path: "src/db.js" } }],
    });
  });

  it("drops the default_api namespace Gemini sometimes puts on a call's name", async () => {
    const { sdk } = fakeSdk({
      id: "int-3",
      status: "requires_action",
      steps: [
        { type: "function_call", id: "call-1", name: "default_api:rerun_detector", arguments: {} },
        { type: "function_call", id: "call-2", name: "default_api.run_tests", arguments: {} },
      ],
    });
    const response = await createGeminiClient({ sdk, env: {} }).interact({ role: "repair", systemInstruction: "s", input: "i" });
    expect(response.functionCalls.map((call) => call.name)).toEqual(["rerun_detector", "run_tests"]);
  });

  it("retries 429 and 5xx with backoff and logs every attempt", async () => {
    const { sdk } = fakeSdk(httpError(429, "Resource exhausted, please retry in 1.5s"), httpError(503, "unavailable"), completed);
    const log = new MemoryInteractionLog();
    const sleeps: number[] = [];
    const client = createGeminiClient({ sdk, env: {}, log, sleep: async (ms) => void sleeps.push(ms) });
    const response = await client.interact({ role: "diagnose", systemInstruction: "s", input: "i", label: "t" });
    expect(response.outputText).toBe('{"ok":true}');
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(1500); // honours the server's retry hint
    expect(log.entries.map((e) => [e.attempt, e.error?.status ?? "ok"])).toEqual([
      [1, 429],
      [2, 503],
      [3, "ok"],
    ]);
    expect(log.entries[2]!.request.systemInstruction).toBe("s");
  });

  it("spends exactly one request per interaction by default", async () => {
    const { sdk, calls } = fakeSdk(completed);
    await createGeminiClient({ sdk, env: {}, timeoutMs: 123_000 }).interact({ role: "diagnose", systemInstruction: "s", input: "i" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params.background).toBeUndefined();
    expect(calls[0]!.options).toMatchObject({ maxRetries: 0, timeout: 123_000 });
    expect(sdk.interactions.get).not.toHaveBeenCalled();
  });

  it("retries a connection dropped mid-response", async () => {
    const dropped = Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET", message: "other side closed" } });
    const { sdk, calls } = fakeSdk(dropped, completed);
    const response = await createGeminiClient({ sdk, env: {}, sleep: async () => {} }).interact({ role: "diagnose", systemInstruction: "s", input: "i" });
    expect(response.status).toBe("completed");
    expect(calls).toHaveLength(2);
  });

  it("in background transport, polls until the interaction leaves the pending states", async () => {
    const { sdk, polls, calls } = fakeSdk({ id: "int-bg", status: "in_progress", steps: [] });
    polls.push({ id: "int-bg", status: "queued", steps: [] }, completed);
    const sleeps: number[] = [];
    const response = await createGeminiClient({
      sdk,
      env: { REPRO_GEMINI_TRANSPORT: "background" },
      sleep: async (ms) => void sleeps.push(ms),
    }).interact({ role: "diagnose", systemInstruction: "s", input: "i" });
    expect(calls[0]!.params.background).toBe(true);
    expect(response.status).toBe("completed");
    expect(response.outputText).toBe('{"ok":true}');
    expect(sdk.interactions.get).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([10_000, 10_000]);
  });

  it("in background transport, rides out a dropped poll and retries a dropped create", async () => {
    const dropped = Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET", message: "other side closed" } });
    const { sdk, polls } = fakeSdk(dropped, { id: "int-3", status: "in_progress", steps: [] });
    polls.push(new TypeError("fetch failed"), completed);
    const response = await createGeminiClient({ sdk, env: {}, transport: "background", sleep: async () => {} }).interact({
      role: "diagnose",
      systemInstruction: "s",
      input: "i",
    });
    expect(response.status).toBe("completed");
    expect(sdk.interactions.create).toHaveBeenCalledTimes(2);
  });

  it("cancels an interaction that outlives its deadline", async () => {
    const { sdk, cancelled } = fakeSdk({ id: "int-slow", status: "in_progress", steps: [] });
    const client = createGeminiClient({ sdk, env: {}, transport: "background", timeoutMs: -1, retry: { maxAttempts: 1 }, sleep: async () => {} });
    await expect(client.interact({ role: "diagnose", systemInstruction: "s", input: "i" })).rejects.toMatchObject({
      retryable: true,
      message: expect.stringContaining("did not finish"),
    });
    expect(cancelled).toEqual(["int-slow"]);
  });

  it("fails fast on a per-day quota instead of backing off", async () => {
    const { sdk } = fakeSdk(httpError(429, "Rate limit exceeded (limit: 0 requests per day on Free Tier)"));
    const sleep = vi.fn(async () => {});
    const client = createGeminiClient({ sdk, env: {}, sleep });
    const failure = await client.interact({ role: "diagnose", systemInstruction: "s", input: "i" }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "GeminiError", status: 429, retryable: false });
    expect(isDailyQuotaExhausted(failure)).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
    // A per-minute 429 is worth waiting out, so it isn't a spent daily quota.
    expect(isDailyQuotaExhausted(new GeminiError("Resource exhausted, please retry in 1.5s", 429, true))).toBe(false);
  });

  it("reads the API's own message out of the error body to spot a per-day quota", async () => {
    const generic = Object.assign(new Error('429 API error occurred: {"httpMeta":{}}'), {
      status: 429,
      body: JSON.stringify({ error: { message: "Rate limit exceeded for model gemini-3.8-flash (limit: 20 requests per day on Free Tier).", code: "rate_limit_exceeded" } }),
    });
    const { sdk, calls } = fakeSdk(generic);
    await expect(
      createGeminiClient({ sdk, env: {}, sleep: async () => {} }).interact({ role: "repair", systemInstruction: "s", input: "i" }),
    ).rejects.toMatchObject({ retryable: false, message: expect.stringContaining("20 requests per day") });
    expect(calls).toHaveLength(1);
  });

  it("surfaces a depleted-credits 402 without retrying, even when the body is an array", async () => {
    const depleted = Object.assign(new Error('402 API error occurred: {"httpMeta":{}}'), {
      status: 402,
      body: JSON.stringify([{ error: { code: 402, message: "Your prepayment credits are depleted.", status: "RESOURCE_EXHAUSTED" } }]),
    });
    const { sdk, calls } = fakeSdk(depleted);
    await expect(
      createGeminiClient({ sdk, env: {}, sleep: async () => {} }).interact({ role: "repair", systemInstruction: "s", input: "i" }),
    ).rejects.toMatchObject({ status: 402, retryable: false, message: expect.stringContaining("prepayment credits are depleted") });
    expect(calls).toHaveLength(1);
  });

  it("does not retry client errors and gives up after maxAttempts", async () => {
    const bad = fakeSdk(httpError(400, "invalid schema"));
    await expect(
      createGeminiClient({ sdk: bad.sdk, env: {} }).interact({ role: "repair", systemInstruction: "s", input: "i" }),
    ).rejects.toBeInstanceOf(GeminiError);
    expect(bad.calls).toHaveLength(1);

    const flaky = fakeSdk(httpError(500, "a"), httpError(500, "b"), httpError(500, "c"));
    await expect(
      createGeminiClient({ sdk: flaky.sdk, env: {}, retry: { maxAttempts: 3 }, sleep: async () => {} }).interact({
        role: "repair",
        systemInstruction: "s",
        input: "i",
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(flaky.calls).toHaveLength(3);
  });
});

describe("the request budget", () => {
  const ask = (role: "diagnose" | "challenger" | "repair" | "narrator") => ({ role, systemInstruction: "s", input: "i" });

  it("counts every request to a Pro-tier model, retries included, and refuses to send the one past the cap", async () => {
    const { sdk, calls } = fakeSdk(httpError(503, "unavailable"), completed, completed, completed, completed);
    const budget = new RequestBudget(3);
    const log = new MemoryInteractionLog();
    const sleep = vi.fn(async () => {});
    const client = createGeminiClient({ sdk, env: {}, budget, log, sleep });

    await client.interact(ask("diagnose")); // a 503, then its retry: two requests
    await client.interact(ask("repair")); // Flash: counted, not capped
    await client.interact(ask("challenger"));
    expect(budget.proRequests).toBe(3);
    expect(budget.remaining).toBe(0);

    sleep.mockClear();
    const failure = await client.interact(ask("challenger")).catch((error: unknown) => error);
    expect(isBudgetExhausted(failure)).toBe(true);
    expect(failure).toMatchObject({ name: "RequestBudgetExhaustedError", retryable: false, limit: 3, model: "gemini-3.1-pro-preview" });
    expect(sleep).not.toHaveBeenCalled(); // not retried
    expect(calls).toHaveLength(4); // the refused request never went out
    expect(log.entries.at(-1)?.error?.message).toContain("budget of 3 Pro-tier requests is spent");
    expect(budget.requestsByModel()).toEqual({ "gemini-3.1-pro-preview": 3, "gemini-3.8-flash": 1 });

    // A spent Pro budget doesn't stop the other models.
    await expect(client.interact(ask("narrator"))).resolves.toMatchObject({ status: "completed" });
  });

  it("counts background polls, and stops polling when the budget runs out", async () => {
    const { sdk, polls } = fakeSdk({ id: "int-bg", status: "in_progress", steps: [] });
    polls.push({ id: "int-bg", status: "in_progress", steps: [] }, { id: "int-bg", status: "in_progress", steps: [] }, completed);
    const budget = new RequestBudget(3);
    const client = createGeminiClient({ sdk, env: {}, transport: "background", budget, sleep: async () => {} });
    await expect(client.interact(ask("diagnose"))).rejects.toSatisfy(isBudgetExhausted);
    expect(sdk.interactions.create).toHaveBeenCalledTimes(1);
    expect(sdk.interactions.get).toHaveBeenCalledTimes(2); // create + 2 polls = 3; the third poll wasn't sent
    expect(budget.proRequests).toBe(3);
  });

  it("follows the Pro-tier roles' env overrides to whatever model they name", async () => {
    const env = { REPRO_MODEL_DIAGNOSE: "gemini-3.8-flash", REPRO_MODEL_CHALLENGER: "gemini-3.8-flash" };
    const budget = new RequestBudget(1);
    const client = createGeminiClient({ sdk: fakeSdk(completed, completed).sdk, env, budget });
    // Repair shares the Pro roles' model now, so it spends the same quota.
    await client.interact(ask("repair"));
    await expect(client.interact(ask("repair"))).rejects.toSatisfy(isBudgetExhausted);
  });

  it("only counts when it has no cap", async () => {
    const budget = new RequestBudget();
    const client = createGeminiClient({ sdk: fakeSdk(completed, completed, completed).sdk, env: {}, budget });
    for (let i = 0; i < 3; i++) await client.interact(ask("challenger"));
    expect(budget.remaining).toBe(Infinity);
    expect(budget.requestsByModel()).toEqual({ "gemini-3.1-pro-preview": 3 });
    expect(() => new RequestBudget(0)).toThrow(/positive integer/);
    expect(() => new RequestBudget(2.5)).toThrow(/positive integer/);
  });
});

describe("structured output helpers", () => {
  const Schema = z.object({ ids: z.array(z.enum(["a", "b"])).min(1) });

  it("derives Gemini's JSON Schema from Zod", () => {
    const json = toGeminiSchema(Schema);
    expect(json.$schema).toBeUndefined();
    expect(json).toMatchObject({
      type: "object",
      properties: { ids: { type: "array", minItems: 1, items: { type: "string", enum: ["a", "b"] } } },
      required: ["ids"],
    });
  });

  it("parses with the same schema, tolerating a code fence", () => {
    expect(parseStructured('```json\n{"ids":["a"]}\n```', Schema)).toEqual({ ok: true, value: { ids: ["a"] } });
    expect(parseStructured('{"ids":["c"]}', Schema).ok).toBe(false);
    expect(parseStructured("not json", Schema)).toMatchObject({ ok: false, error: expect.stringContaining("not valid JSON") });
  });
});

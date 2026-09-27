import * as z from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  GeminiError,
  MemoryInteractionLog,
  RequestBudget,
  GOOGLE_SIGN_IN_COMMAND,
  createGeminiClient,
  geminiAuthFromEnv,
  googleSignIn,
  isBudgetExhausted,
  isDailyQuotaExhausted,
  modelFor,
  parseStructured,
  toGeminiSchema,
  type GeminiRole,
  type GeminiSdkOptions,
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

/** A `createSdk` that hands back `fake`'s SDK and records the options each build was given. */
function sdkBuilder(fake = fakeSdk(completed)) {
  const built: GeminiSdkOptions[] = [];
  const createSdk = vi.fn((options: GeminiSdkOptions) => {
    built.push(options);
    return fake.sdk;
  });
  return { ...fake, built, createSdk };
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

  it("builds the SDK once, from the API key alone, and not at all without one", async () => {
    const { built, createSdk, calls } = sdkBuilder(fakeSdk(completed, completed));
    const client = createGeminiClient({ createSdk, env: { GEMINI_API_KEY: "test-key" } });
    await client.interact({ role: "repair", systemInstruction: "s", input: "i" });
    await client.interact({ role: "diagnose", systemInstruction: "s", input: "i" });
    expect(built).toStrictEqual([{ apiKey: "test-key" }]);
    expect(calls).toHaveLength(2);

    const unbuilt = sdkBuilder();
    await expect(
      createGeminiClient({ createSdk: unbuilt.createSdk, env: {} }).interact({ role: "repair", systemInstruction: "s", input: "i" }),
    ).rejects.toMatchObject({ message: "GEMINI_API_KEY is not set", retryable: false });
    expect(unbuilt.createSdk).not.toHaveBeenCalled();
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

describe("Google sign-in (REPRO_GEMINI_AUTH=google)", () => {
  const SIGN_IN = { REPRO_GEMINI_AUTH: "google", REPRO_GEMINI_QUOTA_PROJECT: "repro-demo-123" };
  const SIGNED_IN_SDK = {
    vertexai: false,
    googleAuthOptions: {
      scopes: ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/generative-language.retriever"],
    },
    httpOptions: { headers: { "x-goog-user-project": "repro-demo-123" } },
  };
  const ask = (role: GeminiRole = "diagnose") => ({ role, systemInstruction: "s", input: "i" });

  it("builds the SDK with no key, Google's scopes, the Gemini Developer API, and the quota project", async () => {
    const { built, createSdk, calls } = sdkBuilder();
    await createGeminiClient({ createSdk, env: SIGN_IN }).interact(ask());
    expect(built).toStrictEqual([SIGNED_IN_SDK]);
    expect(calls).toHaveLength(1);

    // The same from options alone.
    const fromOptions = sdkBuilder();
    await createGeminiClient({ createSdk: fromOptions.createSdk, auth: "google", quotaProject: " repro-demo-123 ", env: {} }).interact(ask());
    expect(fromOptions.built).toStrictEqual([SIGNED_IN_SDK]);
  });

  it.each([
    ["unset", {}],
    ["blank", { REPRO_GEMINI_AUTH: " " }],
    ["api-key", { REPRO_GEMINI_AUTH: "api-key" }],
  ])("leaves api-key mode as it was with REPRO_GEMINI_AUTH %s", async (_, auth) => {
    const { built, createSdk } = sdkBuilder();
    const env = { ...auth, GEMINI_API_KEY: "test-key", REPRO_GEMINI_QUOTA_PROJECT: "repro-demo-123" };
    await createGeminiClient({ createSdk, env }).interact(ask());
    expect(JSON.stringify(built)).toBe('[{"apiKey":"test-key"}]');
  });

  it("polls and cancels through the SDK it built for the sign-in", async () => {
    const fake = fakeSdk({ id: "int-bg", status: "in_progress", steps: [] }, { id: "int-slow", status: "in_progress", steps: [] });
    fake.polls.push({ id: "int-bg", status: "queued", steps: [] }, completed);
    const { built, createSdk, sdk, cancelled } = sdkBuilder(fake);
    const background = { createSdk, env: SIGN_IN, transport: "background" as const, sleep: async () => {} };
    await expect(createGeminiClient(background).interact(ask())).resolves.toMatchObject({ status: "completed" });
    await expect(createGeminiClient({ ...background, timeoutMs: -1, retry: { maxAttempts: 1 } }).interact(ask())).rejects.toMatchObject({
      message: expect.stringContaining("did not finish"),
    });
    expect(sdk.interactions.get).toHaveBeenCalledTimes(2);
    expect(cancelled).toEqual(["int-slow"]);
    // No other SDK was built, so the polls and the cancel went out with the sign-in too.
    expect(built).toStrictEqual([SIGNED_IN_SDK, SIGNED_IN_SDK]);
  });

  const GEMINI_KEY = "AIzaSyFAKE-gemini-key-0000000000000000000";
  const GOOGLE_KEY = "AIzaSyFAKE-google-key-0000000000000000000";

  it.each([
    [{ GEMINI_API_KEY: GEMINI_KEY }, "GEMINI_API_KEY is set too"],
    [{ GOOGLE_API_KEY: GOOGLE_KEY }, "GOOGLE_API_KEY is set too"],
    [{ GEMINI_API_KEY: GEMINI_KEY, GOOGLE_API_KEY: GOOGLE_KEY }, "GEMINI_API_KEY and GOOGLE_API_KEY are set too"],
  ])("refuses to sign in while an API key is set, since the SDK would send the key instead (%j)", async (keys, says) => {
    const { createSdk } = sdkBuilder();
    const log = new MemoryInteractionLog();
    const sleep = vi.fn(async () => {});
    const failure = await createGeminiClient({ createSdk, log, sleep, env: { ...SIGN_IN, ...keys } })
      .interact(ask())
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "GeminiError", retryable: false, message: expect.stringContaining(says) });
    expect(createSdk).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(log.entries.map((entry) => entry.error?.message)).toEqual([(failure as Error).message]);
    expect(JSON.stringify([String(failure), log.entries])).not.toMatch(/AIzaSyFAKE/);
  });

  it.each([
    [{ REPRO_GEMINI_AUTH: "google" }, "needs REPRO_GEMINI_QUOTA_PROJECT"],
    [{ ...SIGN_IN, REPRO_GEMINI_QUOTA_PROJECT: "My Project" }, "must be a Google Cloud project ID"],
    [{ ...SIGN_IN, GOOGLE_GENAI_DEBUG: "1" }, "GOOGLE_GENAI_DEBUG is set"],
    [{ ...SIGN_IN, REPRO_GEMINI_AUTH: "googel" }, 'REPRO_GEMINI_AUTH must be "api-key" or "google", got "googel"'],
  ])("refuses settings it can't sign in with (%j)", async (env, says) => {
    const { createSdk } = sdkBuilder();
    await expect(createGeminiClient({ createSdk, env, sleep: async () => {} }).interact(ask())).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining(says),
    });
    expect(createSdk).not.toHaveBeenCalled();
  });

  it("refuses an apiKey option alongside the sign-in", async () => {
    const { createSdk } = sdkBuilder();
    await expect(
      createGeminiClient({ createSdk, auth: "google", apiKey: GEMINI_KEY, quotaProject: "repro-demo-123", env: {} }).interact(ask()),
    ).rejects.toMatchObject({ retryable: false, message: "the apiKey option can't be combined with Google sign-in" });
    expect(createSdk).not.toHaveBeenCalled();
  });

  it("takes project IDs, domain-scoped ones, and project numbers, and never echoes a pasted credential", () => {
    for (const project of ["repro-demo-123", "example.com:repro-demo", "123456789012"]) {
      expect(googleSignIn({ REPRO_GEMINI_QUOTA_PROJECT: ` ${project} ` })).toEqual({ quotaProject: project });
    }
    expect(() => geminiAuthFromEnv({ REPRO_GEMINI_AUTH: GEMINI_KEY })).toThrow(/^REPRO_GEMINI_AUTH must be "api-key" or "google"$/);
    expect(geminiAuthFromEnv({})).toBe("api-key");
  });

  // Fake credentials in Google's formats, to show none of them gets out.
  const ACCESS_TOKEN = "ya29.a0FAKE-access-token";
  const REFRESH_TOKEN = "1//0gFAKE-refresh-token";
  const CLIENT_SECRET = "GOCSPX-FAKE-client-secret";
  const API_KEY = "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0";

  /** How the SDK throws a failure from before a request goes out, like getting an access token: wrapped twice. */
  function beforeSending(cause: Error): Error {
    const message = `Unexpected HTTP client error: ${String(cause)}`;
    const client = Object.assign(new Error(message, { cause }), { name: "UnexpectedClientError" });
    return Object.assign(new Error(message, { cause: client }), { name: "APIConnectionError" });
  }

  /** A token refresh Google refused, shaped like the auth library's error, whose config holds the request's secrets. */
  function refreshRefused(code: string, status = 400): Error {
    return Object.assign(new Error(code), {
      status,
      code: status,
      response: { status, data: { error: code, error_description: "Token has been expired or revoked." } },
      config: { data: `refresh_token=${REFRESH_TOKEN}&client_secret=${CLIENT_SECRET}&grant_type=refresh_token` },
    });
  }

  /** An API refusal as the SDK throws it, with Google's reason only in the raw body. */
  function apiRefusal(status: number, message: string, reason: string): Error {
    const body = [{ error: { code: status, message, status: status === 401 ? "UNAUTHENTICATED" : "PERMISSION_DENIED", details: [{ reason }] } }];
    return Object.assign(new Error(`${status} API error occurred: {"httpMeta":{"response":{},"request":{}}}`), { status, body: JSON.stringify(body) });
  }

  it.each<[string, Error, string, number | undefined]>([
    ["an expired sign-in", beforeSending(refreshRefused("invalid_grant")), "expired or been revoked (invalid_grant)", undefined],
    ["a refused refresh", beforeSending(refreshRefused("invalid_client", 401)), "refused to refresh the access token (invalid_client)", undefined],
    [
      "no credentials",
      beforeSending(new Error("Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.")),
      "there are no Application Default Credentials",
      undefined,
    ],
    [
      "a missing credentials file",
      beforeSending(Object.assign(new Error("Unable to read the credential file specified by the GOOGLE_APPLICATION_CREDENTIALS environment variable: The file at C:\\adc.json does not exist, or it is not a file."), { code: "ENOENT" })),
      "couldn't get an access token from the Application Default Credentials (ENOENT)",
      undefined,
    ],
    [
      "a malformed credentials file",
      beforeSending(new SyntaxError(`Unexpected token '1', "${REFRESH_TOKEN}"... is not valid JSON`)),
      "(SyntaxError)",
      undefined,
    ],
    ["a rejected token", apiRefusal(401, "Request had invalid authentication credentials.", "ACCESS_TOKEN_EXPIRED"), "Gemini rejected the access token", 401],
    ["missing scopes", apiRefusal(403, "Request had insufficient authentication scopes.", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"), "it lacks the scopes Gemini needs", 403],
    [
      "a disabled API",
      apiRefusal(403, "Generative Language API has not been used in project 123456789012 before or it is disabled.", "SERVICE_DISABLED"),
      "the Generative Language API isn't enabled in repro-demo-123",
      403,
    ],
    [
      "a missing quota project",
      apiRefusal(403, "The generativelanguage.googleapis.com API requires a quota project, which is not set by default.", "SERVICE_DISABLED"),
      "requests can't be billed to REPRO_GEMINI_QUOTA_PROJECT (repro-demo-123)",
      403,
    ],
    [
      "a quota project the account can't use",
      apiRefusal(403, "Caller does not have required permission to use project repro-demo-123.", "USER_PROJECT_DENIED"),
      "requests can't be billed to REPRO_GEMINI_QUOTA_PROJECT (repro-demo-123)",
      403,
    ],
    ["any other refusal", apiRefusal(403, "The caller does not have permission", "IAM_PERMISSION_DENIED"), "Gemini refused the signed-in account", 403],
  ])("%s stops the request without a retry, saying what to do", async (_, error, says, status) => {
    const { createSdk, calls } = sdkBuilder(fakeSdk(error));
    const log = new MemoryInteractionLog();
    const sleep = vi.fn(async () => {});
    const failure = await createGeminiClient({ createSdk, env: SIGN_IN, log, sleep })
      .interact(ask())
      .catch((e: unknown) => e);
    expect(failure).toMatchObject({ name: "GeminiError", status, retryable: false, message: expect.stringContaining(says) });
    expect((failure as Error).message).toMatch(/^Google sign-in: /);
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(log.entries.map((entry) => entry.error)).toEqual([{ status, message: (failure as Error).message }]);
  });

  it("points an expired sign-in at the exact command to run, and keeps the API's own words for a refusal", async () => {
    const expired = await createGeminiClient({ createSdk: sdkBuilder(fakeSdk(beforeSending(refreshRefused("invalid_grant")))).createSdk, env: SIGN_IN })
      .interact(ask())
      .catch((e: unknown) => e);
    expect((expired as Error).message).toContain(
      "Sign in again: gcloud auth application-default login --client-id-file=client_secret.json --scopes='https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/generative-language.retriever'",
    );
    expect(GOOGLE_SIGN_IN_COMMAND).toContain("--scopes='https://www.googleapis.com/auth/cloud-platform,");

    const disabled = apiRefusal(403, "Generative Language API has not been used in project 123456789012 before or it is disabled.", "SERVICE_DISABLED");
    await expect(
      createGeminiClient({ createSdk: sdkBuilder(fakeSdk(disabled)).createSdk, env: SIGN_IN }).interact(ask()),
    ).rejects.toMatchObject({ message: expect.stringContaining("has not been used in project 123456789012") });
  });

  it("stops polling on a sign-in failure instead of riding it out", async () => {
    const fake = fakeSdk({ id: "int-bg", status: "in_progress", steps: [] });
    fake.polls.push(beforeSending(refreshRefused("invalid_grant")), completed);
    const { createSdk, sdk } = sdkBuilder(fake);
    await expect(
      createGeminiClient({ createSdk, env: SIGN_IN, transport: "background", sleep: async () => {} }).interact(ask()),
    ).rejects.toMatchObject({ retryable: false, message: expect.stringContaining("invalid_grant") });
    expect(sdk.interactions.get).toHaveBeenCalledTimes(1);
  });

  it("never lets a credential into an error, the log, or the console", async () => {
    const failures = [
      beforeSending(refreshRefused("invalid_grant")),
      beforeSending(new SyntaxError(`Unexpected token '1', "${REFRESH_TOKEN}"... is not valid JSON`)),
      // A quote from a damaged file can hold a token's middle, which has no telltale prefix, and look transient.
      beforeSending(new SyntaxError(`Unexpected token 't', "timed out 0gFAKE-refre"... is not valid JSON`)),
      beforeSending(new Error(`something new went wrong near ${ACCESS_TOKEN} and ${CLIENT_SECRET}`)),
      Object.assign(new TypeError(`fetch failed near ${ACCESS_TOKEN}`), { cause: { code: "UND_ERR_SOCKET", message: REFRESH_TOKEN } }),
      httpError(500, `upstream echoed ${API_KEY} and ${ACCESS_TOKEN}`),
      httpError(400, `bad request quoting ${CLIENT_SECRET}`),
    ];
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    try {
      const log = new MemoryInteractionLog();
      const thrown: unknown[] = [];
      for (const error of failures) {
        const client = createGeminiClient({ createSdk: sdkBuilder(fakeSdk(error)).createSdk, env: SIGN_IN, log, retry: { maxAttempts: 1 } });
        thrown.push(await client.interact(ask()).catch((e: unknown) => e));
      }
      expect(thrown.every((error) => error instanceof GeminiError)).toBe(true);
      const everything = JSON.stringify({
        thrown: thrown.map((error) => [String(error), (error as GeminiError).message]),
        log: log.entries,
        console: consoles.flatMap((spy) => spy.mock.calls),
      });
      expect(everything).not.toMatch(/FAKE/);
      expect(everything).toContain("[redacted]"); // what passes through is masked, not dropped
    } finally {
      for (const spy of consoles) spy.mockRestore();
    }
  });

  it("keeps 429, per-day quota, and request-budget behaviour as in api-key mode", async () => {
    const perMinute = sdkBuilder(fakeSdk(httpError(429, "Resource exhausted, please retry in 1.5s"), completed));
    const sleeps: number[] = [];
    await expect(
      createGeminiClient({ createSdk: perMinute.createSdk, env: SIGN_IN, sleep: async (ms) => void sleeps.push(ms) }).interact(ask()),
    ).resolves.toMatchObject({ status: "completed" });
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(1500);

    const perDay = sdkBuilder(fakeSdk(httpError(429, "Rate limit exceeded (limit: 250 requests per day)")));
    const spent = await createGeminiClient({ createSdk: perDay.createSdk, env: SIGN_IN, sleep: async () => {} })
      .interact(ask())
      .catch((e: unknown) => e);
    expect(isDailyQuotaExhausted(spent)).toBe(true);
    expect(perDay.calls).toHaveLength(1);

    const budget = new RequestBudget(1);
    const client = createGeminiClient({ createSdk: sdkBuilder(fakeSdk(completed, completed)).createSdk, env: SIGN_IN, budget });
    await client.interact(ask("challenger"));
    await expect(client.interact(ask("challenger"))).rejects.toSatisfy(isBudgetExhausted);
  });

  it("leaves api-key mode's failures as they were", async () => {
    const disabled = apiRefusal(403, "Generative Language API has not been used in project 123456789012 before or it is disabled.", "SERVICE_DISABLED");
    const failure = await createGeminiClient({ createSdk: sdkBuilder(fakeSdk(disabled)).createSdk, env: { GEMINI_API_KEY: "test-key" } })
      .interact(ask())
      .catch((e: unknown) => e);
    expect(failure).toMatchObject({
      status: 403,
      retryable: false,
      message: '403 API error occurred: {"httpMeta":{"response":{},"request":{}}}: Generative Language API has not been used in project 123456789012 before or it is disabled.',
    });
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

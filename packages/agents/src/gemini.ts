/**
 * The only file in Repro that imports the Gemini SDK (section 10). It owns model routing,
 * structured-output schemas and parsing, retry with backoff on 429 and 5xx, and writing
 * every interaction to the run log. Everything else talks to the `GeminiClient` interface,
 * which is also what unit tests mock.
 */
import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import * as z from "zod";

export type GeminiRole = "diagnose" | "challenger" | "repair" | "narrator";
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

interface RoleConfig {
  envVar: string;
  defaultModel: string;
  thinking: ThinkingLevel;
}

// Section 10's table. Every model ID can be overridden by its env var.
export const ROLE_CONFIG: Record<GeminiRole, RoleConfig> = {
  diagnose: { envVar: "REPRO_MODEL_DIAGNOSE", defaultModel: "gemini-3.1-pro-preview", thinking: "high" },
  challenger: { envVar: "REPRO_MODEL_CHALLENGER", defaultModel: "gemini-3.1-pro-preview", thinking: "high" },
  repair: { envVar: "REPRO_MODEL_REPAIR", defaultModel: "gemini-3.8-flash", thinking: "high" },
  narrator: { envVar: "REPRO_MODEL_NARRATOR", defaultModel: "gemini-3.8-flash", thinking: "low" },
};

export function modelFor(role: GeminiRole, env: NodeJS.ProcessEnv = process.env): string {
  const config = ROLE_CONFIG[role];
  return env[config.envVar]?.trim() || config.defaultModel;
}

export interface FunctionTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface FunctionCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type InputItem =
  | { type: "text"; text: string }
  | { type: "function_result"; callId: string; name: string; result: string; isError?: boolean };

export interface InteractRequest {
  role: GeminiRole;
  systemInstruction: string;
  input: string | InputItem[];
  /** Chains onto a stored interaction. Tools, system instruction, and generation config are
   *  not carried forward by the API, so every request re-sends them. */
  previousInteractionId?: string;
  tools?: FunctionTool[];
  /** JSON Schema the response text must conform to (see `toGeminiSchema`). */
  responseSchema?: Record<string, unknown>;
  /** Tag for the run log, e.g. "diagnose#2". */
  label?: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  thoughtTokens?: number;
}

export interface InteractResponse {
  interactionId: string;
  /** Exact model ID that produced the response. */
  model: string;
  status: string;
  outputText: string;
  functionCalls: FunctionCall[];
  usage?: TokenUsage;
}

export interface GeminiClient {
  interact(request: InteractRequest): Promise<InteractResponse>;
}

export interface InteractionLogEntry {
  at: string;
  role: GeminiRole;
  model: string;
  label?: string;
  attempt: number;
  durationMs: number;
  request: {
    systemInstruction: string;
    input: string | InputItem[];
    previousInteractionId?: string;
    tools?: string[];
    responseSchema?: Record<string, unknown>;
  };
  response?: InteractResponse;
  error?: { status?: number; message: string };
}

/** Where every interaction is written. The orchestrator supplies one backed by the Run Store;
 *  Gemini's own server-side storage is not relied on for this (section 9). */
export interface InteractionLog {
  record(entry: InteractionLogEntry): void;
}

export class MemoryInteractionLog implements InteractionLog {
  readonly entries: InteractionLogEntry[] = [];
  record(entry: InteractionLogEntry): void {
    this.entries.push(entry);
  }
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

const PER_DAY_QUOTA = /per day/i;

/** A per-day quota ran out (a 429 naming a daily limit): nothing recovers it until the quota resets. */
export function isDailyQuotaExhausted(error: unknown): error is GeminiError {
  return error instanceof GeminiError && error.status === 429 && PER_DAY_QUOTA.test(error.message);
}

/** Thrown instead of sending a request the run's Pro-tier request budget doesn't cover. Never retried. */
export class RequestBudgetExhaustedError extends GeminiError {
  constructor(
    readonly limit: number,
    readonly model: string,
  ) {
    super(`the run's budget of ${limit} Pro-tier requests is spent, so the next request to ${model} wasn't sent`, undefined, false);
    this.name = "RequestBudgetExhaustedError";
  }
}

/** The run's Pro-tier request budget is spent: nothing more goes to those models in this run. */
export function isBudgetExhausted(error: unknown): error is RequestBudgetExhaustedError {
  return error instanceof RequestBudgetExhaustedError;
}

/**
 * Every HTTP request a run sends, per model, and an optional cap on the ones sent to the Pro-tier
 * models: those behind the diagnose and challenger roles, whose per-day quota is the scarce one.
 * The wrapper charges it before each request it sends (every attempt, retry, and background poll),
 * so one budget shared by all of a run's clients stops the run short of the quota instead of
 * running into it.
 */
export class RequestBudget {
  private readonly byModel = new Map<string, number>();
  private pro = 0;

  /** No `limit` means no cap: requests are only counted. */
  constructor(readonly limit?: number) {
    if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
      throw new Error(`a request budget must be a positive integer, got ${limit}`);
    }
  }

  /** Requests sent to Pro-tier models so far. */
  get proRequests(): number {
    return this.pro;
  }

  /** Pro-tier requests the cap still covers; Infinity without one. */
  get remaining(): number {
    return this.limit === undefined ? Infinity : this.limit - this.pro;
  }

  /** Requests sent so far, per model. */
  requestsByModel(): Record<string, number> {
    return Object.fromEntries(this.byModel);
  }

  /** Records a request about to go to `model`, or throws RequestBudgetExhaustedError for a Pro-tier one past the cap. */
  charge(model: string, pro: boolean): void {
    if (pro && this.remaining < 1) throw new RequestBudgetExhaustedError(this.limit!, model);
    if (pro) this.pro++;
    this.byModel.set(model, (this.byModel.get(model) ?? 0) + 1);
  }
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 2_000, maxDelayMs: 60_000 };

/** What the wrapper builds the SDK with: GoogleGenAI's own constructor options. */
export type GeminiSdkOptions = GoogleGenAIOptions;

/** The slice of the SDK this wrapper uses; tests inject a fake. */
export interface InteractionsSdk {
  interactions: {
    create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    get(id: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    cancel?(id: string): Promise<unknown>;
  };
}

/**
 * "request" (default): one blocking HTTP request per interaction, the cheapest option against
 * per-day request quotas (the free tier allows 20/day on gemini-3.8-flash). "background":
 * create in the background and poll, which survives dropped connections on multi-minute calls
 * but spends extra requests on polls; for billing-linked keys. Set via REPRO_GEMINI_TRANSPORT.
 */
export type GeminiTransport = "request" | "background";

/**
 * How requests authenticate, always to the Gemini Developer API, where the Interactions API lives
 * (never Vertex AI). Set via REPRO_GEMINI_AUTH. "api-key" (default): GEMINI_API_KEY. "google":
 * the operator's Google sign-in, the Application Default Credentials that
 * `gcloud auth application-default login` writes (or the file GOOGLE_APPLICATION_CREDENTIALS
 * names), which the SDK trades for short-lived OAuth tokens. Every request then names
 * REPRO_GEMINI_QUOTA_PROJECT in x-goog-user-project, so that project's quota and billing apply,
 * whatever quota project the credentials file names.
 */
export type GeminiAuth = "api-key" | "google";

/** The scopes Google's Gemini OAuth guide signs in with. The SDK insists on cloud-platform among them. */
export const GOOGLE_SIGN_IN_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/generative-language.retriever",
] as const;

// Built without a key, the SDK takes one from these when either is set, whatever else it's given.
const API_KEY_VARIABLES = ["GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;
// A Google Cloud project ID, domain-scoped ones included, or a project number.
const PROJECT = /^(?:[a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$|^\d+$/;

/** The auth REPRO_GEMINI_AUTH names: "api-key" when it's unset or blank, and an error for anything else it doesn't know. */
export function geminiAuthFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiAuth {
  const raw = env.REPRO_GEMINI_AUTH?.trim();
  if (!raw) return "api-key";
  if (raw === "api-key" || raw === "google") return raw;
  // Echoed only when it looks like a mistyped mode, not like something pasted into the wrong variable.
  const got = /^[a-z-]{1,20}$/i.test(raw) ? `, got "${raw}"` : "";
  throw new GeminiError(`REPRO_GEMINI_AUTH must be "api-key" or "google"${got}`, undefined, false);
}

/**
 * Google sign-in's settings, checked the same way by the wrapper before it builds the SDK and by
 * the control plane at startup: a non-retryable GeminiError for anything that would make the
 * sign-in fail, or quietly lose to an API key.
 */
export function googleSignIn(
  env: NodeJS.ProcessEnv = process.env,
  quotaProject = env.REPRO_GEMINI_QUOTA_PROJECT,
): { quotaProject: string } {
  refuseSignInConflicts(env);
  const project = quotaProject?.trim();
  if (!project) {
    throw new GeminiError(
      "REPRO_GEMINI_AUTH=google needs REPRO_GEMINI_QUOTA_PROJECT, the ID of the Google Cloud project its requests are billed to",
      undefined,
      false,
    );
  }
  if (!PROJECT.test(project)) {
    throw new GeminiError("REPRO_GEMINI_QUOTA_PROJECT must be a Google Cloud project ID (like repro-demo-123) or number", undefined, false);
  }
  return { quotaProject: project };
}

/** Throws when the environment would undo Google sign-in: a key the SDK would send instead, or the SDK's debug output, which prints the access token. */
function refuseSignInConflicts(env: NodeJS.ProcessEnv): void {
  const keys = API_KEY_VARIABLES.filter((name) => env[name]?.trim());
  if (keys.length > 0) {
    throw new GeminiError(
      `REPRO_GEMINI_AUTH=google, but ${keys.join(" and ")} ${keys.length > 1 ? "are" : "is"} set too, and the Gemini SDK would send that key instead of the Google sign-in: remove it from the environment and .env, or unset REPRO_GEMINI_AUTH to keep using the key`,
      undefined,
      false,
    );
  }
  if (env.GOOGLE_GENAI_DEBUG) {
    throw new GeminiError(
      "REPRO_GEMINI_AUTH=google, but GOOGLE_GENAI_DEBUG is set, and it makes the Gemini SDK print every request's headers, the access token among them: unset it",
      undefined,
      false,
    );
  }
}

export interface GeminiClientOptions {
  apiKey?: string;
  /** How requests authenticate; REPRO_GEMINI_AUTH when unset. */
  auth?: GeminiAuth;
  /** Google sign-in only: the project requests are billed to; REPRO_GEMINI_QUOTA_PROJECT when unset. */
  quotaProject?: string;
  log?: InteractionLog;
  retry?: Partial<RetryPolicy>;
  /** Deadline for one interaction to finish. High thinking can take minutes. */
  timeoutMs?: number;
  transport?: GeminiTransport;
  /** Charged for every request this client sends; requests to the Pro-tier roles' models count against its cap. */
  budget?: RequestBudget;
  env?: NodeJS.ProcessEnv;
  /** Used as it is: nothing gets built, so no auth setting applies. */
  sdk?: InteractionsSdk;
  /** Builds the SDK from the options the wrapper picks (default: a real GoogleGenAI); tests inject one to see them. */
  createSdk?: (options: GeminiSdkOptions) => InteractionsSdk;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

// Statuses in which the server is still working on a background interaction.
const PENDING = new Set(["in_progress", "queued"]);
const HTTP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 10_000;
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

export function createGeminiClient(options: GeminiClientOptions = {}): GeminiClient {
  const env = options.env ?? process.env;
  const log = options.log ?? new MemoryInteractionLog();
  const policy = { ...DEFAULT_RETRY, ...options.retry };
  const timeoutMs = options.timeoutMs ?? 600_000;
  const transport: GeminiTransport =
    options.transport ?? (env.REPRO_GEMINI_TRANSPORT?.trim() === "background" ? "background" : "request");
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date());
  // The models behind the Pro-tier roles, after env overrides: whatever role a request comes from,
  // it spends their quota if it goes to one of them.
  const proModels = new Set([modelFor("diagnose", env), modelFor("challenger", env)]);
  const charge = (model: string) => options.budget?.charge(model, proModels.has(model));
  let sdk = options.sdk;

  const getSdk = (): InteractionsSdk => {
    if (!sdk) {
      const build = options.createSdk ?? buildSdk;
      if ((options.auth ?? geminiAuthFromEnv(env)) === "google") {
        if (options.apiKey !== undefined) throw new GeminiError("the apiKey option can't be combined with Google sign-in", undefined, false);
        const { quotaProject } = googleSignIn(env, options.quotaProject);
        sdk = build(googleSignInSdkOptions(quotaProject));
      } else {
        const apiKey = options.apiKey ?? env.GEMINI_API_KEY;
        if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set", undefined, false);
        sdk = build({ apiKey });
      }
    }
    return sdk;
  };

  /** Runs one interaction to completion with the configured transport, charging the budget for every request. */
  const runOnce = async (params: Record<string, unknown>, model: string): Promise<unknown> => {
    const api = getSdk().interactions;
    charge(model);
    if (transport === "request") return api.create(params, { maxRetries: 0, timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    let raw = await api.create({ ...params, background: true }, { maxRetries: 0, timeout: HTTP_TIMEOUT_MS });
    let pollFailures = 0;
    while (PENDING.has(statusOf(raw))) {
      if (Date.now() > deadline) {
        const id = idOf(raw);
        // Best effort, and only when the budget covers it: otherwise the server finishes the interaction on its own.
        if (api.cancel && (!proModels.has(model) || (options.budget?.remaining ?? Infinity) >= 1)) {
          charge(model);
          await api.cancel(id).catch(() => undefined);
        }
        throw new GeminiError(`interaction ${id} did not finish within ${timeoutMs}ms`, undefined, true);
      }
      await sleep(POLL_INTERVAL_MS);
      // Outside the try: a spent budget ends the interaction, where a failed poll would be retried.
      charge(model);
      try {
        raw = await api.get(idOf(raw), undefined, { maxRetries: 0, timeout: HTTP_TIMEOUT_MS });
        pollFailures = 0;
      } catch (error) {
        const failure = classify(error);
        if (!failure.retryable || ++pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw failure;
      }
    }
    return raw;
  };

  return {
    async interact(request) {
      const model = modelFor(request.role, env);
      const params = buildParams(request, model);
      for (let attempt = 1; ; attempt++) {
        const started = Date.now();
        const entry = {
          at: now().toISOString(),
          role: request.role,
          model,
          label: request.label,
          attempt,
          request: {
            systemInstruction: request.systemInstruction,
            input: request.input,
            previousInteractionId: request.previousInteractionId,
            tools: request.tools?.map((tool) => tool.name),
            responseSchema: request.responseSchema,
          },
        };
        let failure: GeminiError;
        try {
          const response = toResponse(await runOnce(params, model), model);
          log.record({ ...entry, durationMs: Date.now() - started, response });
          if (response.status !== "failed") return response;
          failure = new GeminiError(`interaction ${response.interactionId} failed`, undefined, true);
        } catch (error) {
          failure = error instanceof GeminiError ? error : classify(error);
          log.record({
            ...entry,
            durationMs: Date.now() - started,
            error: { status: failure.status, message: failure.message },
          });
        }
        if (!failure.retryable || attempt >= policy.maxAttempts) throw failure;
        await sleep(backoffMs(attempt, failure.message, policy));
      }
    },
  };
}

/**
 * The SDK options for Google sign-in: no key, so the SDK signs in with Application Default
 * Credentials under Google's scopes; the Gemini Developer API even if GOOGLE_GENAI_USE_VERTEXAI
 * says otherwise; and the quota project on every request, polls and cancels included.
 */
function googleSignInSdkOptions(quotaProject: string): GeminiSdkOptions {
  return {
    vertexai: false,
    googleAuthOptions: { scopes: [...GOOGLE_SIGN_IN_SCOPES] },
    httpOptions: { headers: { "x-goog-user-project": quotaProject } },
  };
}

const NO_KEY_WARNING = "API key should be set when using the Gemini API.";

/** A real GoogleGenAI client, narrowed to the interactions this wrapper uses. */
function buildSdk(sdkOptions: GeminiSdkOptions): InteractionsSdk {
  let client: GoogleGenAI;
  if (sdkOptions.apiKey === undefined) {
    // Signing in. The SDK reads a key from process.env whatever env this client was given, and it
    // warns that a key should be set, which under sign-in is the point: that one line is dropped.
    refuseSignInConflicts(process.env);
    client = withoutWarning(NO_KEY_WARNING, () => new GoogleGenAI(sdkOptions));
  } else {
    client = new GoogleGenAI(sdkOptions);
  }
  return {
    interactions: {
      create: (params, requestOptions) =>
        client.interactions.create(params as unknown as Parameters<typeof client.interactions.create>[0], requestOptions),
      get: (id, params, requestOptions) => client.interactions.get(id, params, requestOptions),
      cancel: (id) => client.interactions.cancel(id),
    },
  };
}

/** Runs `build` with console.warn dropping `warning` and nothing else; `build` is synchronous, so no other code runs meanwhile. */
function withoutWarning<T>(warning: string, build: () => T): T {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (args[0] !== warning) warn.apply(console, args);
  };
  try {
    return build();
  } finally {
    console.warn = warn;
  }
}

function statusOf(raw: unknown): string {
  return String((raw as { status?: unknown } | undefined)?.status ?? "unknown");
}

function idOf(raw: unknown): string {
  return String((raw as { id?: unknown } | undefined)?.id ?? "");
}

function buildParams(request: InteractRequest, model: string): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model,
    system_instruction: request.systemInstruction,
    input: toSdkInput(request.input),
    generation_config: { thinking_level: ROLE_CONFIG[request.role].thinking },
  };
  if (request.previousInteractionId) params.previous_interaction_id = request.previousInteractionId;
  if (request.tools?.length) {
    params.tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }
  if (request.responseSchema) {
    params.response_format = { type: "text", mime_type: "application/json", schema: request.responseSchema };
  }
  return params;
}

function toSdkInput(input: string | InputItem[]): unknown {
  if (typeof input === "string") return input;
  return input.map((item) =>
    item.type === "text"
      ? { type: "user_input", content: [{ type: "text", text: item.text }] }
      : {
          type: "function_result",
          call_id: item.callId,
          name: item.name,
          result: item.result,
          ...(item.isError ? { is_error: true } : {}),
        },
  );
}

interface RawStep {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
  content?: unknown;
}

function toResponse(raw: unknown, requestedModel: string): InteractResponse {
  const r = (raw ?? {}) as {
    id?: unknown;
    model?: unknown;
    status?: unknown;
    output_text?: unknown;
    steps?: unknown;
    usage?: Record<string, unknown>;
  };
  const steps = (Array.isArray(r.steps) ? r.steps : []) as RawStep[];
  const functionCalls: FunctionCall[] = steps
    .filter((step) => step?.type === "function_call")
    .map((step) => ({
      id: String(step.id ?? ""),
      // Gemini sometimes names a call with the namespace it files declared tools under
      // ("default_api:read_file"); every tool here is declared without one.
      name: String(step.name ?? "").replace(/^default_api[:.]/, ""),
      arguments: isRecord(step.arguments) ? step.arguments : {},
    }));
  const usage = r.usage;
  return {
    interactionId: String(r.id ?? ""),
    model: typeof r.model === "string" && r.model ? r.model.replace(/^models\//, "") : requestedModel,
    status: String(r.status ?? "unknown"),
    outputText: typeof r.output_text === "string" ? r.output_text : lastModelText(steps),
    functionCalls,
    usage: usage
      ? {
          inputTokens: numberOrUndefined(usage.total_input_tokens),
          outputTokens: numberOrUndefined(usage.total_output_tokens),
          cachedTokens: numberOrUndefined(usage.total_cached_tokens),
          thoughtTokens: numberOrUndefined(usage.total_thought_tokens),
        }
      : undefined,
  };
}

function lastModelText(steps: RawStep[]): string {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;
    return (step.content as { type?: unknown; text?: unknown }[])
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");
  }
  return "";
}

function classify(error: unknown): GeminiError {
  const e = (error ?? {}) as { status?: unknown; code?: unknown; message?: unknown; cause?: unknown; body?: unknown; error?: unknown };
  const status = typeof e.status === "number" ? e.status : typeof e.code === "number" ? e.code : undefined;
  const message = [typeof e.message === "string" ? e.message : String(error), apiErrorDetail(e)].filter(Boolean).join(": ");
  if (status === 429) {
    // A per-day quota (including a limit of zero on the free tier) won't recover inside any
    // backoff window; fail fast so the caller can switch models instead of waiting.
    return new GeminiError(message, status, !PER_DAY_QUOTA.test(message));
  }
  if (status !== undefined) return new GeminiError(message, status, status >= 500);
  const cause = (e.cause ?? {}) as { code?: unknown; message?: unknown };
  const detail = `${message} ${String(cause.code ?? "")} ${String(cause.message ?? "")}`;
  const transient =
    /fetch failed|terminated|other side closed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR|socket hang up|timed? ?out/i.test(detail);
  return new GeminiError(message, undefined, transient);
}

/** The API's own error text, which the SDK keeps in the body rather than in `message`. */
function apiErrorDetail(e: { body?: unknown; error?: unknown; cause?: unknown; message?: unknown }): string {
  const candidates: unknown[] = [e.body, e.error, (e.cause as { body?: unknown } | undefined)?.body, (e.cause as { error?: unknown } | undefined)?.error];
  for (const candidate of candidates) {
    let value = candidate;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    // Some endpoints wrap the error object in a one-element array.
    if (Array.isArray(value)) value = value[0];
    const detail = (value as { error?: { message?: unknown } } | undefined)?.error?.message;
    if (typeof detail === "string" && detail && !String(e.message ?? "").includes(detail)) return detail;
  }
  return "";
}

function backoffMs(attempt: number, message: string, policy: RetryPolicy): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jittered = exponential * (0.5 + Math.random() * 0.5);
  const hinted = /retry in ([\d.]+)\s*s/i.exec(message);
  const hintMs = hinted ? Math.ceil(Number(hinted[1]) * 1000) : 0;
  return Math.min(policy.maxDelayMs, Math.max(jittered, hintMs));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** JSON Schema for Gemini's structured output, derived from a Zod schema so the two can't
 *  drift (section 4). */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parses structured output: JSON first, then the same Zod schema Gemini was given. */
export function parseStructured<T>(text: string, schema: z.ZodType<T>): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(text));
  } catch (error) {
    return { ok: false, error: `response was not valid JSON (${(error as Error).message})` };
  }
  const result = schema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: z.prettifyError(result.error) };
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

/**
 * The only file in Repro that imports the Gemini SDK (section 10). It owns model routing,
 * structured-output schemas and parsing, retry with backoff on 429 and 5xx, and writing
 * every interaction to the run log. Everything else talks to the `GeminiClient` interface,
 * which is also what unit tests mock.
 */
import { GoogleGenAI } from "@google/genai";
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

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 2_000, maxDelayMs: 60_000 };

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

export interface GeminiClientOptions {
  apiKey?: string;
  log?: InteractionLog;
  retry?: Partial<RetryPolicy>;
  /** Deadline for one interaction to finish. High thinking can take minutes. */
  timeoutMs?: number;
  transport?: GeminiTransport;
  env?: NodeJS.ProcessEnv;
  sdk?: InteractionsSdk;
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
  let sdk = options.sdk;

  const getSdk = (): InteractionsSdk => {
    if (!sdk) {
      const apiKey = options.apiKey ?? env.GEMINI_API_KEY;
      if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set", undefined, false);
      const client = new GoogleGenAI({ apiKey });
      sdk = {
        interactions: {
          create: (params, requestOptions) =>
            client.interactions.create(
              params as unknown as Parameters<typeof client.interactions.create>[0],
              requestOptions,
            ),
          get: (id, params, requestOptions) => client.interactions.get(id, params, requestOptions),
          cancel: (id) => client.interactions.cancel(id),
        },
      };
    }
    return sdk;
  };

  /** Runs one interaction to completion with the configured transport. */
  const runOnce = async (params: Record<string, unknown>): Promise<unknown> => {
    const api = getSdk().interactions;
    if (transport === "request") return api.create(params, { maxRetries: 0, timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    let raw = await api.create({ ...params, background: true }, { maxRetries: 0, timeout: HTTP_TIMEOUT_MS });
    let pollFailures = 0;
    while (PENDING.has(statusOf(raw))) {
      if (Date.now() > deadline) {
        const id = idOf(raw);
        await api.cancel?.(id).catch(() => undefined);
        throw new GeminiError(`interaction ${id} did not finish within ${timeoutMs}ms`, undefined, true);
      }
      await sleep(POLL_INTERVAL_MS);
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
          const response = toResponse(await runOnce(params), model);
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
      name: String(step.name ?? ""),
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
    return new GeminiError(message, status, !/per day/i.test(message));
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

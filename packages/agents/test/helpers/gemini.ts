import { geminiAuthFromEnv, type FunctionCall, type GeminiClient, type GeminiRole, type InteractRequest } from "../../src/gemini.js";

/**
 * Whether the real-API tests (*.int.ts) have a way in: GEMINI_API_KEY, or the Google sign-in
 * (REPRO_GEMINI_AUTH=google). They skip without either. A REPRO_GEMINI_AUTH typo throws rather than
 * skip, and with both set they run and the wrapper refuses the mix, as the control plane would.
 */
export function realGeminiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GEMINI_API_KEY) || geminiAuthFromEnv(env) === "google";
}

export type ScriptedCall = { name: string; args?: object };
/** A batch of tool calls, or a final text answer. */
export type ScriptedReply = ScriptedCall[] | { text: string };

/** Mocked wrapper: each role replays its own queue of replies and every request is recorded. */
export function scriptedGemini(script: Partial<Record<GeminiRole, ScriptedReply[]>>) {
  const requests: InteractRequest[] = [];
  const queues = new Map<string, ScriptedReply[]>(Object.entries(script).map(([role, replies]) => [role, [...(replies ?? [])]]));
  const gemini: GeminiClient = {
    async interact(request) {
      requests.push(request);
      const n = requests.length;
      const reply = queues.get(request.role)?.shift();
      if (!reply) throw new Error(`scriptedGemini: no ${request.role} reply left for request ${n}`);
      const functionCalls: FunctionCall[] = Array.isArray(reply)
        ? reply.map((call, i) => ({ id: `call-${n}-${i}`, name: call.name, arguments: { ...call.args } as Record<string, unknown> }))
        : [];
      return {
        interactionId: `int-${n}`,
        model: "gemini-test",
        status: functionCalls.length > 0 ? "requires_action" : "completed",
        outputText: Array.isArray(reply) ? "" : reply.text,
        functionCalls,
      };
    },
  };
  return {
    gemini,
    requests,
    byRole: (role: GeminiRole) => requests.filter((request) => request.role === role),
    remaining: (role: GeminiRole) => queues.get(role)?.length ?? 0,
  };
}

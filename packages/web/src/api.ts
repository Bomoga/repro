import type { Patch, Run } from "@repro/contracts";
import type { GoogleSignInStatus, Health, PullRequestMode, PatchDecision, RunDetail, RunReport, RunSummary, TrustReport } from "@repro/api";

// Same pattern as @repro/cli's client: a small typed wrapper over the tRPC HTTP endpoints, not
// a full @trpc/client, since the dashboard only ever calls these fixed procedures. Requests go
// through Vite's dev proxy (or whatever reverse proxy serves the built dashboard) at /trpc.
async function query<T>(procedure: string, input?: unknown): Promise<T> {
  const url = new URL(`/trpc/${procedure}`, window.location.origin);
  if (input !== undefined) url.searchParams.set("input", JSON.stringify(input));
  return unwrap<T>(await send(url));
}

async function mutate<T>(procedure: string, input: unknown): Promise<T> {
  return unwrap<T>(
    await send(new URL(`/trpc/${procedure}`, window.location.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export const API_UNREACHABLE = "Can't reach the Repro API.";

async function send(url: URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(API_UNREACHABLE);
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  let body: { result?: { data: T }; error?: { message: string } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // The dev proxy answers with a non-JSON 5xx while the API process is down.
    throw new Error(API_UNREACHABLE);
  }
  if (!res.ok || body.error || !body.result) throw new Error(body.error?.message ?? res.statusText);
  return body.result.data;
}

/** Mirrors the API's target grammar: absolute paths are local checkouts, everything else is GitHub. */
export function targetKindFor(ref: string): Run["target"]["kind"] {
  return ref.startsWith("/") ? "local" : "github";
}

export const api = {
  health: () => query<Health>("health"),
  summaries: () => query<RunSummary[]>("runs.summaries"),
  detail: (runId: string) => query<RunDetail>("runs.detail", { runId }),
  createRun: (targetRef: string) =>
    mutate<Run>("runs.create", { targetRef, targetKind: targetKindFor(targetRef), trigger: "manual" }),
  trustReport: (runId: string, patchId: string) => query<TrustReport>("patches.trustReport", { runId, patchId }),
  decidePatch: (patchId: string, decision: PatchDecision) => mutate<Patch>("patches.decide", { patchId, decision }),
  report: (runId: string) => query<RunReport>("report", { runId }),
  googleAccount: () => query<GoogleSignInStatus>("auth.google"),
  settings: () => query<{ pullRequestMode: PullRequestMode }>("settings.get"),
  setPullRequestMode: (mode: PullRequestMode) => mutate<{ pullRequestMode: PullRequestMode }>("settings.setPullRequestMode", { mode }),
};

/**
 * Where the browser goes to sign the control plane in to Google. The sign-in routes live on the
 * API itself (Google redirects straight back to them), so this points at the API's own origin.
 */
export function googleSignInUrl(): string {
  const origin = `${window.location.protocol}//${window.location.hostname}:4000`;
  return `${origin}/auth/google/start?return=${encodeURIComponent(window.location.href)}`;
}

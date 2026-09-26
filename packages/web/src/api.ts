import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import type { TrustReport } from "@repro/api";

// Same pattern as @repro/cli's client: a small typed wrapper over the tRPC HTTP endpoints, not
// a full @trpc/client, since the dashboard only ever calls these fixed procedures. Requests go
// through Vite's dev proxy (or whatever reverse proxy serves the built dashboard) at /trpc.
async function query<T>(procedure: string, input?: unknown): Promise<T> {
  const url = new URL(`/trpc/${procedure}`, window.location.origin);
  if (input !== undefined) url.searchParams.set("input", JSON.stringify(input));
  return unwrap<T>(await fetch(url));
}

async function mutate<T>(procedure: string, input: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(new URL(`/trpc/${procedure}`, window.location.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { result?: { data: T }; error?: { message: string } };
  if (!res.ok || body.error) throw new Error(body.error?.message ?? res.statusText);
  return body.result!.data;
}

export const api = {
  listRuns: () => query<Run[]>("runs.list"),
  getRun: (runId: string) => query<Run>("runs.get", { runId }),
  createRun: (targetRef: string) => mutate<Run>("runs.create", { targetRef, targetKind: "github", trigger: "manual" }),
  listFindings: (runId: string) => query<Finding[]>("findings.list", { runId }),
  listDiagnoses: (runId: string) => query<Diagnosis[]>("diagnoses.list", { runId }),
  listPatches: (runId: string) => query<Patch[]>("patches.list", { runId }),
  trustReport: (runId: string, patchId: string) => query<TrustReport>("patches.trustReport", { runId, patchId }),
  decidePatch: (patchId: string, decision: "merge" | "reject") => mutate<Patch>("patches.decide", { patchId, decision }),
};

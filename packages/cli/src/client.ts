import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";

// A plain fetch client against the tRPC HTTP endpoints, not @trpc/client: the CLI only ever
// calls a handful of fixed procedures, so a typed wrapper here is simpler than wiring up a
// generic tRPC client and its transformer to match the server exactly.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  private async query<T>(procedure: string, input?: unknown): Promise<T> {
    const url = new URL(`/trpc/${procedure}`, this.baseUrl);
    if (input !== undefined) url.searchParams.set("input", JSON.stringify(input));
    const res = await fetch(url);
    return this.unwrap<T>(res);
  }

  private async mutate<T>(procedure: string, input: unknown): Promise<T> {
    const url = new URL(`/trpc/${procedure}`, this.baseUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return this.unwrap<T>(res);
  }

  private async unwrap<T>(res: Response): Promise<T> {
    const body = (await res.json()) as { result?: { data: T }; error?: { message: string } };
    if (!res.ok || body.error) throw new ApiError(body.error?.message ?? res.statusText, res.status);
    return body.result!.data;
  }

  listRuns(status?: Run["status"]): Promise<Run[]> {
    return this.query("runs.list", status ? { status } : undefined);
  }

  getRun(runId: string): Promise<Run> {
    return this.query("runs.get", { runId });
  }

  createRun(targetRef: string, targetKind: "local" | "github" = "github"): Promise<Run> {
    return this.mutate("runs.create", { targetRef, targetKind, trigger: "manual" });
  }

  listFindings(runId: string): Promise<Finding[]> {
    return this.query("findings.list", { runId });
  }

  listDiagnoses(runId: string): Promise<Diagnosis[]> {
    return this.query("diagnoses.list", { runId });
  }

  listPatches(runId: string): Promise<Patch[]> {
    return this.query("patches.list", { runId });
  }

  decidePatch(patchId: string, decision: "merge" | "reject"): Promise<Patch> {
    return this.mutate("patches.decide", { patchId, decision });
  }
}

export function apiClientFromEnv(env: NodeJS.ProcessEnv = process.env): ApiClient {
  return new ApiClient(env.REPRO_API_URL ?? "http://localhost:4000");
}

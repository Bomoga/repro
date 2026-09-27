#!/usr/bin/env -S npx tsx
// Repro as an MCP server: Claude (or any MCP client) can queue scans, read runs, findings,
// diagnoses and patches, and merge or reject verified patches, all through the control plane's
// API. The inputs are the same as the dashboard's (section 8): a target ref, IDs, and
// merge/reject. Nothing here is a prompt box into Repro's own models.
//   REPRO_API_URL  the control plane's API (default http://localhost:4000)
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API = (process.env.REPRO_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

async function trpc<T>(procedure: string, input?: unknown, method: "GET" | "POST" = "GET"): Promise<T> {
  const url = new URL(`${API}/trpc/${procedure}`);
  if (method === "GET" && input !== undefined) url.searchParams.set("input", JSON.stringify(input));
  const res = await fetch(url, method === "POST" ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(input) } : undefined);
  const body = (await res.json()) as { result?: { data: T }; error?: { message: string } };
  if (!res.ok || body.error || !body.result) throw new Error(body.error?.message ?? `${res.status} ${res.statusText}`);
  return body.result.data;
}

const id = (description: string) => ({ type: "string", description });

const TOOLS = [
  {
    name: "repro_scan",
    description: "Queue a Repro scan of a repository. Repro detects issues, reproduces each one in a sandbox, then diagnoses, repairs, and verifies what reproduced.",
    inputSchema: { type: "object", properties: { target: id("owner/repo, owner/repo#branch, a github.com URL, or an absolute local path") }, required: ["target"] },
  },
  {
    name: "repro_list_runs",
    description: "List Repro's runs, newest first, with their stage, status, and finding and patch counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "repro_get_run",
    description: "One run in full: its findings (with reproduction output), diagnoses, and patches (with diffs and verification results).",
    inputSchema: { type: "object", properties: { runId: id("the run's id") }, required: ["runId"] },
  },
  {
    name: "repro_report",
    description: "A run's computed report: how many findings reproduced, patches verified, Challenger disputes, time per stage, tokens per fix.",
    inputSchema: { type: "object", properties: { runId: id("the run's id") }, required: ["runId"] },
  },
  {
    name: "repro_decide_patch",
    description: "Merge or reject a verified patch, the same decision a person makes in the dashboard's Review tab.",
    inputSchema: {
      type: "object",
      properties: { patchId: id("the patch's id"), decision: { type: "string", enum: ["merge", "reject"] } },
      required: ["patchId", "decision"],
    },
  },
];

const server = new Server({ name: "repro", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, string>;
  try {
    let result: unknown;
    switch (request.params.name) {
      case "repro_scan": {
        const target = String(args.target ?? "").trim();
        result = await trpc("runs.create", { targetRef: target, targetKind: target.startsWith("/") ? "local" : "github", trigger: "manual" }, "POST");
        break;
      }
      case "repro_list_runs":
        result = await trpc("runs.summaries");
        break;
      case "repro_get_run":
        result = await trpc("runs.detail", { runId: args.runId });
        break;
      case "repro_report":
        result = await trpc("report", { runId: args.runId });
        break;
      case "repro_decide_patch":
        result = await trpc("patches.decide", { patchId: args.patchId, decision: args.decision }, "POST");
        break;
      default:
        throw new Error(`unknown tool ${request.params.name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Repro API at ${API}: ${error instanceof Error ? error.message : String(error)}` }] };
  }
});

await server.connect(new StdioServerTransport());

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { recordPullRequestClosed } from "../src/pull-requests.ts";
import { InMemoryRunStore } from "../src/store/index.ts";
import { aDiagnosis, aReproducedFinding, aRun, aVerifiedPatch } from "./helpers/fixtures.ts";

const PR = "https://github.com/octo/example/pull/9";
const SECRET = "webhook-secret";

async function storeWithOpenPr() {
  const store = new InMemoryRunStore();
  const run = await store.insertRun(aRun({ stage: "done", status: "completed" }));
  const finding = aReproducedFinding();
  await store.addFindings(run.id, [finding]);
  const diagnosis = aDiagnosis([finding.id]);
  await store.addDiagnoses(run.id, [diagnosis]);
  const patch = await store.savePatch(run.id, aVerifiedPatch(diagnosis.id, { prUrl: PR }));
  return { store, run, patch };
}

function deliver(app: ReturnType<typeof buildApp>, event: string, payload: object, secret: string | null = SECRET) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json", "x-github-event": event };
  if (secret !== null) headers["x-hub-signature-256"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return app.inject({ method: "POST", url: "/github/webhook", headers, payload: body });
}

const closed = (merged: boolean, url = PR) => ({ action: "closed", pull_request: { html_url: url, merged } });

describe("recordPullRequestClosed", () => {
  it("marks the patch merged when a person merged its PR, and logs it on the run", async () => {
    const { store, run, patch } = await storeWithOpenPr();
    expect(await recordPullRequestClosed(store, { url: PR, merged: true, source: "webhook" })).toBe("merged");
    expect(await store.getPatch(patch.id)).toMatchObject({ status: "merged", prUrl: PR });
    expect((await store.listLogs(run.id, { kind: "github" })).map((l) => l.entry)).toEqual([
      { event: "pull-request-merged", patchId: patch.id, prUrl: PR, source: "webhook" },
    ]);
    expect(await store.listOpenPullRequests()).toEqual([]);
  });

  it("rejects the patch when its PR was closed without merging", async () => {
    const { store, patch } = await storeWithOpenPr();
    expect(await recordPullRequestClosed(store, { url: PR, merged: false, source: "poll" })).toBe("rejected");
    expect(await store.getPatch(patch.id)).toMatchObject({ status: "rejected" });
  });

  it("changes nothing for a PR it didn't open, or one already settled", async () => {
    const { store, patch } = await storeWithOpenPr();
    expect(await recordPullRequestClosed(store, { url: "https://github.com/octo/example/pull/1", merged: true, source: "webhook" })).toBe("unknown");
    await recordPullRequestClosed(store, { url: PR, merged: true, source: "webhook" });
    expect(await recordPullRequestClosed(store, { url: PR, merged: false, source: "poll" })).toBe("unknown");
    expect(await store.getPatch(patch.id)).toMatchObject({ status: "merged" });
  });
});

describe("POST /github/webhook", () => {
  it("settles a repair PR merged on GitHub, from a signed delivery", async () => {
    const { store, patch } = await storeWithOpenPr();
    const app = buildApp(store, { githubWebhookSecret: SECRET });
    const response = await deliver(app, "pull_request", closed(true));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: "merged" });
    expect(await store.getPatch(patch.id)).toMatchObject({ status: "merged" });
  });

  it("refuses a delivery with a wrong or missing signature", async () => {
    const { store, patch } = await storeWithOpenPr();
    const app = buildApp(store, { githubWebhookSecret: SECRET });
    expect((await deliver(app, "pull_request", closed(true), "someone-else")).statusCode).toBe(401);
    expect((await deliver(app, "pull_request", closed(true), null)).statusCode).toBe(401);
    expect(await store.getPatch(patch.id)).toMatchObject({ status: "verified" });
  });

  it("answers GitHub's ping and ignores other events and actions", async () => {
    const { store, patch } = await storeWithOpenPr();
    const app = buildApp(store, { githubWebhookSecret: SECRET });
    expect((await deliver(app, "ping", { zen: "Keep it logically awesome." })).json()).toEqual({ ok: true });
    expect((await deliver(app, "issues", { action: "closed" })).statusCode).toBe(202);
    expect((await deliver(app, "pull_request", { action: "opened", pull_request: { html_url: PR, merged: false } })).statusCode).toBe(202);
    expect(await store.getPatch(patch.id)).toMatchObject({ status: "verified" });
  });

  it("doesn't exist without a secret, and leaves the API's own JSON handling alone", async () => {
    const { store } = await storeWithOpenPr();
    expect((await deliver(buildApp(store), "pull_request", closed(true))).statusCode).toBe(404);

    const app = buildApp(store, { githubWebhookSecret: SECRET });
    const queued = await app.inject({ method: "POST", url: "/trpc/runs.create", payload: { targetRef: "octo/example" } });
    expect(queued.statusCode).toBe(200);
    expect(queued.json().result.data).toMatchObject({ status: "queued", target: { kind: "github", ref: "octo/example" } });
  });
});

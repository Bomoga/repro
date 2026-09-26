import type { Octokit } from "@octokit/rest";
import { InMemoryRunStore } from "@repro/api";
import { describe, expect, it, vi } from "vitest";
import { PullRequestSync } from "../src/pull-request-sync.ts";
import { aDiagnosis, aFinding, aPatch } from "./helpers.ts";

const pr = (n: number) => `https://github.com/octo/example/pull/${n}`;

async function storeWithPrs(urls: string[]) {
  const store = new InMemoryRunStore();
  const run = await store.createRun({ target: { kind: "github", ref: "octo/example" }, trigger: "manual" });
  await store.addFindings(run.id, [aFinding("fnd_sqli", { reproducible: true, reproductionOutput: "REPRODUCED" })]);
  await store.addDiagnoses(run.id, [aDiagnosis("diag_sqli", ["fnd_sqli"])]);
  for (const [i, prUrl] of urls.entries()) {
    await store.savePatch(run.id, aPatch(`patch_${i + 1}`, "diag_sqli", { challengerVerdict: "confirmed", status: "verified", prUrl }));
  }
  return { store, run };
}

/** GitHub's view of each PR by number; a number it doesn't know answers 404. */
function github(prs: Record<number, { state: "open" | "closed"; merged: boolean }>) {
  const get = vi.fn(async ({ pull_number }: { owner: string; repo: string; pull_number: number }) => {
    const found = prs[pull_number];
    if (!found) throw new Error("Not Found");
    return { data: found };
  });
  return { octokit: { pulls: { get } } as unknown as Octokit, get };
}

describe("PullRequestSync", () => {
  it("merges or rejects each patch whose PR a person merged or closed, and leaves open ones alone", async () => {
    const { store, run } = await storeWithPrs([pr(1), pr(2), pr(3), pr(4), "https://gitlab.example.com/octo/example/-/merge_requests/5"]);
    const { octokit, get } = github({ 1: { state: "closed", merged: true }, 2: { state: "closed", merged: false }, 3: { state: "open", merged: false } });
    const lines: string[] = [];
    const sync = new PullRequestSync(store, octokit, (line) => lines.push(line));

    expect(await sync.checkOnce()).toBe(2);
    expect((await Promise.all(["patch_1", "patch_2", "patch_3", "patch_4", "patch_5"].map((id) => store.getPatch(id)))).map((p) => p?.status)).toEqual([
      "merged",
      "rejected",
      "verified",
      "verified",
      "verified",
    ]);
    // Only GitHub PRs are asked about; one GitHub can't find doesn't stop the rest.
    expect(get.mock.calls.map(([args]) => args)).toEqual([1, 2, 3, 4].map((n) => ({ owner: "octo", repo: "example", pull_number: n })));
    expect(lines).toContain(`[${run.id}] ${pr(1)} was merged: patch patch_1 is merged`);
    expect(lines).toContain(`[${run.id}] couldn't check ${pr(4)}: Not Found`);
    expect((await store.listLogs(run.id, { kind: "github" })).map((l) => l.entry)).toEqual([
      { event: "pull-request-merged", patchId: "patch_1", prUrl: pr(1), source: "poll" },
      { event: "pull-request-closed", patchId: "patch_2", prUrl: pr(2), source: "poll" },
    ]);

    expect(await sync.checkOnce()).toBe(0);
  });

  it("keeps checking on an interval until stopped", async () => {
    const { store } = await storeWithPrs([pr(1)]);
    const { octokit } = github({ 1: { state: "closed", merged: true } });
    const sync = new PullRequestSync(store, octokit);
    sync.start(5);
    await vi.waitFor(async () => expect(await store.getPatch("patch_1")).toMatchObject({ status: "merged" }));
    sync.stop();
  });
});

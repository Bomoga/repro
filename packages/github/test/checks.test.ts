import { describe, expect, it, vi } from "vitest";
import type { Run } from "@repro/contracts";
import { upsertRunCheck } from "../src/checks.ts";
import { upsertTrustReportComment } from "../src/comments.ts";
import { buildTrustReport } from "@repro/api";
import type { Patch } from "@repro/contracts";

function fakeOctokit(existingCheckRuns: { id: number; external_id: string }[] = [], existingComments: { id: number; body: string }[] = []) {
  return {
    checks: {
      listForRef: vi.fn(async () => ({ data: { check_runs: existingCheckRuns } })),
      create: vi.fn(async (_params: Record<string, unknown>) => ({})),
      update: vi.fn(async (_params: Record<string, unknown>) => ({})),
    },
    issues: {
      listComments: vi.fn(async () => ({ data: existingComments })),
      createComment: vi.fn(async (_params: Record<string, unknown>) => ({})),
      updateComment: vi.fn(async (_params: Record<string, unknown>) => ({})),
    },
  };
}

const run: Run = {
  id: "run_1",
  trigger: "webhook",
  target: { kind: "github", ref: "abc123" },
  stage: "verify",
  status: "running",
  startedAt: new Date().toISOString(),
  logRef: "",
};

describe("upsertRunCheck", () => {
  it("creates a check run when none exists for this run id", async () => {
    const octokit = fakeOctokit();
    await upsertRunCheck(octokit as never, { owner: "o", repo: "r", headSha: "abc123" }, run);
    expect(octokit.checks.create).toHaveBeenCalledOnce();
    expect(octokit.checks.update).not.toHaveBeenCalled();
    expect(octokit.checks.create.mock.calls[0]![0]).toMatchObject({ status: "in_progress", external_id: "run_1" });
  });

  it("updates the existing check run for this run id instead of creating a second one", async () => {
    const octokit = fakeOctokit([{ id: 42, external_id: "run_1" }]);
    await upsertRunCheck(octokit as never, { owner: "o", repo: "r", headSha: "abc123" }, { ...run, status: "completed", stage: "done" });
    expect(octokit.checks.update).toHaveBeenCalledOnce();
    expect(octokit.checks.create).not.toHaveBeenCalled();
    expect(octokit.checks.update.mock.calls[0]![0]).toMatchObject({ check_run_id: 42, conclusion: "success" });
  });
});

const patch: Patch = {
  id: "patch_1",
  diagnosisId: "diag_1",
  diff: "",
  filesChanged: [],
  testsPassed: true,
  originalFindingReproduces: false,
  regressionFindings: [],
  challengerVerdict: "confirmed",
  status: "verified",
};

describe("upsertTrustReportComment", () => {
  it("creates a comment when none exists yet", async () => {
    const octokit = fakeOctokit();
    const report = buildTrustReport(patch, undefined, []);
    await upsertTrustReportComment(octokit as never, { owner: "o", repo: "r", pullNumber: 7 }, patch, report, "body");
    expect(octokit.issues.createComment).toHaveBeenCalledOnce();
    expect(octokit.issues.updateComment).not.toHaveBeenCalled();
  });

  it("updates its own prior comment instead of posting a second one", async () => {
    const octokit = fakeOctokit([], [{ id: 99, body: "<!-- repro:trust-report -->\nold" }]);
    const report = buildTrustReport(patch, undefined, []);
    await upsertTrustReportComment(octokit as never, { owner: "o", repo: "r", pullNumber: 7 }, patch, report, "body");
    expect(octokit.issues.updateComment).toHaveBeenCalledOnce();
    expect(octokit.issues.updateComment.mock.calls[0]![0]).toMatchObject({ comment_id: 99 });
    expect(octokit.issues.createComment).not.toHaveBeenCalled();
  });
});

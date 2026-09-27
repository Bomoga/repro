import { readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import type { Octokit } from "@octokit/rest";
import { Sandbox, type GeminiClient } from "@repro/agents";
import { buildTrustReport } from "@repro/api";
import type { Diagnosis, Executor, Finding, Patch, Run, Workspace } from "@repro/contracts";
import { narratePrBody, templatedPrBody, type NarratorInput } from "@repro/github";
import { parseGithubRef } from "@repro/ingest";

export interface PullRequestInput {
  run: Run;
  workspace: Workspace;
  /** A verified Patch. */
  patch: Patch;
  diagnosis: Diagnosis;
  /** Every Finding in the Run. */
  findings: Finding[];
  /** The Run's Gemini client, for the narrated half of the body. */
  gemini: GeminiClient;
}

export interface PullRequestOpener {
  /** Opens a PR for a verified Patch and returns its URL, or undefined when the target can't take one. */
  open(input: PullRequestInput): Promise<string | undefined>;
}

const SHA = /^[0-9a-f]{40}$/i;

/**
 * Opens repair PRs on GitHub through the Git Data API, so the token only ever travels in this
 * client's requests (section 9): never to git, a model, or a log. The branch holds one commit, the
 * verified Patch applied to headCommit. A human reviews and merges it; nothing here merges.
 */
export class GitHubPullRequests implements PullRequestOpener {
  constructor(
    private readonly octokit: Octokit,
    private readonly executor: Executor,
  ) {}

  async open(input: PullRequestInput): Promise<string | undefined> {
    const { run, workspace, patch } = input;
    if (run.target.kind !== "github") return undefined;
    if (patch.status !== "verified") throw new Error(`patch ${patch.id} is ${patch.status}; only a verified patch becomes a PR`);
    // A pushed branch runs its own workflow files with the target repo's secrets.
    const ci = patch.filesChanged.filter((file) => file.startsWith(".github/"));
    if (ci.length > 0) throw new Error(`patch ${patch.id} changes ${ci.join(", ")}, which would run in CI with the repo's secrets`);

    const { owner, repo, rev } = parseGithubRef(run.target.ref);
    const files = await patchedFiles(this.executor, workspace, patch);
    const tree = await Promise.all(
      files.map(async ({ path, mode, content }) => ({
        path,
        mode,
        type: "blob" as const,
        sha: content === null ? null : (await this.octokit.git.createBlob({ owner, repo, content: content.toString("base64"), encoding: "base64" })).data.sha,
      })),
    );
    const { data: base } = await this.octokit.git.getCommit({ owner, repo, commit_sha: workspace.headCommit });
    const { data: newTree } = await this.octokit.git.createTree({ owner, repo, base_tree: base.tree.sha, tree });
    const { data: commit } = await this.octokit.git.createCommit({ owner, repo, message: pullRequestTitle(input), tree: newTree.sha, parents: [workspace.headCommit] });
    const branch = `repro/${patch.id}`;
    await this.octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.sha });

    const baseBranch = rev && !SHA.test(rev) ? rev : (await this.octokit.repos.get({ owner, repo })).data.default_branch;
    const narratorInput: NarratorInput = { patch, diagnosis: input.diagnosis, findings: input.findings, trustReport: buildTrustReport(patch, input.diagnosis, input.findings) };
    const narration = await narratePrBody(input.gemini, narratorInput);
    const byGemini = narration !== templatedPrBody(narratorInput);
    const { data: pr } = await this.octokit.pulls.create({
      owner,
      repo,
      title: pullRequestTitle(input),
      head: branch,
      base: baseBranch,
      body: pullRequestBody(input, narration, byGemini),
    });
    return pr.html_url;
  }
}

type BlobMode = "100644" | "100755" | "120000";
const BLOB_MODES: readonly string[] = ["100644", "100755", "120000"] satisfies BlobMode[];

interface PatchedFile {
  path: string;
  mode: BlobMode;
  /** Null when the Patch deletes the file. */
  content: Buffer | null;
}

const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** The Patch applied to a clean checkout of headCommit, in the sandbox: each changed file's new
 *  content and its mode. The workspace is the Run's own and its repairs are over, so it's reused. */
async function patchedFiles(executor: Executor, workspace: Workspace, patch: Patch): Promise<PatchedFile[]> {
  for (const path of patch.filesChanged) {
    if (isAbsolute(path) || normalize(path).startsWith("..")) throw new Error(`patch ${patch.id} names a path outside the repo: ${path}`);
  }
  const sandbox = new Sandbox(workspace, executor);
  await sandbox.resetToHead();
  const cleaned = await sandbox.exec("git clean -fdq", 60_000);
  if (cleaned.exitCode !== 0) throw new Error(`could not clean the workspace: ${cleaned.stderr.trim()}`);
  const diffFile = ".repro-pr.diff";
  await writeFile(join(workspace.path, diffFile), patch.diff);
  try {
    await sandbox.applyPatchFile(diffFile);
  } finally {
    await rm(join(workspace.path, diffFile), { force: true });
  }

  const listed = await sandbox.exec(`git ls-tree -z ${workspace.headCommit} -- ${patch.filesChanged.map(quote).join(" ")}`, 60_000);
  const modes = new Map(
    listed.stdout
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const [meta = "", path = ""] = entry.split("\t");
        const mode = meta.split(" ")[0] ?? "";
        return [path, (BLOB_MODES.includes(mode) ? mode : "100644") as BlobMode] as const;
      }),
  );
  return Promise.all(
    patch.filesChanged.map(async (path) => ({
      path,
      mode: modes.get(path) ?? "100644",
      content: await readFile(join(workspace.path, path)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    })),
  );
}

function cited(input: Pick<PullRequestInput, "diagnosis" | "findings">): Finding[] {
  return input.findings.filter((finding) => input.diagnosis.findingIds.includes(finding.id));
}

/** A rule's short name. Registry rules end in it ("...sqli.node-postgres-sqli"); Lane 2's own
 *  privacy rules name it right after their prefix, then maybe a provider, then their language
 *  ("privacy.prompt-logging.js", "privacy.oauth-broad-scope.google.js"). */
function ruleName(ruleId: string): string {
  const privacy = /^privacy\.([^.]+)/.exec(ruleId);
  if (privacy) return privacy[1]!;
  return ruleId.replace(/\.(js|jsx|ts|tsx|py)$/, "").split(/[./]/).pop() || ruleId;
}

/** Deterministic, from the cited rules and the changed files; never model prose. */
export function pullRequestTitle(input: Pick<PullRequestInput, "patch" | "diagnosis" | "findings">): string {
  const rules = [...new Set(cited(input).map((finding) => ruleName(finding.ruleId)))];
  const title = `Repro: fix ${rules.join(", ")} in ${input.patch.filesChanged.join(", ")}`;
  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

/** A fenced block that no backtick run inside `text` can close early. */
function fenced(text: string, lang = "text"): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${text.trimEnd()}\n${fence}`;
}

/**
 * The PR body (section 8): the narration, labeled as Gemini's when it is, then the proof, pasted
 * verbatim from the deterministic steps and never paraphrased.
 */
export function pullRequestBody(input: Omit<PullRequestInput, "gemini">, narration: string, byGemini: boolean): string {
  const { run, workspace, patch, diagnosis } = input;
  const report = buildTrustReport(patch, diagnosis, input.findings);
  const lines = [
    narration.trim(),
    "",
    byGemini
      ? "> Written by Gemini from the evidence below. Everything under **Proof** is pasted verbatim from Repro's deterministic checks."
      : "> Everything under **Proof** is pasted verbatim from Repro's deterministic checks.",
    "",
    "## Proof",
    "",
    "### Findings, confirmed by reproduction before the patch",
  ];
  for (const finding of cited(input)) {
    lines.push(
      "",
      `**\`${finding.ruleId}\`** (${finding.detectorId}, ${finding.severity}) at \`${finding.file}:${finding.lineStart}-${finding.lineEnd}\`: ${finding.message}`,
      "",
      fenced(finding.evidence),
    );
    if (finding.reproductionCommand) lines.push("", `Reproduced with \`${finding.reproductionCommand}\`:`, "", fenced(finding.reproductionOutput ?? "(no output)"));
  }
  lines.push(
    "",
    "### After the patch",
    "",
    "The same reproduction commands, re-run on the patched tree:",
    "",
    fenced(patch.reproductionOutputAfter ?? "(no output)"),
    "",
    `- Tests: ${patch.testsPassed ? "pass" : "fail"}`,
    `- New findings in the changed files: ${patch.regressionFindings.length === 0 ? "none" : patch.regressionFindings.map((f) => `\`${f.ruleId}\` at \`${f.file}:${f.lineStart}\``).join(", ")}`,
    `- Challenger: ${patch.challengerVerdict}${patch.challengerNotes ? `. ${patch.challengerNotes}` : ""}`,
    "",
    `### Trust Report: ${report.confidence}`,
    "",
    ...report.reasons.map((reason) => `- ${reason}`),
    "",
    `<sub>Repro run \`${run.id}\`, patch \`${patch.id}\`, base commit \`${workspace.headCommit.slice(0, 12)}\`. A person reviews and merges this; Repro never does.</sub>`,
  );
  return lines.join("\n");
}

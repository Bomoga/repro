import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { DetectorAdapter, ExecRequest, ExecResult, Executor, Finding } from "../../src/contracts.js";
import { DEMO_TARGET } from "./workspace.js";

export type CommandHandler = (request: ExecRequest) => ExecResult | undefined;

/**
 * Exactly the git commands the harness (Sandbox) issues. Anything else, including a
 * model-chosen counter-test command that happens to start with `git`, never reaches the host.
 */
const HARNESS_GIT =
  /^git -c core\.quotepath=off (reset --hard --quiet [0-9a-f]{7,64}|diff --no-color --no-ext-diff --no-textconv [0-9a-f]{7,64}|diff --name-only --no-renames [0-9a-f]{7,64}|apply --whitespace=nowarn \.repro\/[A-Za-z0-9._-]+\.diff)$/;

/**
 * Test double for the sandboxed Executor. The harness's own git commands run for real against
 * the throwaway fixture repo the test created (trusted content). Everything else must be
 * answered by a handler: code or commands a model wrote are never executed on the host
 * (section 9), so tests, detectors, and counter-tests are answered by static oracles instead.
 */
export class FixtureExecutor implements Executor {
  readonly requests: ExecRequest[] = [];

  constructor(private readonly handlers: CommandHandler[] = []) {}

  async exec(request: ExecRequest): Promise<ExecResult> {
    this.requests.push(request);
    for (const handler of this.handlers) {
      const result = handler(request);
      if (result) return result;
    }
    if (HARNESS_GIT.test(request.command)) return runGit(request);
    return result(127, "", `FixtureExecutor has no handler for: ${request.command}`);
  }

  commands(): string[] {
    return this.requests.map((r) => r.command);
  }
}

function runGit(request: ExecRequest): ExecResult {
  const started = Date.now();
  try {
    const stdout = execSync(request.command, {
      cwd: request.workspacePath,
      encoding: "utf8",
      timeout: request.timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ...result(0, stdout, ""), durationMs: Date.now() - started };
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string; stderr?: string; signal?: string | null };
    return { exitCode: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "", timedOut: e.signal === "SIGTERM", durationMs: Date.now() - started };
  }
}

export function result(exitCode: number, stdout: string, stderr = ""): ExecResult {
  return { exitCode, stdout, stderr, timedOut: false, durationMs: 1 };
}

export function on(pattern: RegExp, answer: (request: ExecRequest) => ExecResult): CommandHandler {
  return (request) => (pattern.test(request.command) ? answer(request) : undefined);
}

const read = (workspacePath: string, file: string) => readFileSync(path.join(workspacePath, file), "utf8");

/** Statements that splice a non-literal value into SQL text, roughly what the semgrep rule sees. */
export function sqlConcatenations(source: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  const lines = source.split("\n");
  let offset = 0;
  for (const statement of source.split(";")) {
    const stripped = statement.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""');
    const interpolated = /`[^`]*\$\{[^`]*`/.test(statement);
    const concatenated = /\+\s*[A-Za-z_$(]|[A-Za-z_$)\]]\s*\+/.test(stripped);
    const keywordAt = statement.search(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i);
    if (keywordAt >= 0 && (interpolated || concatenated)) {
      const line = source.slice(0, offset + keywordAt).split("\n").length;
      hits.push({ line, text: lines[line - 1]!.trim() });
    }
    offset += statement.length + 1;
  }
  return hits;
}

/** Oracle for `semgrep … node-postgres-sqli … src/db.js`. */
export function semgrepSqli(request: ExecRequest): ExecResult {
  const hits = sqlConcatenations(read(request.workspacePath, "src/db.js"));
  if (hits.length === 0) return result(0, "Ran 1 rule on 1 file: 0 findings.");
  const body = hits.map((hit) => `           ${hit.line}┆ ${hit.text.split("\n")[0]}`).join("\n");
  return result(1, `    src/db.js\n   ❯❯❱ node-postgres-sqli\n${body}\n\nRan 1 rule on 1 file: ${hits.length} findings.`);
}

/** Oracle for `gitleaks dir src/config.js …`: exit 1 while the planted key is still there. */
export function gitleaksConfig(secret: string) {
  return (request: ExecRequest): ExecResult =>
    read(request.workspacePath, "src/config.js").includes(secret)
      ? result(1, "Finding:     OPENAI_API_KEY: 'REDACTED'\nSecret:      REDACTED\nRuleID:      generic-api-key\n\nWRN leaks found: 1")
      : result(0, "INF no leaks found");
}

/**
 * Oracle for `npm test`: a structural stand-in for demo-target's test suite. It passes while the
 * suite's file is untouched and db.js still defines and exports the functions it exercises.
 */
export function demoTargetTests(request: ExecRequest): ExecResult {
  const suite = read(request.workspacePath, "test/db.test.js");
  if (suite !== readFileSync(path.join(DEMO_TARGET, "test/db.test.js"), "utf8")) {
    return result(1, "", "test/db.test.js was modified");
  }
  const db = read(request.workspacePath, "src/db.js");
  const names = ["findNotesByOwner", "getNoteById", "deleteNote"];
  const missing = names.filter((name) => !new RegExp(`function ${name}\\s*\\(|${name}\\s*=`).test(db));
  const exported = /module\.exports\s*=\s*\{([^}]*)\}/.exec(db)?.[1] ?? "";
  const unexported = names.filter((name) => !exported.includes(name));
  if (missing.length > 0 || unexported.length > 0 || !/db\.query\(/.test(db)) {
    return result(1, "", `db.js no longer defines or exports: ${[...missing, ...unexported].join(", ") || "db.query calls"}`);
  }
  return result(0, "# tests 3\n# pass 3\n# fail 0");
}

export const SEMGREP_COMMAND = /^semgrep .*node-postgres-sqli/;
export const GITLEAKS_COMMAND = /^gitleaks /;

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n}", start);
  return source.slice(start, end < 0 ? undefined : end);
}

/** True when `param` reaches db.query only as a bound parameter. */
export function passedAsParameter(source: string, fn: string, param: string): boolean {
  const body = functionBody(source, fn);
  const bound = new RegExp(`db\\.query\\([^;]*\\[\\s*${param}\\s*\\]`).test(body);
  const spliced = new RegExp(`\\+\\s*${param}\\b|\\$\\{\\s*${param}\\b|\\b${param}\\s*\\]\\s*\\.join`).test(body);
  return bound && !spliced;
}

/**
 * Oracle for `node --test <file>` counter-tests. Model-written tests are never executed on the
 * host, so each fixture counter-test names the property it checks with a `CHECKS:` marker and
 * the oracle evaluates that property against whichever tree is on disk.
 */
export function counterTestOracle(request: ExecRequest): ExecResult | undefined {
  const match = /^node --test (\S+)$/.exec(request.command);
  if (!match) return undefined;
  let code: string;
  try {
    code = read(request.workspacePath, match[1]!);
  } catch {
    return result(1, "", `Could not find '${match[1]}'`);
  }
  const db = read(request.workspacePath, "src/db.js");
  const verdict = (ok: boolean, what: string) => (ok ? result(0, `# pass 1\n# fail 0 (${what})`) : result(1, `not ok 1 - ${what}\n# fail 1`));
  if (code.includes("CHECKS:numeric-injection")) return verdict(passedAsParameter(db, "getNoteById", "noteId"), "getNoteById binds noteId");
  if (code.includes("CHECKS:owner-injection")) return verdict(passedAsParameter(db, "findNotesByOwner", "ownerId"), "findNotesByOwner binds ownerId");
  if (code.includes("CHECKS:old-sql-text")) return verdict(db.includes("' + noteId"), "SQL text still embeds noteId");
  if (code.includes("CHECKS:always-fails")) return result(1, "SyntaxError: Unexpected token");
  return result(1, "", "counterTestOracle: no CHECKS marker in this test");
}

export function demoTargetHandlers(secret: string): CommandHandler[] {
  return [
    on(/^npm test$/, demoTargetTests),
    on(SEMGREP_COMMAND, semgrepSqli),
    on(GITLEAKS_COMMAND, gitleaksConfig(secret)),
    counterTestOracle,
  ];
}

/** Stand-in for Lane 2's semgrep adapter over demo-target, built on the same oracle. */
export const fakeSemgrepAdapter: DetectorAdapter = {
  id: "semgrep",
  async run(workspace) {
    const source = read(workspace.path, "src/db.js");
    return sqlConcatenations(source).map(
      (hit, i): Finding => ({
        id: `post-semgrep-${i}`,
        detectorId: "semgrep",
        ruleId: "javascript.lang.security.audit.sqli.node-postgres-sqli.node-postgres-sqli",
        severity: "high",
        category: "vulnerability",
        file: "src/db.js",
        lineStart: hit.line,
        lineEnd: hit.line,
        message: "SQL built by concatenation",
        evidence: hit.text,
        reproducible: false,
        createdAt: "2026-09-26T11:00:00.000Z",
      }),
    );
  },
};

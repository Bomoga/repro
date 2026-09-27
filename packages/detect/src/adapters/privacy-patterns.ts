import { type DetectorAdapter, type Executor, type Finding, type Workspace } from "@repro/contracts";
import { readWorkspaceFile, shq } from "../util.ts";
import { createSemgrepAdapter } from "./semgrep.ts";

// The Assurant challenge's detector (CLAUDE.md section 8): Repro's own Semgrep rule pack for what
// matters when deciding whether to trust an AI tool with your data. Rules and their tests live in
// sandbox/rules/privacy-patterns and are baked into the sandbox image.
const semgrepPrivacy = createSemgrepAdapter("privacy-patterns", "privacy-patterns");

// The checks whose behavior can be watched. An OAuth scope is a configuration value: there's no
// user input to follow, so oauth-broad-scope keeps its Semgrep reproduction.
export const CANARY_CHECKS = new Set([
  "prompt-logging",
  "unencrypted-conversation-storage",
  "third-party-forwarding",
  "analytics-forwarding",
]);

/** "privacy.prompt-logging.js" -> "prompt-logging". */
export function privacyCheckOf(ruleId: string): string | undefined {
  return /^privacy\.([a-z-]+)\./.exec(ruleId)?.[1];
}

function languageOf(file: string): "python" | "javascript" | undefined {
  if (file.endsWith(".py")) return "python";
  if (/\.(c|m)?js$/.test(file)) return "javascript";
  return undefined;
}

const PY_DEF = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
const JS_DEF =
  /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/;

/**
 * The top-level function a line sits in, by walking up to the nearest top-level declaration. Any
 * other top-level statement in between means the line isn't inside a callable top-level function
 * (module-level code, a class method, an object literal), and there's nothing to call.
 */
export function enclosingFunction(source: string, line: number, language: "python" | "javascript"): string | undefined {
  const lines = source.split(/\r?\n/);
  const decl = language === "python" ? PY_DEF : JS_DEF;
  for (let i = line - 1; i >= 0; i--) {
    const text = lines[i] ?? "";
    const m = decl.exec(text);
    if (m) return m[1] ?? m[2];
    const topLevel = /^\S/.test(text) && !(language === "python" && text.startsWith("@"));
    if (topLevel) return undefined;
  }
  return undefined;
}

function exportedFromJs(source: string, name: string): boolean {
  const n = name.replace(/\$/g, "\\$");
  return new RegExp(
    `\\bexports\\.${n}\\b|module\\.exports\\s*=\\s*\\{[^}]*\\b${n}\\b|export\\s+(?:async\\s+)?function\\s*\\*?\\s*${n}\\b|` +
      `export\\s+(?:const|let|var)\\s+${n}\\b|export\\s*\\{[^}]*\\b${n}\\b`,
  ).test(source);
}

/**
 * repro-canary's reproductionCommand for a Finding, when its behavior can be watched: one of the
 * canary checks, in Python or JavaScript, inside a top-level function the harness can call.
 * Falls back to the Semgrep rule inside repro-canary if the call can't be observed at run time.
 */
export function canaryCommand(workspace: Workspace, finding: Finding): string | undefined {
  const check = privacyCheckOf(finding.ruleId);
  const language = languageOf(finding.file);
  if (!check || !CANARY_CHECKS.has(check) || !language) return undefined;
  const source = readWorkspaceFile(workspace.path, finding.file);
  if (source === undefined) return undefined;
  const fn = enclosingFunction(source, finding.lineStart, language);
  if (!fn || (language === "javascript" && !exportedFromJs(source, fn))) return undefined;
  const args = [check, finding.file, fn, String(finding.lineStart), "privacy-patterns", finding.ruleId];
  return `repro-canary ${args.map(shq).join(" ")}`;
}

// privacy-patterns Findings reproduce by canary tracing where they can: the flagged function is
// called with a unique marker as the user input, and the reproduction succeeds only if the marker
// actually reaches the sink the rule is about (the logs, a plaintext file or browser storage, an
// outbound request to a third party). "We pattern-matched logging code" becomes "we watched your
// data get logged". The rest keep re-running the Semgrep rule.
export const privacyPatternsAdapter: DetectorAdapter = {
  id: "privacy-patterns",
  async run(workspace: Workspace, exec: Executor): Promise<Finding[]> {
    const findings = await semgrepPrivacy.run(workspace, exec);
    return findings.map((f) => ({ ...f, reproductionCommand: canaryCommand(workspace, f) ?? f.reproductionCommand }));
  },
};

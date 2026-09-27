/**
 * The evasion check: a deterministic scan of the lines a patch adds, run after Repair and before
 * the Challenger ("Gemini proposes, the sandbox disposes"). A patch can pass the tests and fool
 * the reproduction re-run without fixing anything, by behaving differently under test or by
 * hiding the flagged construct from the detector. REPAIR_SYSTEM_PROMPT's rule 4 forbids both;
 * this is the code that enforces it. Three kinds of hit:
 * - test-detection: code that can tell a test run from real use (call-stack inspection, a test
 *   runner's environment variables, modules, or arguments, a counter-test's name);
 * - disguised-call: a call, attribute, or import whose name is only known at runtime, or code run
 *   through eval, so the detector has nothing to match;
 * - suppression: a comment or a scanner config change that tells a scanner to look away.
 * Patterns are picked by file extension and matched outside comments, and outside string
 * literals wherever the construct is code. A construct the old side of the file had at least as
 * often isn't new, so editing a line that already carried it is not an evasion.
 */

export type EvasionKind = "test-detection" | "disguised-call" | "suppression";

export interface Evasion {
  kind: EvasionKind;
  /** The file, as the diff names it on the patched side. */
  file: string;
  /** 1-based line number in the patched file. */
  line: number;
  /** The rule that matched, e.g. "python.stack-inspection". */
  rule: string;
  /** Why the rule counts as an evasion, for the retry's feedback. */
  reason: string;
  /** The added line, without its leading "+". */
  text: string;
}

export interface EvasionOptions {
  /** Paths of counter-tests the Challenger ran against earlier attempts: code that names one is recognising the test. */
  counterTestPaths?: string[];
}

/** Every hit in `diff` (a unified diff, as `git diff` prints it), in diff order. */
export function findEvasions(diff: string, options: EvasionOptions = {}): Evasion[] {
  const names = counterTestNames(options.counterTestPaths ?? []);
  return parseUnifiedDiff(diff).flatMap((file) => scanFile(file, names));
}

// ---------------------------------------------------------------------------------------------
// The unified diff
// ---------------------------------------------------------------------------------------------

interface DiffLine {
  type: " " | "+" | "-";
  text: string;
  /** The new side's line number; for a removed line, the old side's. */
  number: number;
}

interface FileDiff {
  path: string;
  hunks: DiffLine[][];
}

function parseUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diff.split("\n").map((line) => line.replace(/\r$/, ""));
  let current: FileDiff | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("diff --git ")) {
      current = { path: pathOfDiffGit(line), hunks: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++ ")) {
      const path = diffPath(line.slice(4));
      if (path) current.path = path;
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!header) continue;
    let oldLeft = header[2] === undefined ? 1 : Number(header[2]);
    let newLeft = header[4] === undefined ? 1 : Number(header[4]);
    let oldNumber = Number(header[1]);
    let newNumber = Number(header[3]);
    const hunk: DiffLine[] = [];
    // Read by count, so an added line that starts with "++" is never mistaken for a header.
    while ((oldLeft > 0 || newLeft > 0) && i + 1 < lines.length) {
      const next = lines[++i]!;
      if (next.startsWith("\\")) continue; // "\ No newline at end of file"
      if (next.startsWith("+")) {
        hunk.push({ type: "+", text: next.slice(1), number: newNumber++ });
        newLeft--;
      } else if (next.startsWith("-")) {
        hunk.push({ type: "-", text: next.slice(1), number: oldNumber++ });
        oldLeft--;
      } else if (next.startsWith(" ") || next === "") {
        hunk.push({ type: " ", text: next.slice(1), number: newNumber++ });
        oldNumber++;
        oldLeft--;
        newLeft--;
      } else {
        i--; // malformed: hand the line back to the outer loop
        break;
      }
    }
    current.hunks.push(hunk);
  }
  return files;
}

function pathOfDiffGit(line: string): string {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) return diffPath(rest.slice(rest.lastIndexOf(' "') + 1)) ?? rest;
  const at = rest.lastIndexOf(" b/");
  return at >= 0 ? rest.slice(at + 3) : rest;
}

/** The path in a `+++ ` line, without git's `b/` prefix and C-style quoting; undefined for /dev/null. */
function diffPath(raw: string): string | undefined {
  let path = raw.replace(/\t.*$/, "");
  if (path === "/dev/null") return undefined;
  if (path.startsWith('"') && path.endsWith('"')) path = unquote(path.slice(1, -1));
  return path.replace(/^[ab]\//, "");
}

function unquote(text: string): string {
  const bytes: number[] = [];
  const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", a: "\x07", b: "\b", f: "\f", v: "\v" };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\" && /^[0-7]{3}$/.test(text.slice(i + 1, i + 4))) {
      bytes.push(parseInt(text.slice(i + 1, i + 4), 8));
      i += 3;
    } else if (c === "\\" && simple[text[i + 1] ?? ""] !== undefined) {
      bytes.push(...Buffer.from(simple[text[++i]!]!));
    } else {
      bytes.push(...Buffer.from(c));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

// ---------------------------------------------------------------------------------------------
// Per-line views: comments apart from code, string literals located
// ---------------------------------------------------------------------------------------------

type Language = "python" | "javascript" | "other";

function languageOf(file: string): Language {
  const ext = /\.[^./]+$/.exec(file.toLowerCase())?.[0] ?? "";
  if ([".py", ".pyw", ".pyi"].includes(ext)) return "python";
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].includes(ext)) return "javascript";
  return "other";
}

/** Prose, where a suppression marker is just a word. */
const PROSE = /\.(md|markdown|rst|txt|adoc)$/i;

/** Files that tell a scanner what to skip: an added line in one silences it without touching the code. */
const SCANNER_CONFIG = /(^|\/)(\.semgrepignore|\.semgrep\.ya?ml|\.gitleaksignore|\.?gitleaks\.toml|osv-scanner\.toml|\.secrets\.baseline|\.bandit)$/;

interface StringSpan {
  /** Index of the opening quote in `code`. */
  start: number;
  /** Index just past the closing quote in `code`. */
  end: number;
  value: string;
  /** Python's string prefix (r, b, f, ...), or "" */
  prefix: string;
}

interface LineView {
  /** The line with its comments removed. */
  code: string;
  /** `code` with every literal's contents blanked, so code patterns never match inside a string. */
  masked: string;
  /** The text of the line's comments. */
  comment: string;
  /** String literals that open and close on this line. */
  strings: StringSpan[];
}

type OpenConstruct = { kind: "string"; quote: string } | { kind: "block-comment" };

const REGEX_CAN_FOLLOW = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await))\s*$/;

/** A lexer for one side of a hunk: it carries a multi-line string or comment from line to line. */
function lexer(language: "python" | "javascript"): (text: string) => LineView {
  let open: OpenConstruct | undefined;
  return (text) => {
    let code = "";
    let masked = "";
    let comment = "";
    const strings: StringSpan[] = [];
    let i = 0;

    if (open?.kind === "block-comment") {
      const end = text.indexOf("*/");
      if (end < 0) return { code, masked, comment: text, strings };
      comment += text.slice(0, end) + " ";
      i = end + 2;
      open = undefined;
    } else if (open?.kind === "string") {
      const end = closingQuote(text, 0, open.quote);
      if (end < 0) {
        if (!(open.quote.length === 3 || open.quote === "`") && !text.endsWith("\\")) open = undefined;
        return { code: text, masked: " ".repeat(text.length), comment, strings };
      }
      code += text.slice(0, end);
      masked += " ".repeat(end - open.quote.length) + open.quote;
      i = end;
      open = undefined;
    }

    while (i < text.length) {
      const c = text[i]!;
      if (language === "python" && c === "#") {
        comment += text.slice(i + 1);
        break;
      }
      if (language === "javascript" && text.startsWith("//", i)) {
        comment += text.slice(i + 2);
        break;
      }
      if (language === "javascript" && text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        if (end < 0) {
          comment += text.slice(i + 2);
          open = { kind: "block-comment" };
          break;
        }
        comment += text.slice(i + 2, end) + " ";
        i = end + 2;
        continue;
      }
      const quote = quoteAt(text, i, language);
      if (quote) {
        const end = closingQuote(text, i + quote.length, quote);
        const stop = end < 0 ? text.length : end;
        const literal = text.slice(i, stop);
        const prefix = language === "python" ? (/(?<![\w])([rRbBuUfF]{1,2})$/.exec(code)?.[1] ?? "") : "";
        if (end >= 0) {
          strings.push({ start: code.length, end: code.length + literal.length, value: literal.slice(quote.length, -quote.length), prefix });
          masked += quote + " ".repeat(literal.length - 2 * quote.length) + quote;
        } else {
          if (quote.length === 3 || quote === "`" || text.endsWith("\\")) open = { kind: "string", quote };
          masked += quote + " ".repeat(literal.length - quote.length);
        }
        code += literal;
        i = stop;
        continue;
      }
      if (language === "javascript" && c === "/" && REGEX_CAN_FOLLOW.test(code)) {
        const end = regexEnd(text, i);
        if (end > 0) {
          const literal = text.slice(i, end);
          strings.push({ start: code.length, end: code.length + literal.length, value: literal, prefix: "" });
          code += literal;
          masked += "/" + " ".repeat(literal.length - 1);
          i = end;
          continue;
        }
      }
      code += c;
      masked += c;
      i++;
    }
    return { code, masked, comment, strings };
  };
}

function quoteAt(text: string, i: number, language: "python" | "javascript"): string | undefined {
  const c = text[i];
  if (language === "python") {
    if (text.startsWith('"""', i) || text.startsWith("'''", i)) return text.slice(i, i + 3);
    return c === '"' || c === "'" ? c : undefined;
  }
  return c === '"' || c === "'" || c === "`" ? c : undefined;
}

/** Index just past the quote that closes a literal whose contents start at `from`, or -1. */
function closingQuote(text: string, from: number, quote: string): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text.startsWith(quote, i)) return i + quote.length;
  }
  return -1;
}

/** Index just past a regex literal starting at `start` (its flags included), or -1 if it doesn't close. */
function regexEnd(text: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      if (i === start + 1) return -1; // "//" is a comment, not an empty regex
      let end = i + 1;
      while (end < text.length && /[a-z]/i.test(text[end]!)) end++;
      return end;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

interface ScanContext {
  language: Language;
  /** Python names assigned from a string built at runtime, in this file's added lines. */
  builtNames: Set<string>;
  /** JS names bound to a required or imported module in this file, plus the global objects. */
  moduleNames: Set<string>;
  counterTestNames: string[];
}

interface RuleInfo {
  id: string;
  kind: EvasionKind;
  reason: string;
}

interface Rule extends RuleInfo {
  languages: readonly Language[];
  matches(view: LineView, ctx: ScanContext): boolean;
}

const PLAIN_LITERAL: Record<"python" | "javascript", RegExp> = {
  python: /^(?:[rRuUbB]|[rR][bB]|[bB][rR])?(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")$/,
  javascript: /^(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)$/,
};
const REFERENCE = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/;
const NUMBER = /^\d+$/;
const NAME_LIKE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const GLOBAL_OBJECTS = ["globalThis", "global", "window", "self"];

/** The arguments of the call or subscript whose opening bracket is at `open`, as code. */
function bracketArguments(view: LineView, open: number): { args: string[]; complete: boolean } {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < view.masked.length; i++) {
    const c = view.masked[i]!;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      depth--;
      if (depth === 0) {
        args.push(view.code.slice(start, i).trim());
        if (args.length > 1 && args[args.length - 1] === "") args.pop(); // trailing comma
        return { args, complete: true };
      }
    } else if (c === "," && depth === 1) {
      args.push(view.code.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(view.code.slice(start).trim());
  return { args, complete: false };
}

/** True when some call matching `callee` (matched against the masked line, ending at its "(") has
 *  an argument at `index` that `computed` judges to be computed. */
function someCall(view: LineView, callee: RegExp, index: number, computed: (arg: string) => boolean): boolean {
  for (const match of view.masked.matchAll(callee)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const { args, complete } = bracketArguments(view, open);
    const arg = args[index];
    // An argument the line doesn't finish can't be judged: leave it to the Challenger.
    if (arg === undefined || arg === "" || (!complete && index === args.length - 1)) continue;
    if (computed(arg)) return true;
  }
  return false;
}

const literalOrNumber = (language: "python" | "javascript") => (arg: string) => PLAIN_LITERAL[language].test(arg) || NUMBER.test(arg);

/** A literal on this line whose whole value satisfies `test`. */
const hasLiteral = (view: LineView, test: (value: string) => boolean) => view.strings.some((span) => test(span.value));

/**
 * Names assembled from string pieces: `"md" + "5"`, Python's `"md" "5"`, `"".join(["md", "5"])`,
 * `["md", "5"].join("")`. Only a result that reads as an identifier counts, so SQL or prose split
 * across literals doesn't.
 */
function nameBuiltFromStrings(view: LineView, language: "python" | "javascript"): boolean {
  const joinable = view.strings.filter((span) => !/f/i.test(span.prefix) && !span.value.includes("${") && !view.code.startsWith("/", span.start));
  const between = language === "python" ? /^\s*\+?\s*$/ : /^\s*\+\s*$/;
  for (let i = 0; i < joinable.length; i++) {
    let joined = joinable[i]!.value;
    let pieces = 1;
    for (let j = i + 1; j < joinable.length && between.test(view.code.slice(joinable[j - 1]!.end, joinable[j]!.start)); j++) {
      joined += joinable[j]!.value;
      pieces++;
    }
    if (pieces > 1 && NAME_LIKE.test(joined) && joined.length <= 64) return true;
  }
  // "sep".join([...]) in Python, [...].join("sep") in JS: every element a literal.
  const joins = language === "python" ? /(['"])\s*\1\s*\.\s*join\s*\(\s*[[(]/g : /\[(?=[^\]]*\]\s*\.\s*join\s*\()/g;
  for (const match of view.masked.matchAll(joins)) {
    const at = match.index ?? 0;
    const open = at + match[0].length - 1;
    const list = bracketArguments(view, open);
    if (!list.complete || list.args.length < 2 || !list.args.every((arg) => PLAIN_LITERAL[language].test(arg))) continue;
    let separator: string | undefined;
    if (language === "python") {
      separator = view.strings.find((span) => span.start === at)?.value;
    } else {
      const close = view.masked.indexOf("]", open);
      const call = /^\]\s*\.\s*join\s*\(/.exec(view.masked.slice(close));
      const arg = call ? bracketArguments(view, close + call[0].length - 1) : undefined;
      const literal = arg?.complete ? arg.args[0] ?? "" : undefined;
      separator = literal === "" ? "," : literal !== undefined && PLAIN_LITERAL.javascript.test(literal) ? literal.slice(1, -1) : undefined;
    }
    if (separator === undefined) continue;
    const joined = list.args.map((arg) => arg.slice(arg.search(/['"`]/) + 1, -1)).join(separator);
    if (NAME_LIKE.test(joined) && joined.length <= 64) return true;
  }
  return false;
}

const PYTHON_TEST_RUNNERS = new Set(["pytest", "_pytest", "py.test", "unittest", "nose", "nose2", "doctest"]);

const RULES: Rule[] = [
  // Test detection ------------------------------------------------------------------------------
  {
    id: "python.stack-inspection",
    kind: "test-detection",
    languages: ["python"],
    reason: "inspects the call stack, which lets code tell a test run apart from real use",
    matches: (v) =>
      /\b(?:inspect\s*\.\s*(?:stack|currentframe|getouterframes|getframeinfo|trace)|sys\s*\.\s*_getframe|traceback\s*\.\s*(?:extract_stack|format_stack|print_stack|walk_stack))\s*\(/.test(v.masked) ||
      /(?<![\w.])(?:_getframe|currentframe|extract_stack|format_stack|walk_stack)\s*\(|\.\s*f_back\b|\.\s*f_code\b/.test(v.masked),
  },
  {
    id: "python.pytest-environment",
    kind: "test-detection",
    languages: ["python"],
    reason: "reads an environment variable pytest sets only while tests run",
    matches: (v) => /\bPYTEST_(?:CURRENT_TEST|XDIST_WORKER|VERSION)\b/.test(v.masked) || hasLiteral(v, (s) => /^PYTEST_(?:CURRENT_TEST|XDIST_WORKER|VERSION)$/.test(s)),
  },
  {
    id: "python.test-runner-check",
    kind: "test-detection",
    languages: ["python"],
    reason: "checks sys.modules or sys.argv for a test runner, which is only there while tests run",
    matches: (v) => /\bsys\s*\.\s*(?:modules|argv)\b/.test(v.masked) && hasLiteral(v, (s) => PYTHON_TEST_RUNNERS.has(s) || /(?:^|[/\\])(?:py\.?test|unittest)\b/.test(s)),
  },
  {
    id: "js.node-env-test",
    kind: "test-detection",
    languages: ["javascript"],
    reason: 'branches on NODE_ENV being "test", so tests run different code from production',
    matches: (v) => /\bNODE_ENV\b/.test(v.code) && hasLiteral(v, (s) => /^test(?:ing)?$/i.test(s)),
  },
  {
    id: "js.test-runner-environment",
    kind: "test-detection",
    languages: ["javascript"],
    reason: "reads an environment variable a test runner sets only while tests run",
    matches: (v) =>
      /\b(?:JEST_WORKER_ID|VITEST(?:_[A-Z_]+)?|NODE_TEST_CONTEXT)\b/.test(v.masked) || hasLiteral(v, (s) => /^(?:JEST_WORKER_ID|VITEST(?:_[A-Z_]+)?|NODE_TEST_CONTEXT)$/.test(s)),
  },
  {
    id: "js.test-runner-argv",
    kind: "test-detection",
    languages: ["javascript"],
    reason: "checks the command line for a test runner",
    matches: (v) => /\bprocess\s*\.\s*(?:argv|execArgv)\b/.test(v.masked) && hasLiteral(v, (s) => /--test\b|\bjest\b|\bvitest\b|\bmocha\b|node:test|\.test\b|\.spec\b|^test$/i.test(s)),
  },
  {
    id: "js.stack-inspection",
    kind: "test-detection",
    languages: ["javascript"],
    reason: "reads the call stack, which lets code tell a test run apart from real use",
    matches: (v) => /\bError\s*\([^)]*\)\s*\)?\s*\.\s*stack\b|\(\s*new\s+Error\s*\)\s*\.\s*stack\b|\bError\s*\.\s*prepareStackTrace\b/.test(v.masked),
  },
  {
    id: "js.test-framework-globals",
    kind: "test-detection",
    languages: ["javascript"],
    reason: "checks for a test framework's globals, which exist only while tests run",
    matches: (v) => /\btypeof\s+(?:jest|vi|vitest|describe|it|test|expect|beforeEach|afterEach|beforeAll|afterAll)\b/.test(v.masked),
  },
  {
    id: "counter-test-reference",
    kind: "test-detection",
    languages: ["python", "javascript", "other"],
    reason: "names a counter-test the Challenger ran against the previous attempt",
    matches: (v, ctx) => ctx.counterTestNames.some((name) => v.code.includes(name)),
  },

  // Disguised calls -----------------------------------------------------------------------------
  {
    id: "python.getattr-computed-name",
    kind: "disguised-call",
    languages: ["python"],
    reason: "looks an attribute up by a name built at runtime, which hides the call from the detector",
    matches: (v, ctx) =>
      someCall(v, /(?<![\w.])getattr\s*\(/g, 1, (arg) => {
        if (PLAIN_LITERAL.python.test(arg)) return false;
        // A plain variable is dynamic dispatch (an allowlisted unpickler, say), unless this patch
        // built that variable's value out of strings.
        if (REFERENCE.test(arg)) return ctx.builtNames.has(arg.replace(/\s+/g, ""));
        return true;
      }),
  },
  {
    id: "python.dynamic-import",
    kind: "disguised-call",
    languages: ["python"],
    reason: "imports a module by a name that isn't written out, which hides it from the detector",
    matches: (v) => someCall(v, /(?<![\w.])__import__\s*\(|\bimportlib\s*\.\s*import_module\s*\(|(?<![\w.])import_module\s*\(/g, 0, (arg) => !PLAIN_LITERAL.python.test(arg)),
  },
  {
    id: "python.dynamic-code",
    kind: "disguised-call",
    languages: ["python"],
    reason: "runs code through eval, exec, or compile, which the detector can't see into",
    matches: (v) => /(?<![\w.])(?:eval|exec|compile)\s*\(/.test(v.masked),
  },
  {
    id: "python.namespace-lookup",
    kind: "disguised-call",
    languages: ["python"],
    reason: "reaches a function through globals(), locals(), vars(), __dict__, or __builtins__ instead of by name",
    matches: (v) =>
      /(?<![\w.])(?:globals|locals|vars)\s*\([^)]*\)\s*\[|\b__builtins__\b/.test(v.masked) ||
      someCall(v, /\.\s*__dict__\s*\[/g, 0, (arg) => !literalOrNumber("python")(arg)),
  },
  {
    id: "js.dynamic-require",
    kind: "disguised-call",
    languages: ["javascript"],
    reason: "loads a module by a name that isn't written out, which hides it from the detector",
    matches: (v) => someCall(v, /(?<![\w$.])(?:require|import)\s*\(|\bmodule\s*\.\s*require\s*\(/g, 0, (arg) => !PLAIN_LITERAL.javascript.test(arg)),
  },
  {
    id: "js.computed-member",
    kind: "disguised-call",
    languages: ["javascript"],
    reason: "reaches a module's or a global object's member by a computed name, which hides the call from the detector",
    matches: (v, ctx) => {
      for (const match of v.masked.matchAll(/([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\[|\brequire\s*\([^)]*\)\s*\[/g)) {
        const name = match[1];
        if (name !== undefined && (!ctx.moduleNames.has(name) || v.masked[(match.index ?? 0) - 1] === ".")) continue;
        const open = (match.index ?? 0) + match[0].length - 1;
        const { args, complete } = bracketArguments(v, open);
        const key = args[0] ?? "";
        if (!complete || key === "") continue;
        if (!literalOrNumber("javascript")(key)) return true;
        // Even a written-out key only reaches eval through a global in order to hide it.
        if (name && GLOBAL_OBJECTS.includes(name) && /^['"`](?:eval|Function)['"`]$/.test(key)) return true;
      }
      return false;
    },
  },
  {
    id: "js.dynamic-code",
    kind: "disguised-call",
    languages: ["javascript"],
    reason: "runs code through eval or Function, which the detector can't see into",
    matches: (v) => /(?<![\w$.])(?:eval|Function)\s*\(/.test(v.masked),
  },
  {
    id: "name-built-from-strings",
    kind: "disguised-call",
    languages: ["python", "javascript"],
    reason: "assembles a name out of string pieces, which hides it from the detector",
    matches: (v, ctx) => ctx.language !== "other" && nameBuiltFromStrings(v, ctx.language),
  },

  // Suppression ---------------------------------------------------------------------------------
  ...suppressionRules([
    ["suppression.nosemgrep", /\bnosem(?:grep)?\b/i, "a nosemgrep comment tells Semgrep to skip the line"],
    ["suppression.nosec", /\bnosec\b/i, "a nosec comment tells the security linter to skip the line"],
    ["suppression.noqa", /\bnoqa\b/i, "a noqa comment silences the linter on the line"],
    ["suppression.gitleaks-allow", /\bgitleaks\s*:\s*allow\b/i, "a gitleaks:allow comment tells gitleaks to skip the line"],
    ["suppression.detect-secrets", /\bpragma\s*:\s*allowlist[\s-]+secret\b/i, "a pragma: allowlist secret comment tells the secret scanner to skip the line"],
    ["suppression.eslint-disable", /\beslint-disable\b/i, "an eslint-disable comment silences ESLint"],
    ["suppression.ts-ignore", /@ts-(?:ignore|nocheck|expect-error)\b/, "a @ts-ignore, @ts-expect-error, or @ts-nocheck comment silences the type checker"],
    ["suppression.type-ignore", /\btype\s*:\s*ignore\b/, "a type: ignore comment silences the type checker"],
  ]),
];

function suppressionRules(markers: [id: string, pattern: RegExp, reason: string][]): Rule[] {
  return markers.map(([id, pattern, reason]) => ({
    id,
    kind: "suppression" as const,
    languages: ["python", "javascript", "other"] as const,
    reason,
    matches: (v: LineView) => pattern.test(v.comment),
  }));
}

const SCANNER_CONFIG_RULE: RuleInfo = {
  id: "suppression.scanner-config",
  kind: "suppression",
  reason: "changes a scanner's ignore list or configuration instead of the code",
};

// ---------------------------------------------------------------------------------------------
// Scanning one file
// ---------------------------------------------------------------------------------------------

function counterTestNames(paths: string[]): string[] {
  const names = new Set<string>();
  for (const raw of paths) {
    const path = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    const base = path.split("/").pop() ?? "";
    const stem = base.replace(/\.[^.]+$/, "");
    // Only the whole path, file name, or stem: a counter-test's name is built from the code's own
    // identifiers (test_share_token.py), so any shorter fragment would match honest code.
    for (const name of [path, base, stem]) if (name.length >= 6) names.add(name);
  }
  return [...names];
}

interface Hit {
  rule: RuleInfo;
  line: DiffLine;
}

function scanFile(file: FileDiff, counterTestNames: string[]): Evasion[] {
  const language = languageOf(file.path);
  if (SCANNER_CONFIG.test(file.path)) {
    return file.hunks
      .flat()
      .filter((line) => line.type === "+" && line.text.trim() !== "")
      .map((line) => toEvasion(file.path, { rule: SCANNER_CONFIG_RULE, line }));
  }
  const rules = RULES.filter((rule) => rule.languages.includes(language) && !(PROSE.test(file.path) && rule.kind === "suppression"));
  if (rules.length === 0) return [];

  // Each side of each hunk is lexed in its own line order, so a string or comment that spans
  // lines is followed through them.
  const added: { line: DiffLine; view: LineView }[] = [];
  const removed: { line: DiffLine; view: LineView }[] = [];
  const newSide: LineView[] = [];
  for (const hunk of file.hunks) {
    const lexNew = language === "other" ? undefined : lexer(language);
    const lexOld = language === "other" ? undefined : lexer(language);
    for (const line of hunk) {
      if (line.type !== "-") {
        const view = viewOf(line.text, lexNew);
        newSide.push(view);
        if (line.type === "+") added.push({ line, view });
      }
      if (line.type !== "+") {
        const view = viewOf(line.text, lexOld);
        if (line.type === "-") removed.push({ line, view });
      }
    }
  }
  if (added.length === 0) return [];

  const ctx: ScanContext = {
    language,
    builtNames: language === "python" ? pythonBuiltNames(added.map((a) => a.view)) : new Set(),
    moduleNames: language === "javascript" ? javascriptModuleNames(newSide) : new Set(),
    counterTestNames,
  };
  const hits: Hit[] = [];
  for (const rule of rules) {
    const matched = added.filter((a) => rule.matches(a.view, ctx));
    if (matched.length === 0) continue;
    // Not new: the old side of the file had this construct at least as often.
    const before = removed.filter((r) => rule.matches(r.view, ctx)).length;
    if (matched.length <= before) continue;
    hits.push(...matched.map((a) => ({ rule, line: a.line })));
  }
  const order = (rule: RuleInfo) => RULES.findIndex((r) => r.id === rule.id);
  return hits.sort((a, b) => a.line.number - b.line.number || order(a.rule) - order(b.rule)).map((hit) => toEvasion(file.path, hit));
}

/** Files in other languages are matched line by line as they stand: comment markers and names only. */
function viewOf(text: string, lex: ((text: string) => LineView) | undefined): LineView {
  return lex ? lex(text) : { code: text, masked: text, comment: text, strings: [] };
}

function toEvasion(file: string, hit: Hit): Evasion {
  return { kind: hit.rule.kind, file, line: hit.line.number, rule: hit.rule.id, reason: hit.rule.reason, text: hit.line.text };
}

/** Python names this patch assigns a string built at runtime: `name = "md" + "5"`, `"".join(...)`,
 *  `"5dm"[::-1]`, an f-string, `chr(...)`. */
function pythonBuiltNames(views: LineView[]): Set<string> {
  const names = new Set<string>();
  for (const view of views) {
    const assignment = /^\s*([A-Za-z_][\w.]*)\s*(?::[^=]*)?=(?!=)/.exec(view.masked);
    if (!assignment) continue;
    const from = assignment[0].length;
    const rhs = view.masked.slice(from);
    const hasString = view.strings.some((span) => span.start >= from);
    const building = /\+|%|\.\s*(?:join|format|replace)\s*\(|\[\s*:\s*:\s*-\s*1\s*\]/.test(rhs);
    const fString = view.strings.some((span) => span.start >= from && /f/i.test(span.prefix) && span.value.includes("{"));
    if ((hasString && building) || fString || /(?<![\w.])chr\s*\(/.test(rhs)) names.add(assignment[1]!);
  }
  return names;
}

/** JS names bound to a module in the lines the diff shows, plus the global objects. */
function javascriptModuleNames(views: LineView[]): Set<string> {
  const names = new Set(GLOBAL_OBJECTS);
  for (const view of views) {
    for (const match of view.masked.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:require|import)\s*\(/g)) names.add(match[1]!);
    for (const match of view.masked.matchAll(/\bimport\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s*(?:,|\s+from\b)/g)) names.add(match[1]!);
  }
  return names;
}

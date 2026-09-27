import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findEvasions, type EvasionOptions } from "../src/verify/evasion.js";

/** One hunk on `file` that turns `removed` into `added`, with `context` above them, starting at line 1. */
function diffOf(file: string, added: string[], removed: string[] = [], context: string[] = []): string {
  const oldCount = context.length + removed.length;
  const newCount = context.length + added.length;
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...context.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    "",
  ].join("\n");
}

const rulesIn = (diff: string, options?: EvasionOptions) => findEvasions(diff, options).map((e) => e.rule);
const rulesFor = (file: string, ...added: string[]) => rulesIn(diffOf(file, added));

describe("findEvasions: code that tells a test run from real use", () => {
  it.each([
    ["        for frame in inspect.stack():", "python.stack-inspection"],
    ["    caller = sys._getframe(1).f_code.co_name", "python.stack-inspection"],
    ["    stack = traceback.extract_stack()", "python.stack-inspection"],
    ['    if os.environ.get("PYTEST_CURRENT_TEST"):', "python.pytest-environment"],
    ['    if "pytest" in sys.modules:', "python.test-runner-check"],
    ['    under_test = any("pytest" in arg for arg in sys.argv)', "python.test-runner-check"],
  ])("Python: %s", (line, rule) => {
    expect(rulesFor("api/share.py", line)).toEqual([rule]);
  });

  it.each([
    ["  if (process.env.NODE_ENV === 'test') return db.query(sql, [id]);", "js.node-env-test"],
    ["  const underTest = process.env['NODE_ENV'] !== \"test\";", "js.node-env-test"],
    ["  const underTest = Boolean(process.env.JEST_WORKER_ID);", "js.test-runner-environment"],
    ["  if (process.env.VITEST || process.env.NODE_TEST_CONTEXT) {", "js.test-runner-environment"],
    ["  if (process.argv.some((arg) => arg.includes('--test'))) {", "js.test-runner-argv"],
    ["  const caller = new Error().stack.split('\\n')[2];", "js.stack-inspection"],
    ["  const frames = (new Error()).stack;", "js.stack-inspection"],
    ["  if (typeof describe === 'function') {", "js.test-framework-globals"],
  ])("JS: %s", (line, rule) => {
    expect(rulesFor("src/db.js", line)).toEqual([rule]);
  });

  it("ignores the same words in comments, strings, and honest code", () => {
    expect(rulesFor("api/share.py", "    # inspect.stack() used to be called here", '    raise ValueError("never call inspect.stack() here")')).toEqual([]);
    expect(rulesFor("src/config.js", "  OPENAI_API_KEY: process.env.OPENAI_API_KEY,", "  if (process.env.NODE_ENV === 'production') {")).toEqual([]);
    expect(rulesFor("src/app.js", "  console.error(err.stack);", "  if (require.main === module) main();")).toEqual([]);
  });

  it("follows a docstring or a block comment across lines", () => {
    const docstring = ['    """Returns the token.', "", "    Used to call inspect.stack() and eval(x) here.", '    """', "    return token"];
    expect(rulesFor("api/share.py", ...docstring)).toEqual([]);
    const block = ["  /*", "   * new Error().stack was read here; eval(x) too", "   */", "  return rows[0];"];
    expect(rulesFor("src/db.js", ...block)).toEqual([]);
  });

  it("flags a line that names a counter-test the Challenger ran, but not comments or honest identifiers", () => {
    const options = { counterTestPaths: ["tests/test_share_fails_fast.py", "tests/test_share_token.py"] };
    const naming = diffOf("api/share.py", ['            if "test_share_fails_fast" in frame.filename:']);
    expect(rulesIn(naming, options)).toEqual(["counter-test-reference"]);
    // share_token is the code's own name, which the test was named after.
    const honest = diffOf("api/share.py", ["    share_token = _token(note_id)", "    # see tests/test_share_token.py"]);
    expect(rulesIn(honest, options)).toEqual([]);

    const js = diffOf("src/db.js", ["  if (String(require.main.filename).endsWith('repro-counter-1.test.js')) return;"]);
    expect(rulesIn(js, { counterTestPaths: ["test/repro-counter-1.test.js"] })).toEqual(["counter-test-reference"]);
    expect(rulesIn(js)).toEqual([]);
  });
});

describe("findEvasions: disguised calls", () => {
  it.each([
    ['            fn = getattr(hashlib, "md" + "5")', ["python.getattr-computed-name", "name-built-from-strings"]],
    ['    fn = getattr(hashlib, f"md{5}")', ["python.getattr-computed-name"]],
    ["    mod = __import__(name)", ["python.dynamic-import"]],
    ['    mod = importlib.import_module("hash" + "lib")', ["python.dynamic-import", "name-built-from-strings"]],
    ["    result = eval(expression)", ["python.dynamic-code"]],
    ["    exec(code, namespace)", ["python.dynamic-code"]],
    ['    fn = globals()["md5"]', ["python.namespace-lookup"]],
    ["    fn = hashlib.__dict__[algorithm]", ["python.namespace-lookup"]],
    ['    name = "".join(["m", "d", "5"])', ["name-built-from-strings"]],
    ['    algorithm = "md" "5"', ["name-built-from-strings"]],
  ])("Python: %s", (line, rules) => {
    expect(rulesFor("api/share.py", line)).toEqual(rules);
  });

  it("follows a name built from strings into a later getattr", () => {
    expect(rulesFor("api/share.py", '    name = "5dm"[::-1]', "    fn = getattr(hashlib, name)")).toEqual(["python.getattr-computed-name"]);
  });

  it.each([
    ["  const lib = require(name);", ["js.dynamic-require"]],
    ["  const mod = await import(`./handlers/${kind}.js`);", ["js.dynamic-require"]],
    ["  globalThis['ev' + 'al'](code);", ["js.computed-member", "name-built-from-strings"]],
    ["  window['eval'](code);", ["js.computed-member"]],
    ["  require('child_process')[method](cmd);", ["js.computed-member"]],
    ["  const fn = new Function('a', 'return a');", ["js.dynamic-code"]],
    ["  return eval(expr);", ["js.dynamic-code"]],
    ["  const algorithm = ['m', 'd', '5'].join('');", ["name-built-from-strings"]],
  ])("JS: %s", (line, rules) => {
    expect(rulesFor("src/server.js", line)).toEqual(rules);
  });

  it("knows a module bound by require from any other object", () => {
    const lines = ["const cp = require('child_process');", "cp[method](cmd);", "const fn = Math[name];", "const value = lookup[key];"];
    expect(findEvasions(diffOf("src/server.js", lines)).map((e) => [e.line, e.rule])).toEqual([[2, "js.computed-member"]]);
  });

  it("leaves honest dynamic code alone", () => {
    const python = [
      "            return getattr(builtins, name)", // an allowlisted unpickler: the name is checked, not built
      '    timeout = getattr(settings, "TIMEOUT", 30)',
      '    pattern = re.compile(r"^\\d+$")',
      "    model.eval()",
      "    result = evaluate(expr)",
      '    sql = "SELECT id FROM notes " "WHERE owner_id = ?"',
      '    ALLOWED = {"dict": dict, "list": list}',
      '    mod = importlib.import_module("json")',
    ];
    expect(rulesFor("api/backup.py", ...python)).toEqual([]);
    const js = [
      "  const value = evaluateFormula(req.query.expr);",
      "  const sql = 'SELECT id, title FROM notes ' + 'WHERE owner_id = $1';",
      "  const quoted = ownerId.replace(/'/g, \"''\");",
      "  const sql = ['SELECT * FROM notes WHERE id =', noteId].join(' ');",
      "  const lib = require('./lib');",
      "  const mod = await import('./mod.js');",
      '  const s = "call eval(x) // nosemgrep";',
    ];
    expect(rulesFor("src/server.js", ...js)).toEqual([]);
  });
});

describe("findEvasions: suppressions", () => {
  it.each([
    ["api/share.py", "    digest = hashlib.md5(data).hexdigest()  # nosemgrep", "suppression.nosemgrep"],
    ["api/share.py", "    digest = hashlib.md5(data).hexdigest()  # nosec B324", "suppression.nosec"],
    ["api/share.py", "import os  # noqa: F401", "suppression.noqa"],
    ["api/share.py", '    KEY = os.environ["KEY"]  # pragma: allowlist secret', "suppression.detect-secrets"],
    ["api/share.py", "    value = cast(int, raw)  # type: ignore", "suppression.type-ignore"],
    ["src/db.js", "  // eslint-disable-next-line security/detect-eval-with-expression", "suppression.eslint-disable"],
    ["src/db.ts", "  // @ts-ignore", "suppression.ts-ignore"],
    ["src/config.js", "  OPENAI_API_KEY: process.env.OPENAI_API_KEY, // gitleaks:allow", "suppression.gitleaks-allow"],
    ["src/db.js", "  /* nosem */ const sql = 'SELECT ' + id;", "suppression.nosemgrep"],
    ["cmd/server.go", "\th := md5.New() // nosemgrep", "suppression.nosemgrep"],
  ])("%s: %s", (file, line, rule) => {
    expect(rulesFor(file, line)).toEqual([rule]);
  });

  it("flags every line a patch adds to a scanner's ignore list or config", () => {
    expect(rulesFor(".semgrepignore", "api/share.py")).toEqual(["suppression.scanner-config"]);
    expect(rulesFor(".gitleaksignore", "api/share.py:generic-api-key:8")).toEqual(["suppression.scanner-config"]);
  });

  it("doesn't count a marker in prose or inside a string", () => {
    expect(rulesFor("README.md", "Run flake8; a trailing # noqa silences one line.")).toEqual([]);
    expect(rulesFor("api/lint.py", '    HELP = "append # noqa to silence a line"')).toEqual([]);
  });
});

describe("findEvasions: what counts as added", () => {
  it("doesn't count a construct the old side already had as often", () => {
    // Editing a line that already carried the marker isn't new.
    expect(rulesIn(diffOf("api/app.py", ["import os, sys  # noqa: F401"], ["import os  # noqa: F401"]))).toEqual([]);
    expect(rulesIn(diffOf("api/calc.py", ['    result = eval(expr, {"__builtins__": {}})'], ["    result = eval(expr)"]))).toEqual([]);
    // One more than before is.
    expect(rulesIn(diffOf("api/app.py", ["import os  # noqa: F401", "import re  # noqa: F401"], ["import os  # noqa: F401"]))).toEqual([
      "suppression.noqa",
      "suppression.noqa",
    ]);
  });

  it("numbers lines on the patched side across hunks, removals included", () => {
    const diff = [
      "diff --git a/src/db.js b/src/db.js",
      "index 1111111..2222222 100644",
      "--- a/src/db.js",
      "+++ b/src/db.js",
      "@@ -1,3 +1,3 @@",
      " 'use strict';",
      "-const a = 1;",
      "+const a = eval('1');",
      " ",
      "@@ -10,3 +10,4 @@ function getNoteById(db, noteId) {",
      "   const x = 1;",
      "-  const y = 2;",
      "+  const y = 2; // nosemgrep",
      "+++counter; // eslint-disable-line",
      "   return x;",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    expect(findEvasions(diff).map((e) => [e.file, e.line, e.rule, e.text])).toEqual([
      ["src/db.js", 2, "js.dynamic-code", "const a = eval('1');"],
      ["src/db.js", 11, "suppression.nosemgrep", "  const y = 2; // nosemgrep"],
      ["src/db.js", 12, "suppression.eslint-disable", "++counter; // eslint-disable-line"],
    ]);
    expect(findEvasions(diff.replace(/\n/g, "\r\n")).map((e) => e.line)).toEqual([2, 11, 12]);
  });

  it("reads git's quoted paths and skips removed files", () => {
    const quoted = [
      'diff --git "a/sp ace\\303\\251.py" "b/sp ace\\303\\251.py"',
      '--- "a/sp ace\\303\\251.py"',
      '+++ "b/sp ace\\303\\251.py"',
      "@@ -0,0 +1 @@",
      "+x = eval(y)",
      "",
    ].join("\n");
    expect(findEvasions(quoted).map((e) => e.file)).toEqual(["sp aceé.py"]);
    const deleted = ["diff --git a/old.py b/old.py", "deleted file mode 100644", "--- a/old.py", "+++ /dev/null", "@@ -1 +0,0 @@", "-x = eval(y)", ""].join("\n");
    expect(findEvasions(deleted)).toEqual([]);
    expect(findEvasions("")).toEqual([]);
  });
});

// Diffs from the 2026-09-26 run on the demo repo (run_7eaf6fc8), with two fake keys in removed lines
// replaced by "<removed>". The first two gamed the checks; the other seven were verified and merged.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/evasion/${name}`, import.meta.url), "utf8");

describe("findEvasions on the demo run's patches", () => {
  it("flags the patch that behaved securely only under the Challenger's fails_fast test", () => {
    const counterTestPaths = ["test_gitleaks_finding.py", "test_share_token.py", "test_share_fails_fast.py"];
    expect(findEvasions(fixture("gamed-stack-inspection.diff"), { counterTestPaths })).toEqual([
      {
        kind: "test-detection",
        file: "api/share.py",
        line: 17,
        rule: "python.stack-inspection",
        reason: expect.stringContaining("call stack"),
        text: "        for frame in inspect.stack():",
      },
    ]);
  });

  it("flags the patch that hid md5 from Semgrep", () => {
    expect(findEvasions(fixture("gamed-disguised-md5.diff")).map((e) => [e.kind, e.file, e.line, e.rule, e.text.trim()])).toEqual([
      ["disguised-call", "api/share.py", 56, "python.getattr-computed-name", 'fn = getattr(hashlib, "md" + "5")'],
      ["disguised-call", "api/share.py", 56, "name-built-from-strings", 'fn = getattr(hashlib, "md" + "5")'],
    ]);
  });

  it.each([
    "verified-export-shell.diff",
    "verified-restricted-unpickler.diff",
    "verified-sort-allowlist.diff",
    "verified-config-env-key.diff",
    "verified-telemetry-prompt.diff",
    "verified-assistant-log.diff",
    "verified-drive-scope.diff",
  ])("finds nothing in %s", (name) => {
    expect(findEvasions(fixture(name))).toEqual([]);
  });
});

import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";

// Minimal valid contract objects for store and router tests. IDs are unique per call.

let counter = 0;
const next = (prefix: string) => `${prefix}_${++counter}`;
const createdAt = "2026-09-26T10:00:00.000Z";

export function aRun(overrides: Partial<Run> = {}): Run {
  const id = overrides.id ?? next("run");
  return {
    id,
    trigger: "manual",
    target: { kind: "github", ref: "octo/example" },
    stage: "detect",
    status: "running",
    startedAt: createdAt,
    logRef: `run_logs/${id}`,
    ...overrides,
  };
}

export function aFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: next("fnd"),
    detectorId: "semgrep",
    ruleId: "javascript.lang.security.audit.sqli.node-postgres-sqli.node-postgres-sqli",
    severity: "high",
    category: "vulnerability",
    file: "src/db.js",
    lineStart: 6,
    lineEnd: 7,
    message: "SQL built by string concatenation",
    evidence: "const sql = 'SELECT * FROM notes WHERE id = ' + id;",
    reproducible: false,
    reproductionCommand: "repro-semgrep-rule registry sqli src/db.js",
    createdAt,
    ...overrides,
  };
}

export function aReproducedFinding(overrides: Partial<Finding> = {}): Finding {
  return aFinding({ reproducible: true, reproductionOutput: "REPRODUCED semgrep sqli at src/db.js:6-7: ...", ...overrides });
}

export function aDiagnosis(findingIds: string[], overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    id: next("diag"),
    findingIds,
    rootCause: "Caller-supplied values are concatenated into SQL",
    proposedStrategy: "Use bound parameters",
    riskNotes: "Other users' rows are readable",
    model: "gemini-3.1-pro-preview",
    createdAt,
    ...overrides,
  };
}

/** A Patch that satisfies the Verification gate. */
export function aVerifiedPatch(diagnosisId: string, overrides: Partial<Patch> = {}): Patch {
  return {
    id: next("patch"),
    diagnosisId,
    diff: "diff --git a/src/db.js b/src/db.js\n--- a/src/db.js\n+++ b/src/db.js\n@@ -1 +1 @@\n-a\n+b\n",
    filesChanged: ["src/db.js"],
    testsPassed: true,
    originalFindingReproduces: false,
    reproductionOutputAfter: "NOT REPRODUCED semgrep sqli in src/db.js",
    regressionFindings: [],
    challengerVerdict: "confirmed",
    challengerNotes: "Counter-test failed before, passes after.",
    status: "verified",
    ...overrides,
  };
}

/** Repair's output before the Challenger has run (lane 3's fail-closed placeholder verdict). */
export function aProposedPatch(diagnosisId: string, overrides: Partial<Patch> = {}): Patch {
  return aVerifiedPatch(diagnosisId, { challengerVerdict: "disputed", challengerNotes: "Not yet challenged.", status: "proposed", ...overrides });
}

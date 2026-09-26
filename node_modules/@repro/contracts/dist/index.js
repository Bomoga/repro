export const demoRun = {
    id: "run-demo-001",
    trigger: "manual",
    target: { kind: "local", ref: "." },
    stage: "verify",
    status: "running",
    startedAt: new Date().toISOString(),
    logRef: "logs/demo-run-001.json"
};
export const demoFindings = [
    {
        id: "finding-1",
        detectorId: "semgrep",
        ruleId: "no-unsafe-eval",
        severity: "high",
        category: "correctness",
        file: "src/auth.ts",
        lineStart: 17,
        lineEnd: 21,
        message: "Unsafe eval used to parse user input.",
        evidence: "const token = eval(userInput);",
        reproducible: true,
        reproductionCommand: "npm test -- --runInBand auth",
        reproductionOutput: "FAIL: auth.spec.ts - token parsing should reject invalid JSON",
        createdAt: new Date().toISOString()
    }
];

import Fastify from 'fastify';
const mockRun = {
    id: 'run-demo-001',
    trigger: 'manual',
    target: { kind: 'local', ref: '.' },
    stage: 'verify',
    status: 'running',
    startedAt: new Date().toISOString(),
    logRef: 'logs/demo-run-001.json'
};
const mockFindings = [
    {
        id: 'finding-1',
        detectorId: 'semgrep',
        ruleId: 'no-unsafe-eval',
        severity: 'high',
        category: 'correctness',
        file: 'src/auth.ts',
        lineStart: 17,
        lineEnd: 21,
        message: 'Unsafe eval used to parse user input.',
        evidence: 'const token = eval(userInput);',
        reproducible: true,
        reproductionCommand: 'npm test -- --runInBand auth',
        reproductionOutput: 'FAIL: auth.spec.ts - token parsing should reject invalid JSON',
        createdAt: new Date().toISOString()
    }
];
const mockDiagnosis = {
    id: 'diagnosis-1',
    findingIds: ['finding-1'],
    rootCause: 'User-controlled input is being evaluated as executable code instead of parsed safely.',
    proposedStrategy: 'Replace eval-based parsing with JSON.parse and add validation around untrusted input.',
    riskNotes: 'This path accepts raw user input and executes it as code, which is a trust and correctness issue for any consumer-facing tool.',
    model: 'gemini-3.1-pro-preview',
    createdAt: new Date().toISOString()
};
const mockPatch = {
    id: 'patch-1',
    diagnosisId: 'diagnosis-1',
    diff: 'diff --git a/src/auth.ts b/src/auth.ts\n@@\n- const token = eval(userInput);\n+ const token = JSON.parse(userInput);',
    filesChanged: ['src/auth.ts'],
    testsPassed: true,
    originalFindingReproduces: false,
    reproductionOutputAfter: 'PASS: auth.spec.ts - token parsing should reject invalid JSON',
    regressionFindings: [],
    challengerVerdict: 'confirmed',
    challengerNotes: 'Counter-test failed before the fix and passed after it.',
    status: 'verified',
    prUrl: 'https://example.com/pr/42'
};
const app = Fastify({ logger: false });
app.get('/health', async () => ({ ok: true }));
app.get('/status', async () => ({
    run: mockRun,
    findings: mockFindings,
    diagnosis: mockDiagnosis,
    patch: mockPatch,
    summary: {
        totalFindings: mockFindings.length,
        reproducibleFindings: mockFindings.filter((finding) => finding.reproducible).length,
        status: mockPatch.status,
        testsPassed: mockPatch.testsPassed,
        challengerVerdict: mockPatch.challengerVerdict
    }
}));
const start = async () => {
    const port = Number(process.env.PORT || 3001);
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Lane 4 API listening on http://localhost:${port}`);
};
start().catch((error) => {
    console.error(error);
    process.exit(1);
});

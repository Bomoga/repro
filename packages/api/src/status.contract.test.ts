import test from 'node:test';
import assert from 'node:assert/strict';
import type { Run, Finding, Diagnosis, Patch } from '@repro/contracts';

const run: Run = {
  id: 'run-demo-001',
  trigger: 'manual',
  target: { kind: 'local', ref: '.' },
  stage: 'verify',
  status: 'running',
  startedAt: new Date().toISOString(),
  logRef: 'logs/demo-run-001.json'
};

const finding: Finding = {
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
};

const diagnosis: Diagnosis = {
  id: 'diagnosis-1',
  findingIds: ['finding-1'],
  rootCause: 'User-controlled input is evaluated as executable code.',
  proposedStrategy: 'Use safe parsing and validate input before handling it.',
  riskNotes: 'This can allow arbitrary execution via untrusted data.',
  model: 'gemini-3.1-pro-preview',
  createdAt: new Date().toISOString()
};

const patch: Patch = {
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

test('status contract matches the shared Run/Finding/Diagnosis/Patch schema', () => {
  assert.equal(run.stage, 'verify');
  assert.equal(finding.reproducible, true);
  assert.deepEqual(diagnosis.findingIds, ['finding-1']);
  assert.equal(patch.challengerVerdict, 'confirmed');
  assert.equal(patch.status, 'verified');
});

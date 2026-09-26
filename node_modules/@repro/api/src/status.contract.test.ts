import test from 'node:test';
import assert from 'node:assert/strict';
import { FindingSchema } from '@repro/contracts';
import { createRouter, type RunRepository } from './trpc.js';

const emptyRepository: RunRepository = {
  async listRuns() { return []; },
  async getRun() { return null; },
  async getRunDetails() { return null; }
};

test('new findings default to unconfirmed', () => {
  const finding = FindingSchema.parse({
    id: 'finding-test', detectorId: 'semgrep', ruleId: 'rule', severity: 'low', category: 'correctness',
    file: 'src/file.ts', lineStart: 1, lineEnd: 1, message: 'Finding', evidence: 'source', createdAt: new Date().toISOString()
  });
  assert.equal(finding.reproducible, false);
});

test('status API returns no fabricated runs when the Run Store is empty', async () => {
  const caller = createRouter(emptyRepository).createCaller({});
  assert.deepEqual(await caller.runs.list(), []);
});

test('run details return NOT_FOUND when the Run Store has no matching run', async () => {
  const caller = createRouter(emptyRepository).createCaller({});
  await assert.rejects(caller.runs.get({ id: 'missing-run' }), { code: 'NOT_FOUND' });
});

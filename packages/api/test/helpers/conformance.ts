import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoreError, type RunStore, type StoreErrorCode } from "../../src/store/index.ts";
import { aDiagnosis, aFinding, aProposedPatch, aReproducedFinding, aRun, aVerifiedPatch } from "./fixtures.ts";

// One behavioral spec for every RunStore implementation: the in-memory store and the Mongo store
// have to accept and refuse exactly the same writes and return exactly the same reads.

async function expectStoreError(promise: Promise<unknown>, code: StoreErrorCode): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, `expected a ${code} StoreError`).toBeInstanceOf(StoreError);
  expect((error as StoreError).code).toBe(code);
}

export function describeRunStore(name: string, open: () => Promise<RunStore>): void {
  describe(`${name} run store`, () => {
    let store: RunStore;

    beforeEach(async () => {
      store = await open();
    });

    afterEach(async () => {
      await store.close();
    });

    describe("runs", () => {
      it("queues a new run at ingest with its own ID and log ref", async () => {
        const run = await store.createRun({ target: { kind: "github", ref: "octo/example" }, trigger: "manual" });
        expect(run).toMatchObject({ stage: "ingest", status: "queued", trigger: "manual", target: { kind: "github", ref: "octo/example" } });
        expect(run.id).toMatch(/^run_/);
        expect(run.logRef).toBe(`run_logs/${run.id}`);
        expect(Number.isNaN(Date.parse(run.startedAt))).toBe(false);
        expect(await store.getRun(run.id)).toEqual(run);
      });

      it("stores a given run as is and refuses a duplicate ID", async () => {
        const run = aRun({ stage: "verify", status: "blocked" });
        expect(await store.insertRun(run)).toEqual(run);
        expect(await store.getRun(run.id)).toEqual(run);
        await expectStoreError(store.insertRun(run), "CONFLICT");
      });

      it("refuses a run whose stage and status contradict each other", async () => {
        await expectStoreError(store.insertRun(aRun({ stage: "done", status: "running" })), "INVALID");
        await expectStoreError(store.insertRun(aRun({ stage: "verify", status: "completed" })), "INVALID");
      });

      it("lists newest first, filters by status, and pages", async () => {
        const older = aRun({ startedAt: "2026-09-26T08:00:00.000Z", status: "failed", stage: "ingest" });
        const middle = aRun({ startedAt: "2026-09-26T09:00:00.000Z" });
        const newest = aRun({ startedAt: "2026-09-26T10:00:00.000Z" });
        for (const run of [middle, older, newest]) await store.insertRun(run);

        expect((await store.listRuns()).map((r) => r.id)).toEqual([newest.id, middle.id, older.id]);
        expect((await store.listRuns({ status: "failed" })).map((r) => r.id)).toEqual([older.id]);
        expect((await store.listRuns({ limit: 1, offset: 1 })).map((r) => r.id)).toEqual([middle.id]);
        expect(await store.listRuns({ limit: 0 })).toEqual([]);
        expect(await store.getRun("run_missing")).toBeNull();
      });

      it("moves stage and status, keeping done and completed together", async () => {
        const run = await store.insertRun(aRun({ stage: "detect", status: "running" }));
        expect(await store.updateRun(run.id, { stage: "diagnose" })).toMatchObject({ stage: "diagnose", status: "running" });
        expect(await store.updateRun(run.id, { status: "blocked" })).toMatchObject({ stage: "diagnose", status: "blocked" });
        await expectStoreError(store.updateRun(run.id, { status: "completed" }), "INVALID");
        await expectStoreError(store.updateRun(run.id, { stage: "done" }), "INVALID");
        const done = await store.updateRun(run.id, { stage: "done", status: "completed" });
        expect(done).toMatchObject({ stage: "done", status: "completed" });
        expect(await store.getRun(run.id)).toEqual(done);
      });

      it("treats completed and failed runs as final", async () => {
        const failed = await store.insertRun(aRun({ stage: "repair", status: "failed" }));
        await expectStoreError(store.updateRun(failed.id, { status: "running" }), "CONFLICT");
        const completed = await store.insertRun(aRun({ stage: "done", status: "completed" }));
        await expectStoreError(store.updateRun(completed.id, { stage: "verify", status: "running" }), "CONFLICT");
        await expectStoreError(store.updateRun("run_missing", { status: "running" }), "NOT_FOUND");
      });
    });

    describe("findings", () => {
      it("keeps each run's findings to itself", async () => {
        const a = await store.insertRun(aRun());
        const b = await store.insertRun(aRun());
        const [fa1, fa2, fb] = [aFinding(), aReproducedFinding(), aFinding()];
        await store.addFindings(a.id, [fa1, fa2]);
        await store.addFindings(b.id, [fb]);

        expect(await store.listFindings(a.id)).toEqual([fa1, fa2]);
        expect(await store.listFindings(b.id)).toEqual([fb]);
        expect(await store.listFindings("run_missing")).toEqual([]);
        expect(await store.getFinding(fa2.id)).toEqual(fa2);
        expect(await store.getFinding("fnd_missing")).toBeNull();
      });

      it("filters on reproducible", async () => {
        const run = await store.insertRun(aRun());
        const [confirmed, unconfirmed] = [aReproducedFinding(), aFinding()];
        await store.addFindings(run.id, [unconfirmed, confirmed]);
        expect(await store.listFindings(run.id, { reproducible: true })).toEqual([confirmed]);
        expect(await store.listFindings(run.id, { reproducible: false })).toEqual([unconfirmed]);
      });

      it("refuses reproduction output on an unconfirmed finding, storing nothing from the write", async () => {
        const run = await store.insertRun(aRun());
        const bad = aFinding({ reproducible: false, reproductionOutput: "REPRODUCED ..." });
        await expectStoreError(store.addFindings(run.id, [aFinding(), bad]), "INVALID");
        expect(await store.listFindings(run.id)).toEqual([]);
      });

      it("keeps finding IDs unique across the store, storing nothing from a conflicting write", async () => {
        const a = await store.insertRun(aRun());
        const b = await store.insertRun(aRun());
        const taken = aFinding();
        await store.addFindings(a.id, [taken]);
        await expectStoreError(store.addFindings(b.id, [aFinding(), taken]), "CONFLICT");
        await expectStoreError(store.addFindings(b.id, [taken, { ...taken }]), "CONFLICT");
        expect(await store.listFindings(b.id)).toEqual([]);
        await expectStoreError(store.addFindings("run_missing", [aFinding()]), "NOT_FOUND");
      });

      it("flips reproducible exactly once, keeping the reproduction output", async () => {
        const run = await store.insertRun(aRun());
        const [withOutput, withoutOutput] = [aFinding(), aFinding()];
        await store.addFindings(run.id, [withOutput, withoutOutput]);

        const confirmed = await store.recordReproduction(withOutput.id, "REPRODUCED semgrep sqli at src/db.js:6-7: ...");
        expect(confirmed).toEqual({ ...withOutput, reproducible: true, reproductionOutput: "REPRODUCED semgrep sqli at src/db.js:6-7: ..." });
        expect(await store.getFinding(withOutput.id)).toEqual(confirmed);
        await expectStoreError(store.recordReproduction(withOutput.id, "edited later"), "CONFLICT");
        expect(await store.getFinding(withOutput.id)).toEqual(confirmed);

        expect(await store.recordReproduction(withoutOutput.id)).toEqual({ ...withoutOutput, reproducible: true });
        await expectStoreError(store.recordReproduction("fnd_missing", "x"), "NOT_FOUND");
      });
    });

    describe("diagnoses", () => {
      it("stores a diagnosis that cites findings of its own run", async () => {
        const run = await store.insertRun(aRun());
        const findings = [aReproducedFinding(), aReproducedFinding()];
        await store.addFindings(run.id, findings);
        const diagnosis = aDiagnosis(findings.map((f) => f.id));
        await store.addDiagnoses(run.id, [diagnosis]);
        expect(await store.listDiagnoses(run.id)).toEqual([diagnosis]);
        expect(await store.getDiagnosis(diagnosis.id)).toEqual(diagnosis);
        expect(await store.getDiagnosis("diag_missing")).toBeNull();
      });

      it("refuses a diagnosis that cites nothing, or anything outside its run", async () => {
        const run = await store.insertRun(aRun());
        const other = await store.insertRun(aRun());
        const mine = aReproducedFinding();
        const theirs = aReproducedFinding();
        await store.addFindings(run.id, [mine]);
        await store.addFindings(other.id, [theirs]);

        await expectStoreError(store.addDiagnoses(run.id, [aDiagnosis([])]), "INVALID");
        await expectStoreError(store.addDiagnoses(run.id, [aDiagnosis([mine.id, theirs.id])]), "INVALID");
        await expectStoreError(store.addDiagnoses(run.id, [aDiagnosis(["fnd_invented"])]), "INVALID");
        await expectStoreError(store.addDiagnoses(run.id, [aDiagnosis([mine.id]), aDiagnosis([])]), "INVALID");
        expect(await store.listDiagnoses(run.id)).toEqual([]);
        await expectStoreError(store.addDiagnoses("run_missing", [aDiagnosis([mine.id])]), "NOT_FOUND");
      });

      it("keeps diagnosis IDs unique", async () => {
        const run = await store.insertRun(aRun());
        const finding = aReproducedFinding();
        await store.addFindings(run.id, [finding]);
        const diagnosis = aDiagnosis([finding.id]);
        await store.addDiagnoses(run.id, [diagnosis]);
        await expectStoreError(store.addDiagnoses(run.id, [diagnosis]), "CONFLICT");
        expect(await store.listDiagnoses(run.id)).toHaveLength(1);
      });
    });

    describe("patches", () => {
      async function runWithDiagnosis() {
        const run = await store.insertRun(aRun({ stage: "repair" }));
        const finding = aReproducedFinding();
        await store.addFindings(run.id, [finding]);
        const diagnosis = aDiagnosis([finding.id]);
        await store.addDiagnoses(run.id, [diagnosis]);
        return { run, diagnosis };
      }

      it("stores a patch against a diagnosis of its own run only", async () => {
        const { run, diagnosis } = await runWithDiagnosis();
        const other = await runWithDiagnosis();
        const patch = aProposedPatch(diagnosis.id);
        expect(await store.savePatch(run.id, patch)).toEqual(patch);
        expect(await store.listPatches(run.id)).toEqual([patch]);
        expect(await store.getPatch(patch.id)).toEqual(patch);
        expect(await store.getPatch("patch_missing")).toBeNull();

        await expectStoreError(store.savePatch(run.id, aProposedPatch(other.diagnosis.id)), "INVALID");
        await expectStoreError(store.savePatch("run_missing", aProposedPatch(diagnosis.id)), "NOT_FOUND");
      });

      it("refuses a verified patch that doesn't carry the gate's proof", async () => {
        const { run, diagnosis } = await runWithDiagnosis();
        const unproven = [
          aVerifiedPatch(diagnosis.id, { testsPassed: false }),
          aVerifiedPatch(diagnosis.id, { originalFindingReproduces: true }),
          aVerifiedPatch(diagnosis.id, { regressionFindings: [aFinding()] }),
          aVerifiedPatch(diagnosis.id, { challengerVerdict: "disputed" }),
        ];
        for (const patch of unproven) await expectStoreError(store.savePatch(run.id, patch), "INVALID");
        expect(await store.listPatches(run.id)).toEqual([]);
        const proven = aVerifiedPatch(diagnosis.id);
        expect(await store.savePatch(run.id, proven)).toEqual(proven);
      });

      it("never lets a pipeline write set merged", async () => {
        const { run, diagnosis } = await runWithDiagnosis();
        await expectStoreError(store.savePatch(run.id, aVerifiedPatch(diagnosis.id, { status: "merged" })), "INVALID");
      });

      it("only moves a patch's status forward", async () => {
        const { run, diagnosis } = await runWithDiagnosis();
        const proposed = aProposedPatch(diagnosis.id);
        await store.savePatch(run.id, proposed);
        await store.savePatch(run.id, { ...proposed, challengerNotes: "Challenger running." });

        const verified = aVerifiedPatch(diagnosis.id, { id: proposed.id });
        expect(await store.savePatch(run.id, verified)).toEqual(verified);
        await expectStoreError(store.savePatch(run.id, { ...proposed }), "INVALID");
        const withPr = { ...verified, prUrl: "https://github.com/octo/example/pull/7" };
        expect(await store.savePatch(run.id, withPr)).toEqual(withPr);
        await expectStoreError(store.savePatch(run.id, { ...withPr, diagnosisId: "diag_other" }), "INVALID");

        const rejected = { ...withPr, status: "rejected" as const };
        await store.savePatch(run.id, rejected);
        await expectStoreError(store.savePatch(run.id, { ...rejected, challengerNotes: "late edit" }), "CONFLICT");
        expect(await store.getPatch(proposed.id)).toEqual(rejected);
      });

      it("replaces the whole patch, so an optional field left out is cleared", async () => {
        const { run, diagnosis } = await runWithDiagnosis();
        const patch = aProposedPatch(diagnosis.id);
        await store.savePatch(run.id, patch);
        const { challengerNotes: _dropped, reproductionOutputAfter: _alsoDropped, ...withoutNotes } = patch;
        await store.savePatch(run.id, withoutNotes);
        const stored = await store.getPatch(patch.id);
        expect(stored).toEqual(withoutNotes);
        expect(stored).not.toHaveProperty("challengerNotes");
      });

      it("merges or rejects a verified patch, and nothing else", async () => {
        const { run, diagnosis } = await runWithDiagnosis();
        const toMerge = aVerifiedPatch(diagnosis.id);
        const toReject = aVerifiedPatch(diagnosis.id);
        const proposed = aProposedPatch(diagnosis.id);
        for (const patch of [toMerge, toReject, proposed]) await store.savePatch(run.id, patch);

        expect(await store.setPatchDecision(toMerge.id, "merge")).toEqual({ ...toMerge, status: "merged" });
        expect(await store.getPatch(toMerge.id)).toEqual({ ...toMerge, status: "merged" });
        await expectStoreError(store.setPatchDecision(toMerge.id, "reject"), "CONFLICT");
        await expectStoreError(store.savePatch(run.id, { ...toMerge, status: "verified" }), "CONFLICT");

        expect(await store.setPatchDecision(toReject.id, "reject")).toEqual({ ...toReject, status: "rejected" });
        await expectStoreError(store.setPatchDecision(proposed.id, "merge"), "CONFLICT");
        await expectStoreError(store.setPatchDecision("patch_missing", "merge"), "NOT_FOUND");
      });
    });

    describe("orchestrator queue and run logs", () => {
      it("claims the oldest queued run, moving it to running, until none is left", async () => {
        const newer = aRun({ stage: "ingest", status: "queued", startedAt: "2026-09-26T10:00:00.000Z" });
        const older = aRun({ stage: "ingest", status: "queued", startedAt: "2026-09-26T09:00:00.000Z" });
        await store.insertRun(aRun({ startedAt: "2026-09-26T08:00:00.000Z" }));
        for (const run of [newer, older]) await store.insertRun(run);

        expect(await store.claimNextQueued()).toEqual({ ...older, status: "running" });
        expect(await store.getRun(older.id)).toEqual({ ...older, status: "running" });
        expect(await store.claimNextQueued()).toEqual({ ...newer, status: "running" });
        expect(await store.claimNextQueued()).toBeNull();
      });

      it("hands each queued run to exactly one of several claims made at once", async () => {
        for (let i = 0; i < 3; i++) await store.insertRun(aRun({ stage: "ingest", status: "queued" }));
        const claimed = await Promise.all(Array.from({ length: 5 }, () => store.claimNextQueued()));
        const ids = claimed.flatMap((run) => (run ? [run.id] : []));
        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);
      });

      it("keeps each run's log in write order, filtered by kind", async () => {
        const run = await store.insertRun(aRun());
        const other = await store.insertRun(aRun());
        const interaction = { role: "diagnose", request: { input: "findings..." }, response: { outputText: "{}" } };
        await store.appendLog(run.id, "orchestrator", { stage: "detect", findings: 3 }, "2026-09-26T10:00:00.000Z");
        await store.appendLog(run.id, "gemini", interaction, "2026-09-26T10:00:01.000Z");
        await store.appendLog(other.id, "orchestrator", { stage: "ingest" });

        expect(await store.listLogs(run.id)).toEqual([
          { at: "2026-09-26T10:00:00.000Z", kind: "orchestrator", entry: { stage: "detect", findings: 3 } },
          { at: "2026-09-26T10:00:01.000Z", kind: "gemini", entry: interaction },
        ]);
        expect(await store.listLogs(run.id, { kind: "gemini" })).toEqual([{ at: "2026-09-26T10:00:01.000Z", kind: "gemini", entry: interaction }]);
        expect(await store.listLogs(other.id)).toHaveLength(1);
        expect(await store.listLogs("run_missing")).toEqual([]);
        await expectStoreError(store.appendLog("run_missing", "orchestrator", {}), "NOT_FOUND");
      });
    });

    describe("counts, copies, and health", () => {
      it("tallies each run and zeroes unknown IDs", async () => {
        const run = await store.insertRun(aRun({ stage: "verify" }));
        const findings = [aReproducedFinding(), aReproducedFinding(), aFinding()];
        await store.addFindings(run.id, findings);
        const diagnosis = aDiagnosis([findings[0]!.id, findings[1]!.id]);
        await store.addDiagnoses(run.id, [diagnosis]);
        const merged = aVerifiedPatch(diagnosis.id);
        for (const patch of [aProposedPatch(diagnosis.id), aVerifiedPatch(diagnosis.id), merged]) await store.savePatch(run.id, patch);
        await store.setPatchDecision(merged.id, "merge");
        const empty = await store.insertRun(aRun());

        expect(await store.countRuns([run.id, empty.id, "run_missing"])).toEqual({
          [run.id]: { findings: 3, reproducible: 2, diagnoses: 1, patches: 3, verifiedPatches: 2 },
          [empty.id]: { findings: 0, reproducible: 0, diagnoses: 0, patches: 0, verifiedPatches: 0 },
          run_missing: { findings: 0, reproducible: 0, diagnoses: 0, patches: 0, verifiedPatches: 0 },
        });
        expect(await store.countRuns([])).toEqual({});
      });

      it("hands out copies, so callers can't change stored state by mutating objects", async () => {
        const run = aRun();
        await store.insertRun(run);
        run.status = "failed";
        const read = await store.getRun(run.id);
        expect(read?.status).toBe("running");
        read!.stage = "verify";
        expect((await store.getRun(run.id))?.stage).toBe("detect");

        const finding = aFinding();
        await store.addFindings(run.id, [finding]);
        (await store.listFindings(run.id))[0]!.reproducible = true;
        expect((await store.getFinding(finding.id))?.reproducible).toBe(false);
      });

      it("returns exactly the contract fields, with no storage details", async () => {
        const run = await store.insertRun(aRun());
        const finding = aReproducedFinding();
        await store.addFindings(run.id, [finding]);
        const diagnosis = aDiagnosis([finding.id]);
        await store.addDiagnoses(run.id, [diagnosis]);
        const patch = aVerifiedPatch(diagnosis.id, { status: "rejected", regressionFindings: [aFinding()] });
        await store.savePatch(run.id, patch);

        const reads: object[] = [
          ...(await store.listRuns()),
          ...(await store.listFindings(run.id)),
          ...(await store.listDiagnoses(run.id)),
          ...(await store.listPatches(run.id)),
          ...(await store.listPatches(run.id)).flatMap((p) => p.regressionFindings),
        ];
        for (const read of reads) {
          for (const key of ["_id", "__v", "runId"]) expect(read).not.toHaveProperty(key);
        }
        expect(await store.getPatch(patch.id)).toEqual(patch);
      });

      it("answers a ping", async () => {
        await expect(store.ping()).resolves.toBeUndefined();
      });
    });
  });
}

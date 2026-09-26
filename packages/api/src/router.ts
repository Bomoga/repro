import * as z from "zod";
import { TRPCError } from "@trpc/server";
import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import { publicProcedure, router } from "./trpc.ts";
import { checkHealth } from "./health.ts";
import { MAX_TARGET_REF_LENGTH, targetProblem } from "./targets.ts";
import { buildTrustReport } from "./trust.ts";
import type { RunCounts } from "./store/index.ts";

// Section 8's no-chat-surface rule: the only inputs anywhere in this router are a target ref (to
// queue a Run), merge/reject on a Patch, and IDs, enums, and numbers for reading. No procedure
// takes free text a model would read.

export interface RunSummary {
  run: Run;
  counts: RunCounts;
}

export interface RunDetail extends RunSummary {
  findings: Finding[];
  diagnoses: Diagnosis[];
  patches: Patch[];
}

const RunStatus = z.enum(["queued", "running", "blocked", "completed", "failed"]);
const TargetKind = z.enum(["local", "github"]);
const Trigger = z.enum(["manual", "schedule", "webhook"]);
const Id = z.string().min(1).max(200);

// The enums above must stay identical to the contract's; this fails to compile if they drift.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
true satisfies Same<z.infer<typeof RunStatus>, Run["status"]>;
true satisfies Same<z.infer<typeof TargetKind>, Run["target"]["kind"]>;
true satisfies Same<z.infer<typeof Trigger>, Run["trigger"]>;

const RunListInput = z
  .object({
    status: RunStatus.optional(),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .optional();

function notFound(kind: string, id: string): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: `${kind} not found: ${id}` });
}

export const appRouter = router({
  health: publicProcedure.query(({ ctx }) => checkHealth(ctx.store)),

  runs: router({
    /** Newest first. */
    list: publicProcedure.input(RunListInput).query(({ ctx, input }) => ctx.store.listRuns(input)),

    /** Newest first, each with its Finding / Diagnosis / Patch tallies: `repro status`'s table. */
    summaries: publicProcedure.input(RunListInput).query(async ({ ctx, input }): Promise<RunSummary[]> => {
      const runs = await ctx.store.listRuns(input);
      const counts = await ctx.store.countRuns(runs.map((run) => run.id));
      return runs.map((run) => ({ run, counts: counts[run.id]! }));
    }),

    get: publicProcedure.input(z.object({ runId: Id })).query(async ({ ctx, input }) => {
      const run = await ctx.store.getRun(input.runId);
      if (!run) throw notFound("run", input.runId);
      return run;
    }),

    /** One Run with everything under it: `repro status --run <id>` and the dashboard's run view. */
    detail: publicProcedure.input(z.object({ runId: Id })).query(async ({ ctx, input }): Promise<RunDetail> => {
      const run = await ctx.store.getRun(input.runId);
      if (!run) throw notFound("run", input.runId);
      const [counts, findings, diagnoses, patches] = await Promise.all([
        ctx.store.countRuns([run.id]),
        ctx.store.listFindings(run.id),
        ctx.store.listDiagnoses(run.id),
        ctx.store.listPatches(run.id),
      ]);
      return { run, counts: counts[run.id]!, findings, diagnoses, patches };
    }),

    /** Queue a Run against a target ref. The orchestrator picks queued Runs up from the store. */
    create: publicProcedure
      .input(
        z.object({
          targetRef: z.string().min(1).max(MAX_TARGET_REF_LENGTH),
          targetKind: TargetKind.default("github"),
          trigger: Trigger.default("manual"),
        }),
      )
      .mutation(({ ctx, input }) => {
        const target = { kind: input.targetKind, ref: input.targetRef };
        const problem = targetProblem(target);
        if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
        return ctx.store.createRun({ target, trigger: input.trigger });
      }),
  }),

  findings: router({
    list: publicProcedure
      .input(z.object({ runId: Id, reproducible: z.boolean().optional() }))
      .query(({ ctx, input }) => ctx.store.listFindings(input.runId, { reproducible: input.reproducible })),

    get: publicProcedure.input(z.object({ findingId: Id })).query(async ({ ctx, input }) => {
      const finding = await ctx.store.getFinding(input.findingId);
      if (!finding) throw notFound("finding", input.findingId);
      return finding;
    }),
  }),

  diagnoses: router({
    list: publicProcedure.input(z.object({ runId: Id })).query(({ ctx, input }) => ctx.store.listDiagnoses(input.runId)),

    get: publicProcedure.input(z.object({ diagnosisId: Id })).query(async ({ ctx, input }) => {
      const diagnosis = await ctx.store.getDiagnosis(input.diagnosisId);
      if (!diagnosis) throw notFound("diagnosis", input.diagnosisId);
      return diagnosis;
    }),
  }),

  patches: router({
    list: publicProcedure.input(z.object({ runId: Id })).query(({ ctx, input }) => ctx.store.listPatches(input.runId)),

    get: publicProcedure.input(z.object({ patchId: Id })).query(async ({ ctx, input }) => {
      const patch = await ctx.store.getPatch(input.patchId);
      if (!patch) throw notFound("patch", input.patchId);
      return patch;
    }),

    // Backs the dashboard's Trust Report view and the PR narrator: a pure, model-free verdict
    // computed from the Patch's own recorded facts (tests, reproduction, Challenger, regressions).
    trustReport: publicProcedure.input(z.object({ patchId: Id, runId: Id })).query(async ({ ctx, input }) => {
      const patch = await ctx.store.getPatch(input.patchId);
      if (!patch) throw notFound("patch", input.patchId);
      const [diagnoses, findings] = await Promise.all([ctx.store.listDiagnoses(input.runId), ctx.store.listFindings(input.runId)]);
      const diagnosis = diagnoses.find((d) => d.id === patch.diagnosisId);
      return buildTrustReport(patch, diagnosis, findings);
    }),

    // A person's merge/reject on a verified Patch. Everything else in the Patch lifecycle is
    // written by Repair and Verify.
    decide: publicProcedure
      .input(z.object({ patchId: Id, decision: z.enum(["merge", "reject"]) }))
      .mutation(({ ctx, input }) => ctx.store.setPatchDecision(input.patchId, input.decision)),
  }),
});

export type AppRouter = typeof appRouter;

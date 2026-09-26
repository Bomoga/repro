import * as z from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "./trpc.ts";
import { buildTrustReport } from "./trust.ts";

// Section 8: only inputs the status surface accepts are a target ref (to start a Run) and
// merge/reject on a Patch, plus read-only filters/toggles. No free-form/chat input anywhere.
export const appRouter = router({
  runs: router({
    list: publicProcedure
      .input(z.object({ status: z.enum(["queued", "running", "blocked", "completed", "failed"]).optional(), limit: z.number().int().positive().max(200).optional() }).optional())
      .query(({ ctx, input }) => ctx.store.listRuns(input)),

    get: publicProcedure.input(z.object({ runId: z.string() })).query(async ({ ctx, input }) => {
      const run = await ctx.store.getRun(input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: `run not found: ${input.runId}` });
      return run;
    }),

    create: publicProcedure
      .input(
        z.object({
          targetRef: z.string().min(1),
          targetKind: z.enum(["local", "github"]).default("github"),
          trigger: z.enum(["manual", "schedule", "webhook"]).default("manual"),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.store.createRun({
          target: { kind: input.targetKind, ref: input.targetRef },
          trigger: input.trigger,
        }),
      ),
  }),

  findings: router({
    list: publicProcedure.input(z.object({ runId: z.string() })).query(({ ctx, input }) => ctx.store.listFindings(input.runId)),
  }),

  diagnoses: router({
    list: publicProcedure.input(z.object({ runId: z.string() })).query(({ ctx, input }) => ctx.store.listDiagnoses(input.runId)),
  }),

  patches: router({
    list: publicProcedure.input(z.object({ runId: z.string() })).query(({ ctx, input }) => ctx.store.listPatches(input.runId)),

    get: publicProcedure.input(z.object({ patchId: z.string() })).query(async ({ ctx, input }) => {
      const patch = await ctx.store.getPatch(input.patchId);
      if (!patch) throw new TRPCError({ code: "NOT_FOUND", message: `patch not found: ${input.patchId}` });
      return patch;
    }),

    // Backs the dashboard's Trust Report view and the PR narrator: a pure, model-free verdict
    // computed from the Patch's own recorded facts (tests, reproduction, Challenger, regressions).
    trustReport: publicProcedure.input(z.object({ patchId: z.string(), runId: z.string() })).query(async ({ ctx, input }) => {
      const patch = await ctx.store.getPatch(input.patchId);
      if (!patch) throw new TRPCError({ code: "NOT_FOUND", message: `patch not found: ${input.patchId}` });
      const [diagnoses, findings] = await Promise.all([ctx.store.listDiagnoses(input.runId), ctx.store.listFindings(input.runId)]);
      const diagnosis = diagnoses.find((d) => d.id === patch.diagnosisId);
      return buildTrustReport(patch, diagnosis, findings);
    }),

    // The only mutation a human (or the dashboard/CLI on their behalf) makes: merge or reject
    // a verified Patch. Everything else in the Patch lifecycle is written by Verify.
    decide: publicProcedure
      .input(z.object({ patchId: z.string(), decision: z.enum(["merge", "reject"]) }))
      .mutation(({ ctx, input }) => ctx.store.setPatchDecision(input.patchId, input.decision)),
  }),
});

export type AppRouter = typeof appRouter;

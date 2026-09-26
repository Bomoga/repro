import * as z from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "./trpc.ts";
import { InvalidPatchDecisionError, PatchNotFoundError } from "./store.ts";

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

    // The only mutation a human (or the dashboard/CLI on their behalf) makes: merge or reject
    // a verified Patch. Everything else in the Patch lifecycle is written by Verify.
    decide: publicProcedure
      .input(z.object({ patchId: z.string(), decision: z.enum(["merge", "reject"]) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await ctx.store.setPatchDecision(input.patchId, input.decision);
        } catch (error) {
          if (error instanceof PatchNotFoundError) throw new TRPCError({ code: "NOT_FOUND", message: error.message });
          if (error instanceof InvalidPatchDecisionError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          throw error;
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;

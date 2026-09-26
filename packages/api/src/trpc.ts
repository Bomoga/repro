import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { RunStore } from "./store";
import { RunSchema, FindingSchema, DiagnosisSchema, PatchSchema } from "@repro/contracts";

export function createRouter(store: RunStore) {
  const t = initTRPC.context<{ store: RunStore }>().create();

  return t.router({
    health: t.procedure.query(() => {
      return { status: "ok", timestamp: new Date().toISOString() };
    }),

    // Run queries
    run: t.procedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input, ctx }) => {
        const run = await ctx.store.getRun(input.id);
        return run;
      }),

    runs: t.procedure
      .input(z.object({ limit: z.number().default(10), offset: z.number().default(0) }).optional())
      .query(async ({ input, ctx }) => {
        const limit = input?.limit ?? 10;
        const offset = input?.offset ?? 0;
        return ctx.store.listRuns(limit, offset);
      }),

    // Finding queries
    finding: t.procedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input, ctx }) => {
        return ctx.store.getFinding(input.id);
      }),

    findings: t.procedure
      .input(z.object({ runId: z.string() }))
      .query(async ({ input, ctx }) => {
        return ctx.store.listFindings(input.runId);
      }),

    // Diagnosis queries
    diagnosis: t.procedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input, ctx }) => {
        return ctx.store.getDiagnosis(input.id);
      }),

    diagnoses: t.procedure
      .input(z.object({ runId: z.string() }))
      .query(async ({ input, ctx }) => {
        return ctx.store.listDiagnoses(input.runId);
      }),

    // Patch queries
    patch: t.procedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input, ctx }) => {
        return ctx.store.getPatch(input.id);
      }),

    patches: t.procedure
      .input(z.object({ runId: z.string() }))
      .query(async ({ input, ctx }) => {
        return ctx.store.listPatches(input.runId);
      }),

    // Run mutations
    createRun: t.procedure
      .input(RunSchema.omit({ id: true }))
      .mutation(async ({ input, ctx }) => {
        const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const run = { ...input, id } as const;
        await ctx.store.createRun(run);
        return run;
      }),

    updateRunStatus: t.procedure
      .input(z.object({ id: z.string(), status: z.enum(["queued", "running", "blocked", "completed", "failed"]) }))
      .mutation(async ({ input, ctx }) => {
        await ctx.store.updateRunStatus(input.id, input.status);
        return { success: true };
      }),

    updateRunStage: t.procedure
      .input(z.object({ id: z.string(), stage: z.enum(["ingest", "detect", "diagnose", "repair", "verify", "done"]) }))
      .mutation(async ({ input, ctx }) => {
        await ctx.store.updateRunStage(input.id, input.stage);
        return { success: true };
      }),
  });
}

export type AppRouter = ReturnType<typeof createRouter>;

import * as z from "zod";
import { publicProcedure, router } from "./trpc.js";

const runIdInput = z.object({ runId: z.string() });

export const runsRouter = router({
  list: publicProcedure.input(z.object({ limit: z.number().int().positive().optional() }).optional()).query(({ ctx, input }) => ctx.store.listRuns(input)),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => ctx.store.getRun(input.id)),

  create: publicProcedure
    .input(
      z.object({
        trigger: z.enum(["manual", "schedule", "webhook"]),
        target: z.object({
          kind: z.enum(["local", "github"]),
          ref: z.string(),
        }),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.store.createRun({
        id: crypto.randomUUID(),
        trigger: input.trigger,
        target: input.target,
        stage: "ingest",
        status: "queued",
        startedAt: new Date().toISOString(),
        logRef: "",
      }),
    ),

  findings: publicProcedure.input(runIdInput).query(({ ctx, input }) => ctx.store.listFindings(input.runId)),

  diagnoses: publicProcedure.input(runIdInput).query(({ ctx, input }) => ctx.store.listDiagnoses(input.runId)),

  patches: publicProcedure.input(runIdInput).query(({ ctx, input }) => ctx.store.listPatches(input.runId)),
});

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const, ts: new Date().toISOString() })),
  runs: runsRouter,
});

export type AppRouter = typeof appRouter;

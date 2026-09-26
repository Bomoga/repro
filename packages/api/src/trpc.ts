import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Diagnosis, Finding, Patch, Run } from '@repro/contracts';

export interface RunDetails {
  run: Run;
  findings: Finding[];
  diagnoses: Diagnosis[];
  patches: Patch[];
}

export interface RunRepository {
  listRuns(limit: number): Promise<Run[]>;
  getRun(id: string): Promise<Run | null>;
  getRunDetails(runId: string): Promise<RunDetails | null>;
}

const trpc = initTRPC.create();

export function createRouter(repository: RunRepository) {
  return trpc.router({
    runs: trpc.router({
      list: trpc.procedure
        .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
        .query(({ input }) => repository.listRuns(input?.limit ?? 20)),
      get: trpc.procedure
        .input(z.object({ id: z.string().min(1) }))
        .query(async ({ input }) => {
          const details = await repository.getRunDetails(input.id);
          if (!details) {
            throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${input.id} was not found.` });
          }
          return details;
        })
    })
  });
}

export type AppRouter = ReturnType<typeof createRouter>;
import { initTRPC } from "@trpc/server";
import type { RunStore } from "../run-store/store.js";

export interface Context {
  store: RunStore;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

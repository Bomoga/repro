import { initTRPC, TRPCError } from "@trpc/server";
import { StoreError, type RunStore, type StoreErrorCode } from "./store/index.ts";

export interface Context {
  store: RunStore;
}

const t = initTRPC.context<Context>().create();

const TRPC_CODE: Record<StoreErrorCode, TRPCError["code"]> = {
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INVALID: "BAD_REQUEST",
};

// A StoreError thrown anywhere in a procedure becomes the matching tRPC error (404 / 409 / 400)
// with the store's message, instead of an opaque 500.
const storeErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof StoreError) {
    const cause = result.error.cause;
    throw new TRPCError({ code: TRPC_CODE[cause.code], message: cause.message, cause });
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(storeErrors);

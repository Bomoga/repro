// The run_logs collection: every Run's full prompt and tool-call log (section 9), so a human can
// always answer "why did it do that". Gemini's own server-side interaction storage isn't relied on
// for this; the free tier keeps interactions for one day.
//
// One document per entry, never one growing array on the Run, so no single document approaches
// Mongo's 16 MB limit however long a Run's repair loop goes. `Run.logRef` names the log
// (`run_logs/<runId>`); `list(runId)` reads it back in write order.
import type { StoreModels } from "../models.js";
import { clampLimit } from "./shared.js";

export interface LogRecord {
  at: string;
  kind: string;
  entry: unknown;
}

/**
 * A synchronous `record(entry)` sink backed by the Run Store. Its shape matches the
 * `InteractionLog` interface Lane 3's Gemini wrapper writes to, so the orchestrator can pass one
 * straight in. Writes happen in the background, in order; `flush()` waits for them and rethrows
 * the first write that failed.
 */
export interface RunLogWriter {
  record(entry: object): void;
  flush(): Promise<void>;
}

export function runLogQueries(models: StoreModels) {
  const { RunLog } = models;

  async function append(runId: string, kind: string, entry: unknown, at?: string): Promise<void> {
    await RunLog.create({ runId, kind, entry, at: at ?? new Date().toISOString() });
  }

  return {
    append,

    /** A Run's log in write order. Default limit 1,000 entries, capped at 10,000. */
    async list(runId: string, options: { kind?: string; limit?: number } = {}): Promise<LogRecord[]> {
      const filter: Record<string, unknown> = { runId };
      if (options.kind) filter.kind = options.kind;
      const docs = await RunLog.find(filter)
        .sort({ _id: 1 })
        .limit(clampLimit(options.limit, 1_000, 10_000))
        .lean();
      return docs.map((doc) => ({ at: doc.at, kind: doc.kind, entry: doc.entry }));
    },

    /** A sink for one Run's log; every entry is stored with this `kind` ("gemini" by default). */
    writer(runId: string, kind = "gemini"): RunLogWriter {
      let chain: Promise<void> = Promise.resolve();
      let firstError: unknown;
      return {
        record(entry: object): void {
          const at = typeof (entry as { at?: unknown }).at === "string" ? (entry as { at: string }).at : undefined;
          chain = chain.then(() =>
            append(runId, kind, entry, at).catch((error: unknown) => {
              firstError ??= error;
            }),
          );
        },
        async flush(): Promise<void> {
          await chain;
          if (firstError !== undefined) {
            const error = firstError;
            firstError = undefined;
            throw error;
          }
        },
      };
    },
  };
}

export type RunLogQueries = ReturnType<typeof runLogQueries>;

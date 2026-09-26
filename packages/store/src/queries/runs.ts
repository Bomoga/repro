// The runs collection. The Run Orchestrator owns every write here; the status surface reads.
//
// Semantics carried from section 4: `stage` is the stage in flight, not the last one completed.
// So a completed Run sits at stage "done", while a failed Run keeps the stage it failed in, which
// is exactly what someone reading `repro status` wants to know. Once completed or failed, a Run
// never changes again: a retry is a new Run.
import { RunSchema, type Run, type RunStage, type RunStatus, type RunTarget, type RunTrigger } from "../contracts.js";
import { RunNotActiveError, RunNotFoundError, StoreError } from "../errors.js";
import type { StoreModels } from "../models.js";
import { clampLimit } from "./shared.js";

export const ACTIVE_RUN_STATUSES = ["queued", "running", "blocked"] as const satisfies readonly RunStatus[];
export type ActiveRunStatus = (typeof ACTIVE_RUN_STATUSES)[number];

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 500;

export interface CreateRunInput {
  target: RunTarget;
  trigger: RunTrigger;
  /** Defaults to `run_<uuid>`. */
  id?: string;
  /** Defaults to now. ISO 8601 in UTC (`toISOString()`), so string order is time order. */
  startedAt?: string;
}

export interface ListRunsQuery {
  status?: RunStatus;
  stage?: RunStage;
  /** Default 50, capped at 500. */
  limit?: number;
}

/** Where a Run's retained prompt and tool-call log lives: the run_logs documents with this runId. */
export function logRefFor(runId: string): string {
  return `run_logs/${runId}`;
}

export function runQueries(models: StoreModels) {
  const { Run: RunModel } = models;

  // An update that only applies while the Run is still active; explains itself when it doesn't.
  async function updateActive(id: string, set: Partial<Pick<Run, "stage" | "status">>): Promise<Run> {
    const doc = await RunModel.findOneAndUpdate(
      { id, status: { $in: ACTIVE_RUN_STATUSES } },
      { $set: set },
      { returnDocument: "after" },
    ).lean();
    if (doc) return RunSchema.parse(doc);
    const existing = await RunModel.findOne({ id }).lean();
    if (!existing) throw new RunNotFoundError(id);
    throw new RunNotActiveError(id, existing.status);
  }

  return {
    /** Starts a Run: stage "ingest", status "queued", with its log reference filled in. */
    async create(input: CreateRunInput): Promise<Run> {
      const id = input.id ?? `run_${crypto.randomUUID()}`;
      const run = RunSchema.parse({
        id,
        trigger: input.trigger,
        target: input.target,
        stage: "ingest",
        status: "queued",
        startedAt: input.startedAt ?? new Date().toISOString(),
        logRef: logRefFor(id),
      });
      await RunModel.create(run);
      return run;
    },

    /** Stores a Run built elsewhere, exactly as given. Throws on a duplicate `id`. */
    async insert(run: Run): Promise<Run> {
      const parsed = RunSchema.parse(run);
      await RunModel.create(parsed);
      return parsed;
    },

    async get(id: string): Promise<Run | null> {
      const doc = await RunModel.findOne({ id }).lean();
      return doc ? RunSchema.parse(doc) : null;
    },

    /** Newest first. */
    async list(query: ListRunsQuery = {}): Promise<Run[]> {
      const filter: Record<string, unknown> = {};
      if (query.status) filter.status = query.status;
      if (query.stage) filter.stage = query.stage;
      const docs = await RunModel.find(filter).sort({ startedAt: -1 }).limit(clampLimit(query.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)).lean();
      return docs.map((doc) => RunSchema.parse(doc));
    },

    /**
     * The orchestrator's work queue (section 10: a polling loop over the Run Store, no job queue).
     * Atomically moves the oldest queued Run to running and returns it, so two orchestrator
     * processes polling at once never pick up the same Run. Null when nothing is queued.
     */
    async claimNextQueued(): Promise<Run | null> {
      const doc = await RunModel.findOneAndUpdate(
        { status: "queued" },
        { $set: { status: "running" } },
        { sort: { startedAt: 1 }, returnDocument: "after" },
      ).lean();
      return doc ? RunSchema.parse(doc) : null;
    },

    /** Records the stage now in flight. Use `complete` to reach "done". */
    async setStage(id: string, stage: Exclude<RunStage, "done">): Promise<Run> {
      if ((stage as RunStage) === "done") throw new StoreError(`use complete() to move run ${id} to done`);
      return updateActive(id, { stage: RunSchema.shape.stage.parse(stage) });
    },

    /** queued, running, or blocked. Use `complete` or `fail` to finish a Run. */
    async setStatus(id: string, status: ActiveRunStatus): Promise<Run> {
      if (!(ACTIVE_RUN_STATUSES as readonly string[]).includes(status)) {
        throw new StoreError(`use complete() or fail() to finish run ${id}`);
      }
      return updateActive(id, { status });
    },

    /** The pipeline finished: stage "done", status "completed". */
    async complete(id: string): Promise<Run> {
      return updateActive(id, { stage: "done", status: "completed" });
    },

    /** The pipeline stopped: status "failed", and `stage` stays where it failed. */
    async fail(id: string): Promise<Run> {
      return updateActive(id, { status: "failed" });
    },

    async exists(id: string): Promise<boolean> {
      return (await RunModel.exists({ id })) !== null;
    },
  };
}

export type RunQueries = ReturnType<typeof runQueries>;

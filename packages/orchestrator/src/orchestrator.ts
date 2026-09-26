import type { Run } from "@repro/contracts";
import { processRun, type PipelineDeps } from "./pipeline.ts";

export interface OrchestratorOptions extends PipelineDeps {
  /** How long to wait between polls while nothing is queued. Default 2s. */
  pollIntervalMs?: number;
}

/**
 * The Run Orchestrator (section 3): polls the Run Store for queued Runs and takes each one through
 * the pipeline, one at a time. A polling loop over the Run Store is all section 10 asks for; the
 * store's atomic claim keeps two orchestrators on one Atlas database from taking the same Run.
 */
export class Orchestrator {
  private stopping = false;
  private wake?: () => void;
  private loop?: Promise<void>;
  private current?: Run;

  constructor(private readonly options: OrchestratorOptions) {}

  /** Claims the oldest queued Run and takes it through the pipeline. False when none is queued. */
  async runNext(): Promise<boolean> {
    const run = await this.options.store.claimNextQueued();
    if (!run) return false;
    this.current = run;
    try {
      await processRun(run, this.options);
    } finally {
      this.current = undefined;
    }
    return true;
  }

  /** Polls until `shutdown()`. */
  start(): Promise<void> {
    this.loop ??= (async () => {
      while (!this.stopping) {
        let worked = false;
        try {
          worked = await this.runNext();
        } catch (error) {
          this.options.say?.(`orchestrator: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!worked && !this.stopping) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.options.pollIntervalMs ?? 2_000);
            this.wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
      }
    })();
    return this.loop;
  }

  /**
   * Stops polling. A Run in flight can't be resumed by a later orchestrator, so it's marked failed
   * where it stands, with the reason in its log, instead of staying "running" forever.
   */
  async shutdown(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    const run = this.current;
    if (!run) return;
    const { store } = this.options;
    await store.appendLog(run.id, "orchestrator", { event: "failed", message: "the orchestrator shut down mid-run" }).catch(() => {});
    await store.updateRun(run.id, { status: "failed" }).catch(() => {});
  }
}

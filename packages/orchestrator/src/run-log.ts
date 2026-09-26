import type { InteractionLog, InteractionLogEntry } from "@repro/agents";
import type { RunStore } from "@repro/api";

/**
 * A Run's retained log (section 9), written to the Run Store as the Run goes: every Gemini
 * interaction as Lane 3's wrapper records it, and the orchestrator's own events. Writes queue
 * behind each other, so a slow store never reorders them or holds up the pipeline; `flush()` waits
 * for them.
 */
export class RunLog {
  /** The sink Lane 3's Gemini wrapper records every interaction to. */
  readonly interactions: InteractionLog;

  private pending: Promise<void> = Promise.resolve();
  private failure: unknown;

  constructor(
    private readonly store: RunStore,
    readonly runId: string,
  ) {
    this.interactions = { record: (entry: InteractionLogEntry) => this.append("gemini", entry, entry.at) };
  }

  /** A pipeline event: a stage starting, what it produced, a failure. */
  event(name: string, detail: Record<string, unknown> = {}): void {
    this.append("orchestrator", { event: name, ...detail });
  }

  /** Waits for every queued write; rethrows the first one that failed. */
  async flush(): Promise<void> {
    await this.pending;
    if (this.failure !== undefined) {
      const failure = this.failure;
      this.failure = undefined;
      throw failure;
    }
  }

  private append(kind: string, entry: unknown, at = new Date().toISOString()): void {
    this.pending = this.pending
      .then(() => this.store.appendLog(this.runId, kind, entry, at))
      .catch((error: unknown) => {
        this.failure ??= error;
      });
  }
}

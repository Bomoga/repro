import type { RunStore } from "./store/index.ts";

export interface Health {
  status: "ok" | "degraded";
  store: RunStore["kind"];
  time: string;
  /** Why the Run Store is unreachable, when status is "degraded". */
  error?: string;
}

export async function checkHealth(store: RunStore): Promise<Health> {
  const time = new Date().toISOString();
  try {
    await store.ping();
    return { status: "ok", store: store.kind, time };
  } catch (error) {
    return { status: "degraded", store: store.kind, time, error: error instanceof Error ? error.message : String(error) };
  }
}

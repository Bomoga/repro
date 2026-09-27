import type { Health } from "@repro/api";
import type { Poll } from "../lib/poll.ts";

type ServerState = "connecting" | "memory" | "mongo" | "degraded" | "offline";

const SERVER: Record<ServerState, { label: string; tip?: string }> = {
  connecting: { label: "Connecting" },
  memory: { label: "In-memory store", tip: "Runs live inside the API process and disappear when it restarts. Set MONGODB_URI to keep them." },
  mongo: { label: "MongoDB store" },
  degraded: { label: "Store unreachable", tip: "The API is up but the database is not." },
  offline: { label: "API offline" },
};

export function serverState(health: Poll<Health>): ServerState {
  if (health.error) return "offline";
  if (!health.data) return "connecting";
  if (health.data.status === "degraded") return "degraded";
  return health.data.store === "mongo" ? "mongo" : "memory";
}

export function ServerStatus({ state }: { state: ServerState }) {
  const { label, tip } = SERVER[state];
  return (
    <span className="server" data-state={state} title={tip}>
      <span className="server__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

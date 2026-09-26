// The Run Store as one object: a connection, its models, and a query helper per collection.
import type { Connection } from "mongoose";
import { openConnection, resolveConnectionSettings, type StoreConnectOptions } from "./connection.js";
import { bindModels, type StoreModels } from "./models.js";
import { diagnosisQueries, type DiagnosisQueries } from "./queries/diagnoses.js";
import { findingQueries, type FindingQueries } from "./queries/findings.js";
import { runLogQueries, type RunLogQueries } from "./queries/logs.js";
import { patchQueries, type PatchQueries } from "./queries/patches.js";
import { runQueries, type RunQueries } from "./queries/runs.js";

export interface RunStore {
  readonly connection: Connection;
  readonly models: StoreModels;
  readonly runs: RunQueries;
  readonly findings: FindingQueries;
  readonly diagnoses: DiagnosisQueries;
  readonly patches: PatchQueries;
  readonly logs: RunLogQueries;
  /** Builds every index this package declares; safe to repeat. `npm run check -w @repro/store` calls it. */
  ensureIndexes(): Promise<void>;
  /** Closes the connection; a store from `connectStore` is also dropped from its cache. */
  close(): Promise<void>;
}

/** Wraps a connection you opened yourself, e.g. one pointed at an in-memory server in tests. */
export function createRunStore(connection: Connection, onClose?: () => void): RunStore {
  const models = bindModels(connection);
  return {
    connection,
    models,
    runs: runQueries(models),
    findings: findingQueries(models),
    diagnoses: diagnosisQueries(models),
    patches: patchQueries(models),
    logs: runLogQueries(models),
    async ensureIndexes() {
      await Promise.all(Object.values(models).map((model) => model.createIndexes()));
    },
    async close() {
      onClose?.();
      await connection.close();
    },
  };
}

const cache = new Map<string, Promise<RunStore>>();

/**
 * The shared Run Store for this process. Concurrent and repeated calls with the same URI and
 * database get the same store and one connection pool, so a server under `tsx watch` or a test
 * file calling this in every suite doesn't open a new pool each time. A failed attempt isn't
 * cached; the next call tries again.
 */
export function connectStore(options: StoreConnectOptions = {}): Promise<RunStore> {
  const { uri, dbName } = resolveConnectionSettings(options);
  const key = `${uri}\n${dbName}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = openConnection({ ...options, uri, dbName }).then(
      (connection) => createRunStore(connection, () => cache.delete(key)),
      (error: unknown) => {
        cache.delete(key);
        throw error;
      },
    );
    cache.set(key, pending);
  }
  return pending;
}

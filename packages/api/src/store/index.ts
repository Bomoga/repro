import { InMemoryRunStore } from "./memory.ts";
import { MongoRunStore } from "./mongo.ts";
import type { RunStore } from "./types.ts";

export * from "./types.ts";
export { InMemoryRunStore } from "./memory.ts";
export { MongoRunStore, type MongoRunStoreOptions } from "./mongo.ts";
export { meetsVerificationGate } from "./invariants.ts";

/** MongoDB Atlas when MONGODB_URI is set (MONGODB_DB optionally names the database), else in-memory. */
export async function openRunStore(env: NodeJS.ProcessEnv = process.env): Promise<RunStore> {
  const uri = env.MONGODB_URI;
  if (!uri) return new InMemoryRunStore();
  return MongoRunStore.connect(uri, { dbName: env.MONGODB_DB || undefined });
}

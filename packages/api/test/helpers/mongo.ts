import { MongoMemoryServer } from "mongodb-memory-server";

// A real mongod for the Mongo store's tests. By default mongodb-memory-server starts a throwaway
// one (the first run on a machine downloads the binary, ~120 MB, into ~/.cache/mongodb-binaries).
// MONGODB_TEST_URI points the tests at an existing server instead (a local Docker mongo, or a
// scratch Atlas database; every test uses its own freshly named database and drops it after).
// REPRO_SKIP_MONGO_TESTS=1 skips them, for machines that can do neither.

export const skipMongo = process.env.REPRO_SKIP_MONGO_TESTS === "1";

/** Generous: the very first run may be downloading mongod. */
export const MONGO_STARTUP_TIMEOUT_MS = 10 * 60_000;

export interface TestMongo {
  uri: string;
  stop(): Promise<void>;
}

export async function startTestMongo(): Promise<TestMongo> {
  const external = process.env.MONGODB_TEST_URI;
  if (external) return { uri: external, stop: async () => {} };
  const server = await MongoMemoryServer.create();
  return { uri: server.getUri(), stop: async () => void (await server.stop()) };
}

let counter = 0;
/** A database name no other test (or earlier test run) is using. */
export function freshDbName(prefix: string): string {
  return `repro_test_${prefix}_${process.pid}_${Date.now().toString(36)}_${++counter}`;
}

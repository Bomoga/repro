import { buildApp } from "./app.js";
import { MemoryRunStore } from "./run-store/memory-store.js";
import { connectMongo, MongoRunStore } from "./run-store/mongo-store.js";
import type { RunStore } from "./run-store/store.js";

export { buildApp } from "./app.js";
export { MemoryRunStore } from "./run-store/memory-store.js";
export { connectMongo, MongoRunStore } from "./run-store/mongo-store.js";
export type { RunStore } from "./run-store/store.js";
export { appRouter, runsRouter, type AppRouter, type Context } from "./router/index.js";
export { narratePr } from "./narrator/pr-narrator.js";
export { GitHubClient } from "./github/client.js";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  const mongoUri = process.env.MONGODB_URI;

  let store: RunStore;
  if (mongoUri) {
    await connectMongo(mongoUri);
    store = new MongoRunStore();
  } else {
    console.warn("MONGODB_URI not set; using an in-memory Run Store (data is lost on restart)");
    store = new MemoryRunStore();
  }

  const app = buildApp({ store, logger: true });
  await app.listen({ port, host: "0.0.0.0" });
}

// Only run the server when this file is executed directly, not when imported (e.g. by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

import { buildApp } from "./app.ts";
import { seedDemoData } from "./seed.ts";
import { openRunStore } from "./store/index.ts";

// Server entrypoint. Environment:
//   MONGODB_URI      use MongoDB Atlas as the Run Store (unset: in-memory, lost on restart)
//   MONGODB_DB       database name, when the URI doesn't name one
//   PORT, HOST       listen address (default 0.0.0.0:4000)
//   REPRO_SEED_DEMO  "1" loads the demo Runs from src/seed.ts at startup (idempotent)

async function main(): Promise<void> {
  const store = await openRunStore();
  if (process.env.REPRO_SEED_DEMO === "1") {
    const { seeded, skipped } = await seedDemoData(store);
    console.log(`demo data: seeded ${seeded.length} run(s), ${skipped.length} already present`);
  }

  const app = buildApp(store, { logger: true });
  const shutdown = async (signal: string) => {
    app.log.info(`${signal}: shutting down`);
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? "0.0.0.0" });
  app.log.info(`run store: ${store.kind}${store.kind === "memory" ? " (set MONGODB_URI to persist runs)" : ""}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

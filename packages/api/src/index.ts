import { buildApp } from "./app.ts";
import { seedDemoData } from "./seed.ts";
import { openRunStore } from "./store/index.ts";

export { buildApp } from "./app.ts";
export * from "./store/index.ts";
export { appRouter, type AppRouter } from "./router.ts";
export type { Context } from "./trpc.ts";
export { buildTrustReport, type TrustReport } from "./trust.ts";
export { demoRunRecords, importRunRecord, seedDemoData, type RunRecord, type SeedResult } from "./seed.ts";

async function main(): Promise<void> {
  const store = await openRunStore();
  // REPRO_SEED_DEMO=1 loads the demo Runs from src/seed.ts (idempotent).
  if (process.env.REPRO_SEED_DEMO === "1") {
    const { seeded, skipped } = await seedDemoData(store);
    console.log(`demo data: seeded ${seeded.length} run(s), ${skipped.length} already present`);
  }
  const app = buildApp(store);
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port, host });
}

// Only run the server when this file is the entrypoint, so tests can import buildApp/InMemoryRunStore
// without opening a port.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

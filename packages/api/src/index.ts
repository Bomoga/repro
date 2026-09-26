import { buildApp } from "./app.ts";
import { InMemoryRunStore, type RunStore } from "./store.ts";
import { connectMongoStore } from "./mongo-store.ts";

export { buildApp } from "./app.ts";
export { InMemoryRunStore, type RunStore } from "./store.ts";
export { appRouter, type AppRouter } from "./router.ts";
export type { Context } from "./trpc.ts";
export { buildTrustReport, type TrustReport } from "./trust.ts";

async function resolveStore(): Promise<RunStore> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return new InMemoryRunStore();
  return connectMongoStore(uri);
}

async function main(): Promise<void> {
  const store = await resolveStore();
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

import { seedDemoData } from "./seed.ts";
import { MongoRunStore } from "./store/index.ts";

// `npm run seed -w @repro/api`: load the demo Runs into the MongoDB Run Store. Idempotent.
// The in-memory store lives inside the API process, so there it's REPRO_SEED_DEMO=1 at startup.

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(
      "MONGODB_URI is not set. The in-memory Run Store only exists inside the API process; " +
        "start it with REPRO_SEED_DEMO=1 npm run dev:api to get the demo data there instead.",
    );
    process.exit(1);
  }
  const store = await MongoRunStore.connect(uri, { dbName: process.env.MONGODB_DB || undefined });
  try {
    const { seeded, skipped } = await seedDemoData(store);
    for (const id of seeded) console.log(`seeded  ${id}`);
    for (const id of skipped) console.log(`present ${id} (left as is)`);
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

// `npm run check -w @repro/store`: confirms MONGODB_URI reaches the cluster, builds the Run Store's
// indexes, and prints how many documents each collection holds. Safe to run any time; it never
// writes a document. Prints the connection string only in redacted form.
import { COLLECTIONS } from "./models.js";
import { connectStore } from "./store.js";

async function main(): Promise<void> {
  const store = await connectStore({ log: (message) => console.log(message) });
  try {
    await store.connection.db!.command({ ping: 1 });
    await store.ensureIndexes();
    console.log(`indexes ensured on ${Object.values(COLLECTIONS).join(", ")}`);
    const counts = await Promise.all(
      Object.values(store.models).map(async (model) => `${model.collection.collectionName}: ${await model.estimatedDocumentCount()}`),
    );
    console.log(`documents: ${counts.join(", ")}`);
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryRunStore, MongoRunStore, openRunStore } from "../src/store/index.ts";
import { seedDemoData } from "../src/seed.ts";
import { describeRunStore } from "./helpers/conformance.ts";
import { aDiagnosis, aReproducedFinding, aRun } from "./helpers/fixtures.ts";
import { freshDbName, MONGO_STARTUP_TIMEOUT_MS, skipMongo, startTestMongo, type TestMongo } from "./helpers/mongo.ts";

describe.skipIf(skipMongo)("MongoRunStore", () => {
  let mongo: TestMongo;
  const databases: string[] = [];

  const connect = (dbName: string) => MongoRunStore.connect(mongo.uri, { dbName });
  const fresh = (prefix: string) => {
    const name = freshDbName(prefix);
    databases.push(name);
    return name;
  };

  beforeAll(async () => {
    mongo = await startTestMongo();
  }, MONGO_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!mongo) return;
    if (process.env.MONGODB_TEST_URI) {
      const admin = await mongoose.createConnection(mongo.uri).asPromise();
      for (const name of databases) await admin.useDb(name).dropDatabase();
      await admin.close();
    }
    await mongo.stop();
  });

  describeRunStore("mongo", () => connect(fresh("conformance")));

  it("keeps runs and findings across reconnects", async () => {
    const dbName = fresh("persist");
    const run = aRun();
    const finding = aReproducedFinding();
    const first = await connect(dbName);
    await first.insertRun(run);
    await first.addFindings(run.id, [finding]);
    await first.close();

    const second = await connect(dbName);
    expect(await second.getRun(run.id)).toEqual(run);
    expect(await second.listFindings(run.id)).toEqual([finding]);
    await second.close();
  });

  it("stores the owning runId beside each contract, and never returns it", async () => {
    const dbName = fresh("layout");
    const store = await connect(dbName);
    const run = await store.insertRun(aRun());
    const finding = aReproducedFinding();
    await store.addFindings(run.id, [finding]);
    await store.addDiagnoses(run.id, [aDiagnosis([finding.id])]);

    const raw = await mongoose.createConnection(mongo.uri, { dbName }).asPromise();
    const doc = await raw.collection("findings").findOne({ id: finding.id });
    expect(doc).toMatchObject({ runId: run.id, id: finding.id });
    expect(doc).toHaveProperty("_id");
    expect(await raw.collection("diagnoses").countDocuments({ runId: run.id })).toBe(1);
    const indexes = await raw.collection("findings").indexes();
    expect(indexes.some((index) => index.key.id === 1 && index.unique)).toBe(true);
    await raw.close();

    expect(await store.getFinding(finding.id)).toEqual(finding);
    await store.close();
  });

  it("fails its ping once the connection is closed", async () => {
    const store = await connect(fresh("ping"));
    await store.ping();
    await store.close();
    await expect(store.ping()).rejects.toThrow();
  });

  it("seeds the same demo data the in-memory store gets, once", async () => {
    const now = new Date("2026-09-26T12:00:00.000Z");
    const store = await connect(fresh("seed"));
    const memory = new InMemoryRunStore();
    const first = await seedDemoData(store, { now });
    await seedDemoData(memory, { now });
    expect(first.skipped).toEqual([]);

    const again = await seedDemoData(store, { now });
    expect(again).toEqual({ seeded: [], skipped: first.seeded });

    const ids = first.seeded;
    expect(await store.listRuns()).toEqual(await memory.listRuns());
    expect(await store.countRuns(ids)).toEqual(await memory.countRuns(ids));
    for (const id of ids) {
      expect(await store.listFindings(id)).toEqual(await memory.listFindings(id));
      expect(await store.listDiagnoses(id)).toEqual(await memory.listDiagnoses(id));
      expect(await store.listPatches(id)).toEqual(await memory.listPatches(id));
    }
    await store.close();
  });

  it("is what openRunStore picks when MONGODB_URI is set", async () => {
    const dbName = fresh("open");
    const store = await openRunStore({ MONGODB_URI: mongo.uri, MONGODB_DB: dbName });
    expect(store.kind).toBe("mongo");
    await store.close();
    expect((await openRunStore({})).kind).toBe("memory");
  });
});

// Checks that need no database: the Mongoose schemas match the contracts key for key, and the
// connection helpers never let a secret through.
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { DiagnosisSchema, FindingSchema, PatchSchema, RunSchema, type Patch } from "../src/contracts.ts";
import type { Schema } from "mongoose";
import {
  connectionHint,
  databaseFromUri,
  diagnosisSchema,
  findingSchema,
  gateFailures,
  MissingMongoUriError,
  PATCH_TRANSITIONS,
  patchSchema,
  redactMongoUri,
  resolveConnectionSettings,
  runSchema,
} from "../src/index.ts";

// A contract's keys, with nested objects flattened to Mongoose's dotted paths ("target.kind").
function contractPaths(schema: z.ZodObject): string[] {
  return Object.entries(schema.shape).flatMap(([key, field]) =>
    field instanceof z.ZodObject ? contractPaths(field).map((inner) => `${key}.${inner}`) : [key],
  );
}

function storedPaths(schema: Schema): string[] {
  return Object.keys(schema.paths).filter((path) => path !== "_id");
}

const sorted = (values: readonly string[]) => [...values].sort();

describe("Mongoose schemas mirror the contracts exactly", () => {
  // If one of these fails, a contract gained or lost a field: update src/models.ts to match, and
  // the collection table in packages/contracts/README.md with it.
  it.each([
    ["runs", runSchema, RunSchema, []],
    ["findings", findingSchema, FindingSchema, ["runId"]],
    ["diagnoses", diagnosisSchema, DiagnosisSchema, ["runId"]],
    ["patches", patchSchema, PatchSchema, ["runId"]],
  ] as const)("%s: the contract's fields plus storage-only ones", (_name, stored, contract, storageOnly) => {
    expect(sorted(storedPaths(stored))).toEqual(sorted([...contractPaths(contract), ...storageOnly]));
  });

  it("Patch.regressionFindings embeds full Finding objects", () => {
    const embedded = (patchSchema.path("regressionFindings") as unknown as { schema: Schema }).schema;
    expect(sorted(storedPaths(embedded))).toEqual(sorted(contractPaths(FindingSchema)));
  });

  it.each([
    ["runs", runSchema, "trigger", RunSchema.shape.trigger.options],
    ["runs", runSchema, "target.kind", RunSchema.shape.target.shape.kind.options],
    ["runs", runSchema, "stage", RunSchema.shape.stage.options],
    ["runs", runSchema, "status", RunSchema.shape.status.options],
    ["findings", findingSchema, "severity", FindingSchema.shape.severity.options],
    ["patches", patchSchema, "challengerVerdict", PatchSchema.shape.challengerVerdict.options],
    ["patches", patchSchema, "status", PatchSchema.shape.status.options],
  ] as const)("%s.%s takes its enum values from the contract", (_name, stored, path, options) => {
    const values = (stored.path(path) as unknown as { enumValues: string[] }).enumValues;
    expect(sorted(values)).toEqual(sorted(options));
  });

  it("rejects unknown fields instead of dropping them", () => {
    expect(findingSchema.get("strict")).toBe("throw");
    expect(patchSchema.get("strict")).toBe("throw");
  });
});

describe("connection settings", () => {
  const uri = "mongodb+srv://lane1:s3cr%40t@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority";

  it("reads MONGODB_URI and defaults the database to repro", () => {
    expect(resolveConnectionSettings({}, { MONGODB_URI: uri })).toEqual({ uri, dbName: "repro" });
  });

  it("prefers an explicit dbName, then REPRO_MONGODB_DB, then the URI's database", () => {
    const withDb = "mongodb://localhost:27017/fromuri";
    expect(resolveConnectionSettings({ dbName: "explicit" }, { MONGODB_URI: withDb, REPRO_MONGODB_DB: "env" }).dbName).toBe("explicit");
    expect(resolveConnectionSettings({}, { MONGODB_URI: withDb, REPRO_MONGODB_DB: "env" }).dbName).toBe("env");
    expect(resolveConnectionSettings({}, { MONGODB_URI: withDb }).dbName).toBe("fromuri");
  });

  it("fails clearly when MONGODB_URI is missing or malformed", () => {
    expect(() => resolveConnectionSettings({}, {})).toThrow(MissingMongoUriError);
    expect(() => resolveConnectionSettings({}, { MONGODB_URI: "https://x:pw@example.com" })).toThrow(/mongodb:\/\//);
    expect(() => resolveConnectionSettings({}, { MONGODB_URI: "https://x:pw@example.com" })).not.toThrow(/pw/);
  });

  it("finds the database in single-host, multi-host, and srv URIs", () => {
    expect(databaseFromUri("mongodb://h1:27017,h2:27017/repro?replicaSet=rs0")).toBe("repro");
    expect(databaseFromUri("mongodb+srv://u:p@c.mongodb.net/?w=majority")).toBeUndefined();
    expect(databaseFromUri("mongodb+srv://u:p@c.mongodb.net")).toBeUndefined();
  });

  it("redacts the password and the query string", () => {
    const redacted = redactMongoUri(`${uri}&authMechanismProperties=AWS_SESSION_TOKEN:tok`);
    expect(redacted).toBe("mongodb+srv://lane1:***@cluster0.abcde.mongodb.net/");
    expect(redacted).not.toMatch(/s3cr|tok/);
    expect(redactMongoUri("mongodb://localhost:27017/repro")).toBe("mongodb://localhost:27017/repro");
  });

  it("turns common Atlas failures into a one-line fix", () => {
    expect(connectionHint(new Error("querySrv ENOTFOUND _mongodb._tcp.cluster0.x.mongodb.net"))).toMatch(/standard mongodb:\/\//);
    expect(connectionHint(new Error("bad auth : authentication failed"))).toMatch(/URL-encode/);
    const selection = Object.assign(new Error("Server selection timed out after 10000 ms"), { name: "MongooseServerSelectionError" });
    expect(connectionHint(selection)).toMatch(/Network Access/);
  });
});

describe("patch rules", () => {
  const passing: Pick<Patch, "testsPassed" | "originalFindingReproduces" | "regressionFindings" | "challengerVerdict"> = {
    testsPassed: true,
    originalFindingReproduces: false,
    regressionFindings: [],
    challengerVerdict: "confirmed",
  };

  it("gateFailures is empty only when all four gate inputs hold", () => {
    expect(gateFailures(passing)).toEqual([]);
    expect(gateFailures({ ...passing, testsPassed: false })).toEqual(["tests did not pass"]);
    expect(gateFailures({ ...passing, originalFindingReproduces: true })).toHaveLength(1);
    expect(gateFailures({ ...passing, challengerVerdict: "disputed" })).toEqual(["the Challenger disputed the patch"]);
  });

  it("status only advances proposed -> verified -> merged, or ends at rejected", () => {
    expect(PATCH_TRANSITIONS).toEqual({
      proposed: [],
      verified: ["proposed"],
      merged: ["verified"],
      rejected: ["proposed", "verified"],
    });
  });
});

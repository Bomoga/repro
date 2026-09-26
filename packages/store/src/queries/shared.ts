import type { Model } from "mongoose";
import type { Stored } from "../models.js";

export interface WriteSummary {
  /** Documents this call created. */
  inserted: number;
  /** Documents with the same `id` already stored for this run, left untouched. */
  alreadyPresent: number;
}

/**
 * Idempotent batch insert keyed on (`id`, `runId`): a retried write after a crash or timeout
 * inserts only what's missing and never overwrites what's there, so a Finding already flipped to
 * reproducible stays flipped. An `id` already stored under a different Run fails on the unique
 * index instead of being silently skipped.
 */
export async function insertOnce<T extends { id: string }>(
  model: Model<Stored<T>>,
  runId: string,
  items: T[],
): Promise<WriteSummary> {
  if (items.length === 0) return { inserted: 0, alreadyPresent: 0 };
  const result = await model.bulkWrite(
    items.map((item) => ({
      updateOne: {
        filter: { id: item.id, runId },
        update: { $setOnInsert: { ...item, runId } },
        upsert: true,
      },
    })) as Parameters<typeof model.bulkWrite>[0],
    { ordered: true },
  );
  return { inserted: result.upsertedCount, alreadyPresent: items.length - result.upsertedCount };
}

export function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), max);
}

export function asArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

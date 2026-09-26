import { vi } from "vitest";
import type { ReproClient } from "../src/client.js";

/** A structurally-compatible stand-in for the tRPC client, since AppRouter needs
 *  `@repro/api` built to type-check; runtime behavior is what these tests exercise. */
export function fakeClient(overrides: {
  list?: unknown[];
  get?: unknown;
  findings?: unknown[];
  diagnoses?: unknown[];
  patches?: unknown[];
  create?: unknown;
} = {}): ReproClient {
  return {
    runs: {
      list: { query: vi.fn().mockResolvedValue(overrides.list ?? []) },
      get: { query: vi.fn().mockResolvedValue(overrides.get ?? null) },
      findings: { query: vi.fn().mockResolvedValue(overrides.findings ?? []) },
      diagnoses: { query: vi.fn().mockResolvedValue(overrides.diagnoses ?? []) },
      patches: { query: vi.fn().mockResolvedValue(overrides.patches ?? []) },
      create: { mutate: vi.fn().mockResolvedValue(overrides.create ?? {}) },
    },
  } as unknown as ReproClient;
}

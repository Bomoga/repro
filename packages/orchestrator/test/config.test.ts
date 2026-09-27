import { describe, expect, it } from "vitest";
import { positiveIntegerFromEnv } from "../src/config.ts";

describe("positiveIntegerFromEnv", () => {
  it("reads a positive integer, and nothing from an unset or blank variable", () => {
    expect(positiveIntegerFromEnv("REPRO_PRO_REQUEST_BUDGET", { REPRO_PRO_REQUEST_BUDGET: " 220 " })).toBe(220);
    expect(positiveIntegerFromEnv("REPRO_PRO_REQUEST_BUDGET", {})).toBeUndefined();
    expect(positiveIntegerFromEnv("REPRO_PRO_REQUEST_BUDGET", { REPRO_PRO_REQUEST_BUDGET: "  " })).toBeUndefined();
  });

  it.each(["0", "-1", "1.5", "abc", "20x", "99999999999999999999"])("refuses %s at startup instead of guessing", (value) => {
    expect(() => positiveIntegerFromEnv("REPRO_PRO_REQUEST_BUDGET", { REPRO_PRO_REQUEST_BUDGET: value })).toThrow(
      `REPRO_PRO_REQUEST_BUDGET must be a positive integer, got "${value}"`,
    );
  });
});

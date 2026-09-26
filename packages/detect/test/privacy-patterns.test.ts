import { describe, expect, it } from "vitest";
import { privacyPatternsAdapter } from "../src/adapters/privacy-patterns.ts";
import { FakeExecutor, fixture, seededWorkspace } from "./helpers.ts";

describe("privacy-patterns adapter", () => {
  it("reports each privacy check under its own detectorId", async () => {
    const exec = new FakeExecutor(() => ({ stdout: fixture("semgrep-privacy.json") }));
    const findings = await privacyPatternsAdapter.run(seededWorkspace, exec);
    expect(exec.requests[0]!.command).toContain("--config '/opt/repro/rules/privacy-patterns'");
    expect(findings.map((f) => [f.ruleId, f.file, f.lineStart])).toEqual([
      ["privacy.prompt-logging.js", "assistant/chat.ts", 4],
      ["privacy.third-party-forwarding.js", "assistant/chat.ts", 6],
      ["privacy.unencrypted-conversation-storage.js", "assistant/chat.ts", 12],
      ["privacy.oauth-broad-scope.google.js", "assistant/chat.ts", 17],
      ["privacy.analytics-forwarding.js", "assistant/chat.ts", 21],
      ["privacy.prompt-logging.py", "assistant/memory.py", 8],
      ["privacy.unencrypted-conversation-storage.py", "assistant/memory.py", 10],
    ]);
    for (const f of findings) {
      expect(f.detectorId).toBe("privacy-patterns");
      expect(f.category).toBe("privacy");
      expect(f.reproductionCommand).toMatch(/^repro-semgrep-rule 'privacy-patterns' /);
    }
  });
});

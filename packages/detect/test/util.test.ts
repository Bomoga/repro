import { describe, expect, it } from "vitest";
import { readEvidence, redactSecrets, shq } from "../src/util.ts";
import { SEEDED } from "./helpers.ts";

describe("shq", () => {
  it("quotes hostile file names so sh -c treats them as one literal argument", () => {
    expect(shq("a'b $(rm -rf /).js")).toBe(`'a'\\''b $(rm -rf /).js'`);
  });
});

describe("redactSecrets", () => {
  it.each([
    ["AWS key", "aws = AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"],
    ["GitHub token", `t = "ghp_${"a".repeat(36)}"`, `ghp_${"a".repeat(36)}`],
    ["Google API key", `k = "AIza${"b".repeat(35)}"`, `AIza${"b".repeat(35)}`],
    ["credential assignment", `password: "hunter2hunter2"`, "hunter2hunter2"],
    ["private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----", "MIIabc"],
  ])("removes a %s", (_name, text, secret) => {
    const out = redactSecrets(text);
    expect(out).not.toContain(secret);
    expect(out).toContain("REDACTED");
  });

  it("leaves ordinary code alone", () => {
    const code = 'res.send("<h1>Hello " + req.query.name + "</h1>");';
    expect(redactSecrets(code)).toBe(code);
  });
});

describe("readEvidence", () => {
  it("returns the exact lines a finding points at", () => {
    expect(readEvidence(SEEDED, "server/index.js", 5, 7)).toBe(
      'app.get("/hello", (req, res) => {\n  res.send("<h1>Hello " + req.query.name + "</h1>");\n});',
    );
  });

  it("refuses paths that resolve outside the workspace", () => {
    expect(readEvidence(SEEDED, "../../../package.json", 1, 1)).toBe("");
    expect(readEvidence(SEEDED, "/etc/hosts", 1, 1)).toBe("");
  });

  it("redacts secrets in the lines it returns", () => {
    expect(readEvidence(SEEDED, "server/config.js", 4, 4)).toBe('  api_key: "REDACTED",');
  });
});

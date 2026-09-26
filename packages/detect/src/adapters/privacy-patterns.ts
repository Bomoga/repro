import { createSemgrepAdapter } from "./semgrep.ts";

// The Assurant challenge's detector (CLAUDE.md section 8): Repro's own Semgrep rule pack for what
// matters when deciding whether to trust an AI tool with your data. Rules and their tests live in
// sandbox/rules/privacy-patterns and are baked into the sandbox image.
export const privacyPatternsAdapter = createSemgrepAdapter("privacy-patterns", "privacy-patterns");

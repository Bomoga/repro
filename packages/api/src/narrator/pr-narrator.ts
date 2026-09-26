import * as z from "zod";
import { parseStructured, toGeminiSchema, type GeminiClient } from "@repro/agents";
import type { Diagnosis, Finding, Patch } from "@repro/contracts";
import { NARRATOR_SYSTEM_PROMPT } from "./prompt.js";

export const PrNarration = z.object({
  title: z.string(),
  body: z.string(),
});
export type PrNarration = z.infer<typeof PrNarration>;

export interface NarratePrInput {
  diagnosis: Diagnosis;
  patch: Patch;
  findings: Finding[];
}

export interface NarratePrDeps {
  gemini: GeminiClient;
}

/** Scope item 5: Gemini writes the PR body, through Lane 3's `@repro/agents` wrapper so every
 *  call still gets its retry policy, model routing, and run-log entry. */
export async function narratePr(deps: NarratePrDeps, input: NarratePrInput): Promise<PrNarration> {
  const response = await deps.gemini.interact({
    role: "narrator",
    systemInstruction: NARRATOR_SYSTEM_PROMPT,
    input: JSON.stringify({
      diagnosis: input.diagnosis,
      patch: input.patch,
      findings: input.findings,
    }),
    responseSchema: toGeminiSchema(PrNarration),
    label: "narrator",
  });

  const parsed = parseStructured(response.outputText, PrNarration);
  if (!parsed.ok) throw new Error(`narrator returned an invalid PR narration: ${parsed.error}`);
  return parsed.value;
}

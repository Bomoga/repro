import * as z from "zod";
import { DiagnosisSchema, type Finding } from "../contracts.js";

/**
 * The part of each Diagnosis Gemini writes, built per call (section 5). `findingIds` is an
 * enum of exactly this batch's IDs, so structured output cannot cite anything else. The batch
 * is split into confirmed and unconfirmed variants because a Diagnosis only moves on to
 * Repair when every Finding it cites is reproducible: mixing the two would strand the
 * confirmed ones. `id`, `model`, and `createdAt` are assigned by the harness, not the model.
 */
export function diagnosisOutputSchema(findings: Finding[]) {
  const confirmed = findings.filter((f) => f.reproducible).map((f) => f.id);
  const unconfirmed = findings.filter((f) => !f.reproducible).map((f) => f.id);
  const variants = [
    confirmed.length > 0 ? diagnosisItem(confirmed, "CONFIRMED") : undefined,
    unconfirmed.length > 0 ? diagnosisItem(unconfirmed, "UNCONFIRMED") : undefined,
  ].filter((variant) => variant !== undefined);
  const [first, second] = variants;
  if (!first) throw new Error("diagnosisOutputSchema needs at least one finding");
  const item = second ? z.union([first, second]) : first;
  return z.object({
    diagnoses: z
      .array(item)
      .min(1)
      .describe("One entry per root cause, most urgent first. Every finding in the batch appears in exactly one entry."),
  });
}

function diagnosisItem(ids: string[], kind: "CONFIRMED" | "UNCONFIRMED") {
  return z
    .object({
      findingIds: z
        .array(z.enum(ids as [string, ...string[]]))
        .min(1)
        .describe(`IDs of the ${kind} findings this diagnosis explains; they share one root cause.`),
      rootCause: DiagnosisSchema.shape.rootCause.min(1).describe("The single underlying cause shared by the cited findings."),
      proposedStrategy: DiagnosisSchema.shape.proposedStrategy.min(1).describe("The recommended fix, and why it beats the obvious alternatives."),
      riskNotes: DiagnosisSchema.shape.riskNotes.min(1).describe("What the fix could break, what to test, and the consequence for people where required."),
    })
    .describe(`A diagnosis citing only ${kind} findings.`);
}

export type DiagnosisOutput = z.infer<ReturnType<typeof diagnosisOutputSchema>>;
export type DiagnosisCandidate = DiagnosisOutput["diagnoses"][number];

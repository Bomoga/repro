import type { GeminiClient } from "@repro/gemini";
import type { Diagnosis, Finding, Patch } from "@repro/contracts";
import type { TrustReport } from "@repro/api";

export interface NarratorInput {
  patch: Patch;
  diagnosis: Diagnosis;
  findings: Finding[];
  trustReport: TrustReport;
}

const SYSTEM_INSTRUCTION = [
  "You write the description of a pull request that fixes a bug Repro found and repaired",
  "automatically. Audience: a human reviewer deciding whether to merge. Be concrete and honest",
  "about risk; never claim more confidence than the Trust Report supports. Plain markdown, no",
  "headings deeper than ###, no more than 200 words.",
].join(" ");

/** Calls the `narrator` role (section 10) to draft a PR body from a Diagnosis/Patch/Trust
 *  Report. Falls back to a templated body -- never blocks a merge/reject decision on Gemini
 *  being reachable, since quota exhaustion is a known, common failure mode (see lane-3's
 *  PROGRESS.md). */
export async function narratePrBody(gemini: GeminiClient, input: NarratorInput): Promise<string> {
  try {
    const response = await gemini.interact({
      role: "narrator",
      systemInstruction: SYSTEM_INSTRUCTION,
      label: `narrate#${input.patch.id}`,
      input: JSON.stringify({
        rootCause: input.diagnosis.rootCause,
        proposedStrategy: input.diagnosis.proposedStrategy,
        riskNotes: input.diagnosis.riskNotes,
        filesChanged: input.patch.filesChanged,
        trustReport: input.trustReport,
        findingCount: input.findings.length,
        severities: input.findings.map((f) => f.severity),
      }),
    });
    const text = response.outputText.trim();
    if (text) return text;
  } catch {
    // Fall through to the template below; never let a Gemini failure block the PR.
  }
  return templatedPrBody(input);
}

export function templatedPrBody(input: NarratorInput): string {
  const { patch, diagnosis, trustReport } = input;
  const lines = [
    `### Repro fix: ${diagnosis.rootCause}`,
    "",
    diagnosis.proposedStrategy,
    "",
    `**Trust Report:** ${trustReport.confidence}`,
    ...trustReport.reasons.map((r) => `- ${r}`),
    "",
    `**Files changed:** ${patch.filesChanged.join(", ") || "(none recorded)"}`,
  ];
  if (diagnosis.riskNotes) lines.push("", `**Risk notes:** ${diagnosis.riskNotes}`);
  return lines.join("\n");
}

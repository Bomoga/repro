import { randomUUID } from "node:crypto";
import { DiagnosisSchema, FindingSchema, type Diagnosis, type Finding, type Workspace } from "../contracts.js";
import { toGeminiSchema, type GeminiClient } from "../gemini.js";
import { WorkspaceFiles, splitLines } from "../workspace-files.js";
import { DIAGNOSE_SYSTEM_PROMPT, renderDiagnoseInput, renderRetryFeedback, type CodeContextFile } from "./prompt.js";
import { diagnosisOutputSchema, type DiagnosisCandidate } from "./schema.js";

export interface DiagnoseInput {
  /** The batch to diagnose. Read-only: Diagnose never changes a Finding. */
  findings: Finding[];
  workspace: Workspace;
  /** Every Finding in the Run, used to redact secrets from code shown to the model even when
   *  their Findings aren't in this batch. Defaults to `findings`. */
  runFindings?: Finding[];
}

export interface DiagnoseDeps {
  gemini: GeminiClient;
  now?: () => Date;
  newId?: () => string;
}

export interface DroppedDiagnosis {
  reason: string;
  candidate: unknown;
}

export interface DiagnoseResult {
  /** Most urgent first, as Gemini ordered them. */
  diagnoses: Diagnosis[];
  /** Candidates that failed the deterministic post-check on the final attempt. */
  dropped: DroppedDiagnosis[];
  /** Batch Findings no surviving Diagnosis cites. */
  uncoveredFindingIds: string[];
  attempts: number;
}

const MAX_ATTEMPTS = 2; // One retry, then drop and log (section 5).
const WHOLE_FILE_MAX_LINES = 1_500;
const WINDOW_RADIUS = 80;

export async function diagnose(input: DiagnoseInput, deps: DiagnoseDeps): Promise<DiagnoseResult> {
  const findings = input.findings.map((finding) => FindingSchema.parse(finding));
  if (findings.length === 0) return { diagnoses: [], dropped: [], uncoveredFindingIds: [], attempts: 0 };
  const duplicate = findings.find((f, i) => findings.findIndex((g) => g.id === f.id) !== i);
  if (duplicate) throw new Error(`duplicate Finding id in batch: ${duplicate.id}`);

  const files = await WorkspaceFiles.open(input.workspace, input.runFindings ?? findings);
  const context = await loadCodeContext(files, findings);
  const outputSchema = diagnosisOutputSchema(findings);
  const responseSchema = toGeminiSchema(outputSchema);
  const baseInput = renderDiagnoseInput(findings, context, (text) => files.redact(text));

  let best: CheckedAttempt | undefined;
  let feedback = "";
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    const response = await deps.gemini.interact({
      role: "diagnose",
      systemInstruction: DIAGNOSE_SYSTEM_PROMPT,
      input: baseInput + feedback,
      responseSchema,
      label: `diagnose#${attempt}`,
    });
    const checked = checkDiagnoses(response.outputText, outputSchema, findings, response.model);
    if (!best || isBetter(checked, best)) best = checked;
    if (checked.problems.length === 0) break;
    feedback = renderRetryFeedback(checked.problems);
  }

  const chosen = best!;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const diagnoses = chosen.valid.map((candidate) =>
    DiagnosisSchema.parse({
      id: newId(),
      findingIds: candidate.findingIds,
      rootCause: candidate.rootCause,
      proposedStrategy: candidate.proposedStrategy,
      riskNotes: candidate.riskNotes,
      model: chosen.model,
      createdAt: now().toISOString(),
    }),
  );
  const cited = new Set(diagnoses.flatMap((d) => d.findingIds));
  return {
    diagnoses,
    dropped: chosen.dropped,
    uncoveredFindingIds: findings.map((f) => f.id).filter((id) => !cited.has(id)),
    attempts,
  };
}

/** A Diagnosis moves on to Repair only if every Finding it cites has been reproduced. */
export function isRepairEligible(diagnosis: Diagnosis, findings: Finding[]): boolean {
  const byId = new Map(findings.map((f) => [f.id, f]));
  return diagnosis.findingIds.length > 0 && diagnosis.findingIds.every((id) => byId.get(id)?.reproducible === true);
}

interface CheckedAttempt {
  valid: DiagnosisCandidate[];
  dropped: DroppedDiagnosis[];
  problems: string[];
  covered: number;
  model: string;
}

function isBetter(candidate: CheckedAttempt, incumbent: CheckedAttempt): boolean {
  if (candidate.covered !== incumbent.covered) return candidate.covered > incumbent.covered;
  return candidate.problems.length < incumbent.problems.length;
}

/**
 * The deterministic post-check. The response schema already constrains decoding; this
 * re-validates everything it claims to guarantee, plus the rules a schema can't express.
 */
export function checkDiagnoses(
  outputText: string,
  outputSchema: ReturnType<typeof diagnosisOutputSchema>,
  findings: Finding[],
  model: string,
): CheckedAttempt {
  const result: CheckedAttempt = { valid: [], dropped: [], problems: [], covered: 0, model };
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    result.problems.push(`the response was not valid JSON (${(error as Error).message})`);
    result.dropped.push({ reason: "response was not valid JSON", candidate: outputText });
    return result;
  }
  const items = (parsed as { diagnoses?: unknown })?.diagnoses;
  if (!Array.isArray(items)) {
    result.problems.push('the response must be an object with a "diagnoses" array');
    result.dropped.push({ reason: "missing diagnoses array", candidate: parsed });
    return result;
  }

  const itemSchema = outputSchema.shape.diagnoses.element;
  const byId = new Map(findings.map((f) => [f.id, f]));
  const claimedBy = new Map<string, number>();
  items.forEach((item, index) => {
    const label = `diagnoses[${index}]`;
    const parsedItem = itemSchema.safeParse(item);
    if (!parsedItem.success) {
      const reason = `${label} does not match the schema: ${parsedItem.error.issues.map((i) => i.message).join("; ")}`;
      result.problems.push(reason);
      result.dropped.push({ reason, candidate: item });
      return;
    }
    const candidate = { ...parsedItem.data, findingIds: [...new Set(parsedItem.data.findingIds)] };
    const unknown = candidate.findingIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      const reason = `${label} cites finding IDs that are not in this batch: ${unknown.join(", ")}`;
      result.problems.push(reason);
      result.dropped.push({ reason, candidate: item });
      return;
    }
    const kinds = new Set(candidate.findingIds.map((id) => byId.get(id)!.reproducible));
    if (kinds.size > 1) {
      const reason = `${label} mixes CONFIRMED and UNCONFIRMED findings`;
      result.problems.push(reason);
      result.dropped.push({ reason, candidate: item });
      return;
    }
    const taken = candidate.findingIds.filter((id) => claimedBy.has(id));
    if (taken.length > 0) {
      const reason = `${label} cites ${taken.join(", ")}, already cited by diagnoses[${claimedBy.get(taken[0]!)}]; each finding belongs to exactly one diagnosis`;
      result.problems.push(reason);
      result.dropped.push({ reason, candidate: item });
      return;
    }
    for (const id of candidate.findingIds) claimedBy.set(id, index);
    result.valid.push(candidate);
  });

  if (items.length === 0) result.problems.push("the response contained no diagnoses");
  const uncovered = findings.map((f) => f.id).filter((id) => !claimedBy.has(id));
  if (uncovered.length > 0) result.problems.push(`these findings are not cited by any diagnosis: ${uncovered.join(", ")}`);
  result.covered = claimedBy.size;
  return result;
}

async function loadCodeContext(files: WorkspaceFiles, findings: Finding[]): Promise<CodeContextFile[]> {
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    let file: string;
    try {
      file = files.normalize(finding.file);
    } catch {
      continue;
    }
    byFile.set(file, [...(byFile.get(file) ?? []), finding]);
  }
  const context: CodeContextFile[] = [];
  for (const [file, fileFindings] of byFile) {
    if (!files.has(file)) continue;
    const text = await files.readView(file);
    const lineCount = splitLines(text).length;
    context.push({
      file,
      text,
      windows: lineCount <= WHOLE_FILE_MAX_LINES ? undefined : windowsFor(fileFindings),
    });
  }
  return context;
}

function windowsFor(findings: Finding[]): [number, number][] {
  const windows = findings
    .map((f): [number, number] => [Math.max(1, f.lineStart - WINDOW_RADIUS), f.lineEnd + WINDOW_RADIUS])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window[0] <= last[1] + 1) last[1] = Math.max(last[1], window[1]);
    else merged.push([...window]);
  }
  return merged;
}

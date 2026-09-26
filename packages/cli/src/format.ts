import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import type { ReportedStage, RunDetail, RunReport, RunSummary } from "@repro/api";

// Plain-text rendering for the terminal. Color is decided once by the caller (TTY, NO_COLOR) and
// passed in, so tests read uncolored output.

type Style = "bold" | "dim" | "red" | "green" | "yellow" | "cyan" | "magenta";
const CODES: Record<Style, [number, number]> = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39],
  magenta: [35, 39],
};

export type Paint = (style: Style, text: string) => string;

export function painter(color: boolean): Paint {
  return color ? (style, text) => `\u001b[${CODES[style][0]}m${text}\u001b[${CODES[style][1]}m` : (_style, text) => text;
}

const STATUS_STYLE: Record<Run["status"], Style> = {
  queued: "yellow",
  running: "cyan",
  blocked: "magenta",
  completed: "green",
  failed: "red",
};

const PATCH_STYLE: Record<Patch["status"], Style> = {
  proposed: "yellow",
  verified: "green",
  merged: "green",
  rejected: "red",
};

const SEVERITY_RANK: Record<Finding["severity"], number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function formatAge(iso: string, now: Date): string {
  const seconds = Math.floor((now.getTime() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return iso;
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

export const targetLabel = (target: Run["target"]) => `${target.kind}:${target.ref}`;

/** Left-aligned columns; `widths` ignore ANSI codes by measuring the unpainted cells. */
function table(rows: { cells: string[]; paint?: (cell: string, column: number) => string }[]): string[] {
  const widths: number[] = [];
  for (const row of rows) row.cells.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return rows.map((row) =>
    row.cells
      .map((cell, i) => {
        const padded = i === row.cells.length - 1 ? cell : cell.padEnd(widths[i]!);
        return row.paint ? row.paint(padded, i) : padded;
      })
      .join("  ")
      .trimEnd(),
  );
}

export function renderRunTable(summaries: RunSummary[], now: Date, paint: Paint): string[] {
  const header = { cells: ["RUN", "STATUS", "STAGE", "REPRODUCED", "VERIFIED", "STARTED", "TARGET"], paint: (c: string) => paint("bold", c) };
  const rows = summaries.map(({ run, counts }) => ({
    cells: [
      run.id,
      run.status,
      run.stage,
      `${counts.reproducible}/${counts.findings}`,
      `${counts.verifiedPatches}/${counts.patches}`,
      formatAge(run.startedAt, now),
      targetLabel(run.target),
    ],
    paint: (cell: string, column: number) => (column === 1 ? paint(STATUS_STYLE[run.status], cell) : cell),
  }));
  return table([header, ...rows]);
}

function sortFindings(findings: Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        Number(b.finding.reproducible) - Number(a.finding.reproducible) ||
        SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] ||
        a.index - b.index,
    )
    .map(({ finding }) => finding);
}

function location(finding: Finding): string {
  return finding.lineStart === finding.lineEnd ? `${finding.file}:${finding.lineStart}` : `${finding.file}:${finding.lineStart}-${finding.lineEnd}`;
}

function diagnosisLines(diagnosis: Diagnosis, paint: Paint): string[] {
  return [
    `  ${paint("bold", diagnosis.id)}  cites ${diagnosis.findingIds.join(", ")}  ${paint("dim", `[${diagnosis.model}]`)}`,
    `    ${diagnosis.rootCause}`,
  ];
}

function patchFacts(patch: Patch): string {
  return [
    `tests ${patch.testsPassed ? "pass" : "fail"}`,
    `still reproduces ${patch.originalFindingReproduces ? "yes" : "no"}`,
    `regressions ${patch.regressionFindings.length}`,
    `challenger ${patch.challengerVerdict}`,
  ].join(" · ");
}

export function renderRunDetail(detail: RunDetail, now: Date, paint: Paint): string[] {
  const { run, counts, findings, diagnoses, patches } = detail;
  const lines = [
    `${paint("bold", run.id)}  ${paint(STATUS_STYLE[run.status], run.status)}  stage ${run.stage}`,
    `  target   ${targetLabel(run.target)}`,
    `  trigger  ${run.trigger}`,
    `  started  ${run.startedAt} (${formatAge(run.startedAt, now)})`,
    `  log      ${run.logRef}`,
    "",
    `${paint("bold", "Findings")}  ${counts.findings} flagged, ${counts.reproducible} reproduced`,
  ];
  lines.push(
    ...table(
      sortFindings(findings).map((finding) => ({
        cells: ["", finding.severity, finding.reproducible ? "reproduced" : "unconfirmed", location(finding), finding.detectorId, finding.id],
        paint: (cell: string, column: number) => (column === 2 ? paint(finding.reproducible ? "green" : "dim", cell) : cell),
      })),
    ),
  );

  lines.push("", `${paint("bold", "Diagnoses")}  ${counts.diagnoses}`);
  for (const diagnosis of diagnoses) lines.push(...diagnosisLines(diagnosis, paint));

  lines.push("", `${paint("bold", "Patches")}  ${counts.patches}, ${counts.verifiedPatches} verified`);
  const patchRows = table(
    patches.map((patch) => ({
      cells: ["", patch.id, patch.status, patchFacts(patch)],
      paint: (cell: string, column: number) => (column === 2 ? paint(PATCH_STYLE[patch.status], cell) : cell),
    })),
  );
  patches.forEach((patch, i) => {
    lines.push(patchRows[i]!);
    if (patch.prUrl) lines.push(`    PR ${patch.prUrl}`);
  });
  return lines;
}

export function renderCompletion(detail: RunDetail): string {
  const { run, counts } = detail;
  return (
    `${run.id} ${run.status} at stage ${run.stage}: ${counts.findings} findings flagged, ${counts.reproducible} reproduced, ` +
    `${counts.verifiedPatches} of ${counts.patches} patches verified. Details: repro status --run ${run.id}`
  );
}

const REPORT_STAGES: ReportedStage[] = ["ingest", "detect", "diagnose", "repair", "verify"];

export function renderReport(report: RunReport, paint: Paint): string[] {
  const { stats } = report;
  const stages = REPORT_STAGES.filter((stage) => stats.timePerStageMs[stage] !== undefined)
    .map((stage) => `${stage} ${formatDuration(stats.timePerStageMs[stage]!)}`)
    .join(", ");
  const tokens = stats.geminiTokens;
  return [
    paint("bold", `Report: ${report.runId}`),
    `  findings     ${stats.rawFindings} flagged, ${stats.reproducedFindings} reproduced, ${stats.noiseCut} cut as noise`,
    `  repair       ${stats.findingsIntoRepair} findings in, ${stats.patchesAttempted} attempts, ${stats.challengerDisputes} disputed, ${stats.regressionsFound} regressions`,
    `  fixed        ${stats.patchesVerified} verified, ${stats.patchesMerged} merged, ${(stats.successRate * 100).toFixed(0)}% of repaired diagnoses`,
    `  gemini       ${tokens.input} input, ${tokens.output} output, ${tokens.thought} thought tokens` +
      (stats.tokensPerFix === null ? "" : `; ${stats.tokensPerFix} per fix`),
    `  duration     ${stats.totalDurationMs === null ? "not recorded" : formatDuration(stats.totalDurationMs)}${stages ? ` (${stages})` : ""}`,
  ];
}

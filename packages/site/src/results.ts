// Every number on the Results page, measured at ShellHacks 2026 (Sep 27) with scripts/run-stats.ts,
// `repro report`, and `npm run scan:lane2`. Each run keeps its raw counts; the page shows their sum,
// so adding a run here updates every percentage. Estimates are labelled and show their arithmetic.

export interface MeasuredRun {
  target: string;
  how: string;
  /** False while the run was still going when it was measured: its numbers are a snapshot. */
  finished: boolean;
  findings: number;
  reproduced: number;
  diagnoses: number;
  attempts: number;
  verified: number;
  merged: number;
  rejected: number;
  rejectedBeforeChallenger: number;
  challengerDisputes: number;
  regressionsCaught: number;
  stillReproduced: number;
  stageSeconds: { ingest: number; detect: number; diagnose: number; repair: number };
  tokens: { input: number; output: number; thought: number; cached: number; requests: number; largeModel: number; smallModel: number };
  byRole: { diagnose: number; repair: number; challenger: number };
}

const RUNS: MeasuredRun[] = [
  {
    target: "Bomoga/repro-demo",
    how: "Queued from the dashboard. Stopped after 20 minutes of repair to restart the control plane.",
    finished: true,
    findings: 29,
    reproduced: 29,
    diagnoses: 15,
    attempts: 13,
    verified: 2,
    merged: 2,
    rejected: 9,
    rejectedBeforeChallenger: 4,
    challengerDisputes: 5,
    regressionsCaught: 5,
    stillReproduced: 2,
    stageSeconds: { ingest: 2, detect: 26, diagnose: 141, repair: 1042 },
    tokens: { input: 3_522_703, output: 45_162, thought: 342_684, cached: 1_677_547, requests: 257, largeModel: 61, smallModel: 196 },
    byRole: { diagnose: 36_803, repair: 3_107_802, challenger: 765_944 },
  },
  {
    target: "fportantier/vulpy",
    how: "Queued by an AI agent through Repro's MCP server. Ran to completion in 32 minutes.",
    finished: true,
    findings: 69,
    reproduced: 69,
    diagnoses: 12,
    attempts: 22,
    verified: 0,
    merged: 0,
    rejected: 22,
    rejectedBeforeChallenger: 22,
    challengerDisputes: 0,
    regressionsCaught: 28,
    stillReproduced: 4,
    stageSeconds: { ingest: 0, detect: 51, diagnose: 158, repair: 1717 },
    tokens: { input: 4951692, output: 34450, thought: 605222, cached: 2104163, requests: 320, largeModel: 1, smallModel: 319 },
    byRole: { diagnose: 58590, repair: 5532774, challenger: 0 },
  },
];

const sum = (pick: (run: MeasuredRun) => number) => RUNS.reduce((total, run) => total + pick(run), 0);
const runTotal = (run: MeasuredRun) => run.tokens.input + run.tokens.output + run.tokens.thought;

// Tokens one Challenger review cost, measured over every review any run actually ran.
const perChallenge = sum((r) => r.byRole.challenger) / Math.max(1, sum((r) => r.attempts - r.rejectedBeforeChallenger));
// Without grouping, each extra finding costs a repair session at that run's measured tokens per attempt.
const groupingSaved = sum((r) => (r.attempts > 0 ? (r.findings - r.diagnoses) * (r.byRole.repair / r.attempts) : 0));
// Every patch the deterministic checks rejected skipped a Challenger review.
const gateSaved = sum((r) => r.rejectedBeforeChallenger) * perChallenge;

export const RESULTS = {
  runs: RUNS.map((r) => ({ ...r, total: runTotal(r) })),
  run: {
    target: `${RUNS.length} runs`,
    note: `Combined from ${RUNS.length} full-pipeline runs on Gemini (Google sign-in): ${RUNS.map((r) => `${r.target}${r.finished ? "" : " (a snapshot of a run still in progress)"}`).join(" and ")}.`,
    findings: sum((r) => r.findings),
    reproduced: sum((r) => r.reproduced),
    diagnoses: sum((r) => r.diagnoses),
    attempts: sum((r) => r.attempts),
    verified: sum((r) => r.verified),
    merged: sum((r) => r.merged),
    rejected: sum((r) => r.rejected),
    rejectedBeforeChallenger: sum((r) => r.rejectedBeforeChallenger),
    challengerDisputes: sum((r) => r.challengerDisputes),
    regressionsCaught: sum((r) => r.regressionsCaught),
    stillReproduced: sum((r) => r.stillReproduced),
    stageSeconds: {
      ingest: sum((r) => r.stageSeconds.ingest),
      detect: sum((r) => r.stageSeconds.detect),
      diagnose: sum((r) => r.stageSeconds.diagnose),
      repair: sum((r) => r.stageSeconds.repair),
    },
  },
  tokens: {
    total: sum(runTotal),
    input: sum((r) => r.tokens.input),
    output: sum((r) => r.tokens.output),
    thought: sum((r) => r.tokens.thought),
    cached: sum((r) => r.tokens.cached),
    requests: sum((r) => r.tokens.requests),
    pro: sum((r) => r.tokens.largeModel),
    flash: sum((r) => r.tokens.smallModel),
    byRole: {
      diagnose: sum((r) => r.byRole.diagnose),
      repair: sum((r) => r.byRole.repair),
      challenger: sum((r) => r.byRole.challenger),
    },
    perChallenge,
  },
  saved: {
    grouping: { tokens: groupingSaved },
    gate: { tokens: gateSaved },
  },
  benchmarks: [
    { repo: "appsecco/dvna", files: 151, findings: 11, reproduced: 11 as number | null, seconds: 42 as number | null },
    { repo: "we45/Vulnerable-Flask-App", files: 19, findings: 98, reproduced: 98, seconds: 51 },
    { repo: "fportantier/vulpy", files: null as number | null, findings: 69, reproduced: 69, seconds: 51 },
    { repo: "OWASP/NodeGoat", files: 111, findings: 306, reproduced: null, seconds: null },
  ],
};

// Share of the tokens the runs would have spent without grouping and early rejection, rounded: the
// one headline the home page and pricing quote, computed so they always match the results page.
export const TOKENS_SAVED_PCT = Math.round(((groupingSaved + gateSaved) / (RESULTS.tokens.total + groupingSaved + gateSaved)) * 100);

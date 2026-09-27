import type { Patch, Run } from "@repro/contracts";
import type { RunCounts, RunSummary } from "@repro/api";

export const STAGES = ["ingest", "detect", "diagnose", "repair", "verify"] as const;
export type PipelineStage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<PipelineStage, string> = {
  ingest: "Ingest",
  detect: "Detect",
  diagnose: "Diagnose",
  repair: "Repair",
  verify: "Verify",
};

/** One colour token per meaning: live, needs you, failed, done, secondary. */
export type Ink = "ink" | "ink2" | "live" | "needs" | "fail";

export const RUN_STATUS: Record<Run["status"], { glyph: string; label: string; ink: Ink; pulse?: boolean }> = {
  queued: { glyph: "○", label: "Queued", ink: "ink2" },
  running: { glyph: "●", label: "Running", ink: "live", pulse: true },
  blocked: { glyph: "■", label: "Blocked", ink: "needs" },
  completed: { glyph: "✓", label: "Completed", ink: "ink" },
  failed: { glyph: "✕", label: "Failed", ink: "fail" },
};

export const RUN_STATUS_ORDER: Run["status"][] = ["running", "queued", "blocked", "completed", "failed"];

export const PATCH_STATUS: Record<Patch["status"], { label: string; glyph: string }> = {
  verified: { label: "Awaiting your decision", glyph: "!" },
  proposed: { label: "Proposed", glyph: "…" },
  merged: { label: "Merged", glyph: "✓" },
  rejected: { label: "Rejected", glyph: "✕" },
};

export const SEVERITY_CELLS = { critical: 5, high: 4, medium: 3, low: 2, info: 1 } as const;
export const TRUST_CELLS = { high: 3, medium: 2, low: 1 } as const;

export function isInFlight(run: Run): boolean {
  return run.status === "queued" || run.status === "running" || run.status === "blocked";
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function minutesSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, (now - Date.parse(iso)) / 60_000);
}

export function rel(iso: string): string {
  const m = minutesSince(iso);
  if (m < 1) return "just now";
  if (m < 60) return `${Math.floor(m)}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

/** "Sep 27, 10:31 AM" */
export function startedAt(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "owner/repo" on GitHub, the folder name for a local checkout. */
export function targetTitle(target: Run["target"]): string {
  const hash = target.kind === "github" ? target.ref.indexOf("#") : target.ref.lastIndexOf("#");
  const spec = hash === -1 ? target.ref : target.ref.slice(0, hash);
  if (target.kind === "github") {
    return spec.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  }
  return spec.split("/").filter(Boolean).pop() ?? spec;
}

/** "Running at Repair", "Failed at Ingest", "Completed", "Queued". */
export function whereText(run: Run): string {
  const at = run.stage === "done" ? "Done" : STAGE_LABEL[run.stage];
  if (run.status === "running") return `Running at ${at}`;
  if (run.status === "blocked") return `Blocked at ${at}`;
  if (run.status === "failed") return `Failed at ${at}`;
  return RUN_STATUS[run.status].label;
}

/** Time shown beside a run in flight: minutes running, or how long it has been queued. */
export function flightTime(run: Run): string {
  return run.status === "queued" ? rel(run.startedAt) : `${Math.floor(minutesSince(run.startedAt))} min`;
}

/** One plain sentence about where a Run is, built only from its stored stage, status, and tallies. */
export function statusLine(run: Run, c: RunCounts): string {
  switch (run.status) {
    case "queued":
      return "Queued. It starts when the orchestrator picks it up.";
    case "blocked":
      return `Blocked during ${run.stage}. It needs attention before it can continue.`;
    case "failed":
      return `Failed during ${run.stage}.`;
    case "completed":
      if (!c.findings) return "The detectors found nothing.";
      if (!c.reproducible) return `None of the ${c.findings} findings reproduced, so nothing needed a fix.`;
      if (!c.patches) return `${plural(c.reproducible, "finding", "findings")} reproduced, but no patch was written.`;
      return `Finished. ${c.verifiedPatches} of ${c.patches} patches verified from ${c.reproducible} reproduced findings.`;
    case "running":
      switch (run.stage) {
        case "ingest":
          return "Cloning the target and indexing its files.";
        case "detect":
          return c.findings ? `Running detectors. ${plural(c.findings, "finding", "findings")} so far.` : "Running detectors.";
        case "diagnose":
          return `Diagnosing ${c.reproducible} reproduced findings. ${c.diagnoses} done so far.`;
        case "repair":
          return c.patches
            ? `Writing patches. ${c.patches} proposed, ${c.verifiedPatches} verified so far.`
            : `Writing patches for ${plural(c.diagnoses, "diagnosis", "diagnoses")}.`;
        case "verify":
          return `Checking ${plural(c.patches, "patch", "patches")} against the tests and the Challenger.`;
        case "done":
          return "Wrapping up.";
      }
  }
}

export interface SummaryPart {
  text: string;
  ink: Ink;
  scanLink?: boolean;
}

/** The overview's opening sentence, emphasised counts in ink and the verified-patch count in needs. */
export function summaryParts(summaries: RunSummary[], waiting: number): SummaryPart[] {
  const count = (status: Run["status"]) => summaries.filter((s) => s.run.status === status).length;
  const running = count("running");
  const queued = count("queued");
  const blocked = count("blocked");
  const b = (text: string): SummaryPart => ({ text, ink: "ink" });
  const t = (text: string): SummaryPart => ({ text, ink: "ink2" });

  let parts: SummaryPart[] = [];
  if (running) {
    parts.push(t("Repro is working on "), b(plural(running, "run", "runs")));
    if (queued) parts.push(t(", with "), b(`${queued} more`), t(" queued"));
    parts.push(t("."));
  } else if (queued) {
    parts.push(b(plural(queued, "run", "runs")), t(queued === 1 ? " is queued for the orchestrator." : " are queued for the orchestrator."));
  }
  if (waiting) {
    parts.push(
      t(" "),
      { text: plural(waiting, "verified patch", "verified patches"), ink: "needs" },
      t(waiting === 1 ? " is waiting for your decision." : " are waiting for your decision."),
    );
  }
  if (blocked) parts.push(t(" "), b(String(blocked)), t(blocked === 1 ? " is blocked." : " are blocked."));
  if (!running && !queued && !waiting && !blocked) {
    parts = [t("Nothing is running. "), { text: "Scan a repository", ink: "ink", scanLink: true }, t(" to start a run.")];
  }
  return parts;
}

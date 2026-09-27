import type { Run } from "@repro/contracts";
import { STAGES, STAGE_LABEL } from "../lib/format.ts";

type StationState = "done" | "active" | "waiting" | "pending" | "blocked" | "failed";

const GLYPH: Record<StationState, string> = { done: "✓", active: "●", waiting: "…", pending: "", blocked: "!", failed: "✕" };

/**
 * `modelStagesSkipped`: the run completed with findings but no diagnoses, because it ran without
 * Gemini. Diagnose, Repair and Verify then show as not run instead of ticked.
 */
export function stationStates(run: Pick<Run, "stage" | "status">, modelStagesSkipped = false): StationState[] {
  const at = run.stage === "done" ? STAGES.length : STAGES.indexOf(run.stage);
  return STAGES.map((_, i) => {
    if (run.status === "completed") return modelStagesSkipped && i >= 2 ? "pending" : "done";
    if (run.status === "queued") return i === 0 ? "waiting" : "pending";
    if (i < at) return "done";
    if (i > at) return "pending";
    return run.status === "running" ? "active" : run.status === "blocked" ? "blocked" : "failed";
  });
}

function connector(from: StationState, to: StationState | undefined): string {
  if (to === "active") return "flow";
  if (from === "done" && to === "done") return "done";
  if (from === "done") return "reached";
  return "pending";
}

/**
 * Ingest → Detect → Diagnose → Repair → Verify as square stations. `lg` in the run sheet, `md` in
 * the in-flight window, `sm` (no glyphs or labels) in the runs list.
 */
export function StageTimeline({ run, size, modelStagesSkipped }: { run: Pick<Run, "stage" | "status">; size: "lg" | "md" | "sm"; modelStagesSkipped?: boolean }) {
  const states = stationStates(run, modelStagesSkipped);
  const labelled = size !== "sm";
  return (
    <div role="list" aria-label="Stage timeline" className="tl" data-size={size}>
      {STAGES.map((stage, i) => {
        const state = states[i] ?? "pending";
        return (
          <div key={stage} role="listitem" aria-label={`${STAGE_LABEL[stage]}: ${state}`} className="tl__stage" data-state={state}>
            <div className="tl__row">
              <span className="tl__box">{labelled ? GLYPH[state] : null}</span>
              {i < STAGES.length - 1 && <span className="tl__conn" data-kind={connector(state, states[i + 1])} />}
            </div>
            {labelled && <span className="tl__name">{STAGE_LABEL[stage]}</span>}
          </div>
        );
      })}
    </div>
  );
}

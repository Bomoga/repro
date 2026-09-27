import { useState } from "react";
import type { Run } from "@repro/contracts";
import type { RunSummary } from "@repro/api";
import { useFreshIds, type Poll } from "../lib/poll.ts";
import { toHash } from "../lib/route.ts";
import { RUN_STATUS, RUN_STATUS_ORDER, plural, rel, targetTitle, whereText } from "../lib/format.ts";
import { Num, Skeleton } from "./Bits.tsx";
import { StageTimeline } from "./StageTimeline.tsx";

type Filter = "all" | Run["status"];

export function RunsList({ summaries }: { summaries: Poll<RunSummary[]> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const all = summaries.data;
  const fresh = useFreshIds(all?.map((s) => s.run.id));

  if (!all) {
    return (
      <div className="view stack-14">
        <Skeleton height={60} width="40%" />
        <Skeleton height={200} />
      </div>
    );
  }

  const tally = (status: Run["status"]) => all.filter((s) => s.run.status === status).length;
  const chips: { key: Filter; label: string; glyph: string; n: number }[] = [
    { key: "all", label: "All", glyph: "", n: all.length },
    ...RUN_STATUS_ORDER.filter((s) => tally(s) > 0 || s === filter).map((s) => ({ key: s, label: RUN_STATUS[s].label, glyph: RUN_STATUS[s].glyph, n: tally(s) })),
  ];
  const rows = filter === "all" ? all : all.filter((s) => s.run.status === filter);

  return (
    <div className="view view--runs">
      <h1 className="sentence">
        <Num value={plural(all.length, "run", "runs")} />
        <span data-ink="ink2">, newest first</span>
      </h1>

      <div className="chips" role="group" aria-label="Filter by status">
        {chips.map((chip) => (
          <button key={chip.key} type="button" className="chip" aria-pressed={filter === chip.key} onClick={() => setFilter(chip.key)}>
            {chip.glyph && <span aria-hidden="true">{chip.glyph}</span>}
            {chip.label}
            <span className="chip__n">
              <Num value={chip.n} />
            </span>
          </button>
        ))}
      </div>

      <div>
        <div className="runs__head" aria-hidden="true">
          <span>Target</span>
          <span>Stage</span>
          <span>Findings</span>
          <span>Patches</span>
          <span>Started</span>
          <span />
        </div>
        {rows.length === 0 ? (
          <p className="boxed boxed--lg">
            {all.length === 0
              ? "No runs yet. Scan a repository from the overview to start the first one."
              : `No ${filter === "all" ? "" : RUN_STATUS[filter].label.toLowerCase()} runs.`}
          </p>
        ) : (
          rows.map(({ run, counts }, i) => (
            <a
              key={run.id}
              className="row runrow"
              href={toHash({ tab: "runs", runId: run.id })}
              data-fresh={fresh.has(run.id) || undefined}
              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <span className="runrow__name">{targetTitle(run.target)}</span>
              <span className="runrow__stage">
                <span className="runrow__tl">
                  <StageTimeline run={run} size="sm" />
                </span>
                <span className="runrow__where" data-ink={RUN_STATUS[run.status].ink}>
                  {RUN_STATUS[run.status].glyph} {whereText(run)}
                </span>
              </span>
              <span className="runrow__f" data-none={!counts.findings || undefined}>
                {counts.findings ? <Num value={`${counts.reproducible}/${counts.findings} reproduced`} /> : "—"}
              </span>
              <span className="runrow__p" data-none={!counts.patches || undefined}>
                {counts.patches ? <Num value={`${counts.verifiedPatches}/${counts.patches} verified`} /> : "—"}
              </span>
              <span className="runrow__t">{rel(run.startedAt)}</span>
              <span className="runrow__go" aria-hidden="true">
                →
              </span>
            </a>
          ))
        )}
      </div>
    </div>
  );
}

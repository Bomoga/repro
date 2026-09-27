import type { Run } from "@repro/contracts";
import type { RunSummary } from "@repro/api";
import { useFreshIds, type Poll } from "../lib/poll.ts";
import type { ReviewItem } from "../lib/review.ts";
import { toHash } from "../lib/route.ts";
import { RUN_STATUS, flightTime, isInFlight, rel, statusLine, summaryParts, targetTitle } from "../lib/format.ts";
import { Skeleton, TrustMeter, Window } from "./Bits.tsx";
import { FixDestination } from "./FixDestination.tsx";
import { ScanBar } from "./ScanBar.tsx";
import { StageTimeline } from "./StageTimeline.tsx";

const FLIGHT_ORDER: Partial<Record<Run["status"], number>> = { running: 0, blocked: 1, queued: 2 };

export function StatusText({ run, time }: { run: Run; time: string }) {
  const status = RUN_STATUS[run.status];
  return (
    <span className="status" data-ink={status.ink}>
      <span className="status__glyph" data-pulse={status.pulse || undefined}>
        {status.glyph}
      </span>
      {status.label} · {time}
    </span>
  );
}

export function Overview({
  summaries,
  review,
  onQueued,
  onRefused,
  scanFocus,
  onScanFocused,
  onScanLink,
  onError,
}: {
  summaries: Poll<RunSummary[]>;
  review: Poll<ReviewItem[]>;
  onQueued: (run: Run) => void;
  onRefused: (ref: string) => void;
  scanFocus: number;
  onScanFocused: () => void;
  onScanLink: () => void;
  onError: (message: string) => void;
}) {
  const all = summaries.data;
  const fresh = useFreshIds(all?.map((s) => s.run.id));
  const inFlight = (all ?? [])
    .filter((s) => isInFlight(s.run))
    .sort((a, b) => (FLIGHT_ORDER[a.run.status] ?? 9) - (FLIGHT_ORDER[b.run.status] ?? 9));
  const finished = (all ?? []).filter((s) => !isInFlight(s.run)).slice(0, 5);
  const waiting = review.data;

  return (
    <div className="view view--overview">
      {all ? (
        <p className="sentence">
          {summaryParts(all, waiting?.length ?? 0).map((part, i) =>
            part.scanLink ? (
              <button key={i} type="button" className="sentence__link" onClick={onScanLink}>
                {part.text}
              </button>
            ) : (
              <span key={i} data-ink={part.ink}>
                {part.text}
              </span>
            ),
          )}
        </p>
      ) : (
        <div className="stack-14">
          <Skeleton height={44} width="80%" />
          <Skeleton height={44} width="55%" />
        </div>
      )}

      <div className="scan-stack">
        <ScanBar onQueued={onQueued} onRefused={onRefused} focusSignal={scanFocus} onFocused={onScanFocused} />
        <FixDestination onError={onError} />
      </div>

      <Window title="In flight" count={all ? inFlight.length : ""}>
        {!all ? (
          <Skeleton height={120} />
        ) : inFlight.length === 0 ? (
          <p className="win__empty">Nothing in flight.</p>
        ) : (
          inFlight.map(({ run, counts }, i) => (
            <a
              key={run.id}
              className="row flight"
              href={toHash({ tab: "overview", runId: run.id })}
              data-fresh={fresh.has(run.id) || undefined}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className="flight__who">
                <span className="flight__name">{targetTitle(run.target)}</span>
                <StatusText run={run} time={flightTime(run)} />
              </span>
              <span className="flight__what">
                <StageTimeline run={run} size="md" />
                <span className="flight__sentence">{statusLine(run, counts)}</span>
              </span>
            </a>
          ))
        )}
      </Window>

      <div className="pair">
        <Window title="Needs you" count={waiting ? waiting.length : ""}>
          {!waiting ? (
            <Skeleton height={120} />
          ) : waiting.length === 0 ? (
            <p className="win__empty win__empty--sm">No patches waiting.</p>
          ) : (
            waiting.slice(0, 4).map((item, i) => (
              <a
                key={item.patch.id}
                className="row mini"
                href={toHash({ tab: "overview", runId: item.run.id, runTab: "patches" })}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span className="mini__strategy">{item.diagnosis?.proposedStrategy ?? item.patch.id}</span>
                {item.trust && <TrustMeter trust={item.trust} compact />}
              </a>
            ))
          )}
        </Window>

        <Window title="Finished">
          {!all ? (
            <Skeleton height={120} />
          ) : finished.length === 0 ? (
            <p className="win__empty win__empty--sm">Nothing finished yet.</p>
          ) : (
            finished.map(({ run }, i) => (
              <a key={run.id} className="row mini" href={toHash({ tab: "overview", runId: run.id })} style={{ animationDelay: `${i * 40}ms` }}>
                <span className="mini__name">{targetTitle(run.target)}</span>
                <span className="status" data-ink={RUN_STATUS[run.status].ink}>
                  {RUN_STATUS[run.status].glyph} {RUN_STATUS[run.status].label}
                  <span className="status__time">· {rel(run.startedAt)}</span>
                </span>
              </a>
            ))
          )}
        </Window>
      </div>
    </div>
  );
}

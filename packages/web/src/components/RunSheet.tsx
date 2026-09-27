import { motion } from "framer-motion";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import type { PatchDecision, RunReport, TrustReport } from "@repro/api";
import { api } from "../api.ts";
import { usePoll } from "../lib/poll.ts";
import { RUN_TABS, toHash, type RunTab, type Tab } from "../lib/route.ts";
import { sieveSteps } from "../lib/sieve.ts";
import {
  RUN_STATUS,
  SEVERITY_CELLS,
  STAGES,
  STAGE_LABEL,
  clockTime,
  isInFlight,
  minutesSince,
  startedAt,
  statusLine,
  targetTitle,
} from "../lib/format.ts";
import { Num, SeverityMeter, Skeleton } from "./Bits.tsx";
import { PatchCard } from "./PatchCard.tsx";
import { Sieve } from "./Sieve.tsx";
import { StageTimeline } from "./StageTimeline.tsx";

const PATCH_ORDER: Record<Patch["status"], number> = { verified: 0, proposed: 1, merged: 2, rejected: 3 };
const TIMING_SHADES = ["var(--ink)", "var(--ink2)", "var(--line2)", "var(--mute)", "transparent"];
const SHEET_SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;

/** Focus moves in and back out, Tab stays inside, Esc closes, the page behind stops scrolling. */
function useDialog(ref: RefObject<HTMLElement | null>, initialFocus: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = setTimeout(() => (initialFocus.current ?? ref.current)?.focus(), 60);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]')).filter(
        (el) => el.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [ref, initialFocus]);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {children}
    </div>
  );
}

function FindingRow({ finding, open, onToggle }: { finding: Finding; open: boolean; onToggle: () => void }) {
  const lines = finding.lineEnd !== finding.lineStart ? `${finding.lineStart}–${finding.lineEnd}` : `${finding.lineStart}`;
  return (
    <div className="finding" data-reproducible={finding.reproducible || undefined}>
      <button type="button" className="finding__head" data-open={open || undefined} aria-expanded={open} onClick={onToggle}>
        <SeverityMeter level={finding.severity} />
        <span className="finding__main">
          <span className="finding__msg">{finding.message}</span>
          <code className="finding__loc">
            {finding.file}:{lines} · {finding.detectorId}
          </code>
        </span>
        <span className="badge" data-proven={finding.reproducible || undefined}>
          {finding.reproducible ? "Reproduced" : "Not reproduced"}
        </span>
      </button>
      {open && (
        <div className="finding__body">
          <Field label="Evidence">
            <code className="codebox codebox--pre">{finding.evidence}</code>
          </Field>
          <Field label="Rule">
            <code>{finding.ruleId}</code>
          </Field>
          {finding.reproductionCommand && (
            <Field label="Reproduction command">
              <code className="wrap">{finding.reproductionCommand}</code>
            </Field>
          )}
          {finding.reproducible && finding.reproductionOutput ? (
            <Field label="Reproduction output">
              <code className="codebox">{finding.reproductionOutput}</code>
            </Field>
          ) : (
            <p className="finding__note">
              {finding.reproductionCommand
                ? "This didn't reproduce in the sandbox, so Repro left it alone."
                : "No reproduction command exists for this rule, so it stays unconfirmed and Repro leaves it alone."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FindingsPanel({ findings }: { findings: Finding[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (findings.length === 0) return <p className="boxed sub-empty">No findings yet. They appear here as the detectors report.</p>;
  const sorted = [...findings].sort(
    (a, b) => Number(b.reproducible) - Number(a.reproducible) || SEVERITY_CELLS[b.severity] - SEVERITY_CELLS[a.severity],
  );
  return (
    <div className="findings">
      {sorted.map((finding) => (
        <FindingRow key={finding.id} finding={finding} open={openId === finding.id} onToggle={() => setOpenId(openId === finding.id ? null : finding.id)} />
      ))}
    </div>
  );
}

function DiagnosesPanel({ diagnoses, findings }: { diagnoses: Diagnosis[]; findings: Finding[] }) {
  if (diagnoses.length === 0) return <p className="boxed sub-empty">No diagnoses yet. Diagnosis starts once findings reproduce.</p>;
  return (
    <div className="subpanel">
      {diagnoses.map((diagnosis) => (
        <article key={diagnosis.id} className="diag">
          <p className="diag__cause">{diagnosis.rootCause}</p>
          <div className="diag__grid">
            <span className="diag__k">Strategy</span>
            <span>{diagnosis.proposedStrategy}</span>
            <span className="diag__k">Risk</span>
            <span>{diagnosis.riskNotes}</span>
            <span className="diag__k">Cites</span>
            <span className="diag__cites">
              {diagnosis.findingIds.map((id) => {
                const f = findings.find((x) => x.id === id);
                return (
                  <code key={id} className="cite">
                    {f ? `${f.file}:${f.lineStart}` : id}
                  </code>
                );
              })}
            </span>
          </div>
          <code className="diag__model">
            {diagnosis.model} · {clockTime(diagnosis.createdAt)}
          </code>
        </article>
      ))}
    </div>
  );
}

function ReportPanel({ run, findings, patches, report }: { run: Run; findings: Finding[]; patches: Patch[]; report: RunReport | undefined }) {
  const reproduced = findings.filter((f) => f.reproducible).length;
  const verified = patches.filter((p) => p.status === "verified" || p.status === "merged").length;
  const tokensPerFix = report?.stats.tokensPerFix ?? null;
  const active = isInFlight(run);
  const facts: [string, string][] = [
    ["Findings reproduced", findings.length ? `${reproduced} of ${findings.length}` : "—"],
    ["Didn't reproduce", String(findings.length - reproduced)],
    ["Patches verified", patches.length ? `${verified} of ${patches.length} · ${Math.round((verified / patches.length) * 100)}%` : "—"],
    ["Merged", String(patches.filter((p) => p.status === "merged").length)],
    ["Challenger disputes", String(patches.filter((p) => p.challengerVerdict === "disputed").length)],
    ["Regressions caught", String(patches.reduce((n, p) => n + p.regressionFindings.length, 0))],
    ["Gemini tokens per fix", tokensPerFix === null ? "None logged" : tokensPerFix.toLocaleString("en-US")],
    [active ? "Running for" : "Started", active ? `${Math.floor(minutesSince(run.startedAt))} min` : startedAt(run.startedAt)],
  ];
  const timing = STAGES.map((stage) => [stage, report?.stats.timePerStageMs[stage] ?? 0] as const).filter(([, ms]) => ms > 0);

  return (
    <div className="subpanel subpanel--report">
      <dl className="facts">
        {facts.map(([k, v]) => (
          <div key={k} className="fact">
            <dt>{k}</dt>
            <dd data-mute={v === "None logged" || v === "—" || undefined}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="timing">
        <span className="field__label field__label--lg">Time per stage</span>
        {timing.length === 0 ? (
          <p className="timing__none">Stage timings appear once the orchestrator logs this run's stages.</p>
        ) : (
          <>
            <div className="timing__bar">
              {timing.map(([stage, ms], i) => (
                <span key={stage} title={`${STAGE_LABEL[stage]} ${Math.round(ms / 1000)} s`} style={{ flex: ms, background: TIMING_SHADES[i] }} />
              ))}
            </div>
            <div className="timing__legend">
              {timing.map(([stage, ms], i) => (
                <span key={stage}>
                  <span className="timing__swatch" style={{ background: TIMING_SHADES[i] }} />
                  {STAGE_LABEL[stage]} {Math.round(ms / 1000)} s
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function RunSheet({
  tab,
  runId,
  runTab,
  onClose,
  onTab,
  onDecided,
  onError,
}: {
  tab: Tab;
  runId: string;
  runTab: RunTab | undefined;
  onClose: () => void;
  onTab: (runTab: RunTab) => void;
  onDecided: (patch: Patch, decision: PatchDecision) => void;
  onError: (message: string) => void;
}) {
  const detail = usePoll(() => api.detail(runId), 3000, `detail:${runId}`);
  const report = usePoll(() => api.report(runId), 10_000, `report:${runId}`);
  const trustIds = (detail.data?.patches ?? []).filter((p) => p.status === "verified" || p.status === "merged").map((p) => p.id);
  const trust = usePoll(
    async () => {
      const reports = await Promise.all(trustIds.map((id) => api.trustReport(runId, id)));
      return Object.fromEntries(reports.map((r) => [r.patchId, r])) as Record<string, TrustReport>;
    },
    15_000,
    `trust:${runId}:${trustIds.join("\n")}`,
    detail.data !== undefined,
  );

  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useDialog(panel, closeButton, onClose);

  // The sieve's bars start at the previous gate's height and settle once the sheet has opened.
  const [settled, setSettled] = useState(false);
  const hasData = detail.data !== undefined;
  useEffect(() => {
    setSettled(false);
    if (!hasData) return;
    const timer = setTimeout(() => setSettled(true), 60);
    return () => clearTimeout(timer);
  }, [runId, hasData]);

  const data = detail.data;
  const sub: RunTab = runTab ?? (data?.patches.some((p) => p.status === "verified") ? "patches" : "findings");
  const status = data ? RUN_STATUS[data.run.status] : undefined;

  const onSubKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = RUN_TABS[(RUN_TABS.indexOf(sub) + step + RUN_TABS.length) % RUN_TABS.length];
    if (!next) return;
    onTab(next);
    setTimeout(() => event.currentTarget?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(), 30);
  };

  const decided = (patch: Patch, decision: PatchDecision) => {
    onDecided(patch, decision);
    void detail.refresh();
    void trust.refresh();
  };

  return (
    <>
      <motion.div className="backdrop" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={data ? targetTitle(data.run.target) : "Run"}
        className="sheet"
        initial={{ opacity: 0, x: 48 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 48, transition: { duration: 0.2 } }}
        transition={SHEET_SPRING}
      >
        <span className="sheet__corner" data-side="left" aria-hidden="true" />
        <span className="sheet__corner" data-side="right" aria-hidden="true" />
        <div className="sheet__inner">
          <div className="sheet__meta">
            <code className="sheet__meta-text">
              {data ? `${data.run.id} · ${data.run.target.kind} · ${data.run.trigger} · started ${startedAt(data.run.startedAt)}` : runId}
            </code>
            <button ref={closeButton} type="button" className="sheet__close" aria-label="Close run" onClick={onClose}>
              ✕<kbd>esc</kbd>
            </button>
          </div>

          {!data ? (
            detail.error ? (
              <div className="sheet__missing">
                <h2>✕ Run unavailable</h2>
                <code>{detail.error}</code>
              </div>
            ) : (
              <div className="stack-14">
                <Skeleton height={56} width="60%" />
                <Skeleton height={28} width="40%" />
                <Skeleton height={200} />
              </div>
            )
          ) : (
            <>
              <div className="sheet__title">
                <h1>{targetTitle(data.run.target)}</h1>
                <code className="wrap">{data.run.target.ref}</code>
                <span className="sheet__status">
                  <span className="sheet__status-word" data-ink={status?.ink}>
                    <span className="status__glyph" data-pulse={status?.pulse || undefined}>
                      {status?.glyph}
                    </span>
                    <span>{status?.label}</span>
                  </span>
                  <span data-ink="ink2">{statusLine(data.run, data.counts)}</span>
                </span>
              </div>

              <StageTimeline run={data.run} size="lg" modelStagesSkipped={data.findings.length > 0 && data.diagnoses.length === 0} />

              <Sieve steps={sieveSteps(data.findings, data.diagnoses, data.patches)} settled={settled} />

              <div>
                <div role="tablist" aria-label="Run sections" className="subtabs" onKeyDown={onSubKey}>
                  {(
                    [
                      ["findings", "Findings", data.findings.length],
                      ["diagnoses", "Diagnoses", data.diagnoses.length],
                      ["patches", "Patches", data.patches.length],
                      ["report", "Report", null],
                    ] as const
                  ).map(([key, label, n]) => (
                    <a
                      key={key}
                      role="tab"
                      id={`run-tab-${key}`}
                      href={toHash({ tab, runId, runTab: key })}
                      aria-selected={sub === key}
                      tabIndex={sub === key ? 0 : -1}
                      className="subtab"
                      onClick={(event) => {
                        event.preventDefault();
                        onTab(key);
                      }}
                    >
                      {label}
                      {n !== null && (
                        <span className="subtab__n">
                          <Num value={n} />
                        </span>
                      )}
                    </a>
                  ))}
                </div>

                <div role="tabpanel" aria-labelledby={`run-tab-${sub}`} key={sub} className="fade">
                  {sub === "findings" && <FindingsPanel findings={data.findings} />}
                  {sub === "diagnoses" && <DiagnosesPanel diagnoses={data.diagnoses} findings={data.findings} />}
                  {sub === "patches" &&
                    (data.patches.length === 0 ? (
                      <p className="boxed sub-empty">No patches yet. Repair writes them once a diagnosis is ready.</p>
                    ) : (
                      <div className="subpanel">
                        {[...data.patches]
                          .sort((a, b) => PATCH_ORDER[a.status] - PATCH_ORDER[b.status])
                          .map((patch) => (
                            <PatchCard
                              key={patch.id}
                              patch={patch}
                              diagnosis={data.diagnoses.find((d) => d.id === patch.diagnosisId)}
                              trust={trust.data?.[patch.id]}
                              onDecided={decided}
                              onError={onError}
                            />
                          ))}
                      </div>
                    ))}
                  {sub === "report" && <ReportPanel run={data.run} findings={data.findings} patches={data.patches} report={report.data} />}
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </>
  );
}

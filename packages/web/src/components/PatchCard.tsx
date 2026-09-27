import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import type { Diagnosis, Patch } from "@repro/contracts";
import type { PatchDecision, TrustReport } from "@repro/api";
import { api } from "../api.ts";
import { PATCH_STATUS, plural } from "../lib/format.ts";
import { TrustMeter } from "./Bits.tsx";

const STANDARD = [0.4, 0, 0.2, 1] as const;

function checks(patch: Patch) {
  const regressions = patch.regressionFindings.length;
  return [
    { ok: patch.testsPassed, label: patch.testsPassed ? "Tests pass" : "Tests fail" },
    { ok: !patch.originalFindingReproduces, label: patch.originalFindingReproduces ? "Finding still reproduces" : "Finding no longer reproduces" },
    { ok: patch.challengerVerdict === "confirmed", label: patch.challengerVerdict === "confirmed" ? "Challenger confirmed" : "Challenger disputed" },
    { ok: regressions === 0, label: regressions === 0 ? "No regressions" : plural(regressions, "regression", "regressions") },
  ];
}

type DiffLine = { sign: string; src: string; kind: "meta" | "hunk" | "add" | "del" | "context" };

function diffLines(diff: string): DiffLine[] {
  return diff
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => {
      if (/^(diff |index |--- |\+\+\+ )/.test(line)) return { sign: "", src: line, kind: "meta" };
      if (line.startsWith("@@")) return { sign: "", src: line, kind: "hunk" };
      if (line.startsWith("+")) return { sign: "+", src: line.slice(1), kind: "add" };
      if (line.startsWith("-")) return { sign: "−", src: line.slice(1), kind: "del" };
      return { sign: "", src: line.slice(1), kind: "context" };
    });
}

export function PatchCard({
  patch,
  diagnosis,
  trust,
  leaveOnDecide,
  onDecided,
  onError,
}: {
  patch: Patch;
  diagnosis: Diagnosis | undefined;
  trust: TrustReport | undefined;
  /** In the Review queue a decided card slides out before the queue refreshes. */
  leaveOnDecide?: boolean;
  onDecided: (patch: Patch, decision: PatchDecision) => void;
  onError: (message: string) => void;
}) {
  const [diffOpen, setDiffOpen] = useState(false);
  const [confirm, setConfirm] = useState<PatchDecision | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const savingRef = useRef(false);
  const diffId = useId();

  // An unanswered confirmation stands down after 5 s instead of waiting armed forever.
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => {
      if (!savingRef.current) setConfirm(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [confirm]);

  const decide = async (decision: PatchDecision) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await api.decidePatch(patch.id, decision);
      setSaving(false);
      setConfirm(null);
      if (leaveOnDecide) {
        setLeaving(true);
        setTimeout(() => onDecided(patch, decision), 360);
      } else {
        onDecided(patch, decision);
      }
    } catch (e) {
      setSaving(false);
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      savingRef.current = false;
    }
  };

  const status = PATCH_STATUS[patch.status];
  const secondary = patch.status === "rejected" || patch.status === "proposed";
  const verified = patch.status === "verified";

  return (
    <article className="card" data-secondary={secondary || undefined} data-leaving={leaving || undefined}>
      <div className="card__head">
        <span className="card__status" data-status={patch.status}>
          <span className="card__status-box">{status.glyph}</span>
          {status.label}
        </span>
        <code className="card__id">{patch.id}</code>
        {trust && (verified || patch.status === "merged") && <TrustMeter trust={trust} />}
      </div>

      <div className="card__body">
        <p className="card__strategy">{diagnosis?.proposedStrategy ?? "No diagnosis is recorded for this patch."}</p>
        <div className="card__files">
          <code>{patch.filesChanged.join(", ")}</code>
        </div>
        <div className="checks">
          {checks(patch).map((check) => (
            <span key={check.label} className="check" data-ok={check.ok || undefined}>
              <span className="check__box">{check.ok ? "✓" : "✕"}</span>
              {check.label}
            </span>
          ))}
        </div>

        <AnimatePresence initial={false}>
          {diffOpen && (
            <motion.div
              id={diffId}
              className="card__more"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: STANDARD }}
            >
              <div className="card__more-inner">
                {patch.challengerNotes && (
                  <blockquote className="challenger" data-verdict={patch.challengerVerdict}>
                    <span className="challenger__label">
                      {patch.challengerVerdict === "confirmed" ? "✓ Challenger confirmed" : "✕ Challenger disputed"}
                    </span>
                    {patch.challengerNotes}
                  </blockquote>
                )}
                <div className="diff" tabIndex={0} aria-label="Patch diff">
                  {diffLines(patch.diff).map((line, i) => (
                    <div key={i} className="diff__line" data-kind={line.kind}>
                      <span className="diff__sign">{line.sign}</span>
                      <span>{line.src}</span>
                    </div>
                  ))}
                </div>
                {patch.reproductionOutputAfter && (
                  <div className="field">
                    <span className="field__label">Reproduction after the patch</span>
                    <code className="codebox">{patch.reproductionOutputAfter}</code>
                  </div>
                )}
                {patch.regressionFindings.length > 0 && (
                  <div className="field">
                    <span className="field__label" data-fail="">
                      ✕ Regression findings
                    </span>
                    {patch.regressionFindings.map((f) => (
                      <code key={f.id} className="regression">
                        {f.file}:{f.lineStart} · {f.message}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="card__foot">
        <button type="button" className="btn btn--sm" aria-expanded={diffOpen} aria-controls={diffId} onClick={() => setDiffOpen(!diffOpen)}>
          {diffOpen ? "Hide diff" : "Show diff"}
        </button>
        {patch.prUrl?.startsWith("file://") ? (
          <code className="card__pr" title={patch.prUrl.slice("file://".length).replace("#", " · branch ")}>
            Local branch {patch.prUrl.split("#")[1]}
          </code>
        ) : (
          patch.prUrl && (
            <a className="card__pr" href={patch.prUrl} target="_blank" rel="noopener noreferrer">
              Pull request ↗
            </a>
          )
        )}
        {verified && (
          <span className="card__decide">
            {confirm ? (
              <>
                <button type="button" className="btn" disabled={saving} onClick={() => setConfirm(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--confirm"
                  data-kind={confirm === "reject" ? "danger" : "primary"}
                  disabled={saving}
                  onClick={() => decide(confirm)}
                  autoFocus
                >
                  {saving ? "Saving…" : confirm === "reject" ? "Confirm reject" : "Confirm merge"}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn" onClick={() => setConfirm("reject")}>
                  Reject
                </button>
                <button type="button" className="btn" data-kind="primary" onClick={() => setConfirm("merge")}>
                  Merge
                </button>
              </>
            )}
          </span>
        )}
      </div>
    </article>
  );
}

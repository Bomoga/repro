import REPORT from "../sample-report.json";

// A real run's trust report, exported from the Run Store as it was (evidence left out, one planted
// secret redacted). Every percentage is computed from the counts in the export.
type Patch = (typeof REPORT.patches)[number];

const pct = (part: number, whole: number) => `${whole > 0 ? Math.round((part / whole) * 100) : 0}%`;
const diagnosisById = new Map(REPORT.diagnoses.map((d) => [d.id, d]));
const findingById = new Map(REPORT.findings.map((f) => [f.id, f]));
const SEVERITY = ["critical", "high", "medium", "low", "info"];

function Diff({ diff }: { diff: string }) {
  return (
    <pre className="rep__diff">
      {diff.split("\n").map((line, i) => (
        <span key={i} data-kind={line.startsWith("+++") || line.startsWith("---") ? "file" : line.startsWith("@@") ? "hunk" : line[0] === "+" ? "add" : line[0] === "-" ? "del" : undefined}>
          {line || " "}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function Checks({ patch }: { patch: Patch }) {
  const checks: [string, boolean][] = [
    ["Tests pass", patch.testsPassed],
    ["Original finding gone", !patch.originalFindingReproduces],
    [patch.regressions ? `${patch.regressions} new finding${patch.regressions > 1 ? "s" : ""}` : "No new findings", patch.regressions === 0],
    [patch.challengerVerdict === "confirmed" ? "Challenger agrees" : "Challenger disputes", patch.challengerVerdict === "confirmed"],
  ];
  return (
    <div className="rep__checks">
      {checks.map(([label, ok]) => (
        <span key={label} className="rep__check" data-ok={ok}>
          {ok ? "✓" : "✗"} {label}
        </span>
      ))}
    </div>
  );
}

function PatchCard({ patch, open }: { patch: Patch; open: boolean }) {
  const diagnosis = diagnosisById.get(patch.diagnosisId);
  const findings = (diagnosis?.findingIds ?? []).map((id) => findingById.get(id)).filter((f) => f !== undefined);
  const label = patch.status === "merged" ? "verified · merged" : patch.status === "rejected" ? "rejected" : "disputed · not merged";
  return (
    <details className="panel rep__patch" open={open}>
      <summary className="card__tab rep__sum">
        <span>{patch.filesChanged.join(", ")}</span>
        <span className="rep__status" data-status={patch.status}>
          {label}
        </span>
      </summary>
      <div className="rep__body">
        <Checks patch={patch} />
        {diagnosis && (
          <>
            <div className="rep__k">Root cause · {findings.length} finding{findings.length === 1 ? "" : "s"}</div>
            <p className="rep__p">{diagnosis.rootCause}</p>
          </>
        )}
        <div className="rep__k">The patch</div>
        <Diff diff={patch.diff} />
        {patch.challengerNotes && (
          <>
            <div className="rep__k">Challenger</div>
            <p className="rep__p">{patch.challengerNotes}</p>
          </>
        )}
      </div>
    </details>
  );
}

export function Report() {
  const { findings, diagnoses, patches } = REPORT;
  const merged = patches.filter((p) => p.status === "merged");
  const rest = patches.filter((p) => p.status !== "merged");
  const rejected = patches.filter((p) => p.status === "rejected").length;
  const reproduced = findings.filter((f) => f.reproduced).length;
  const date = new Date(REPORT.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const stats: [string, string, string][] = [
    [pct(reproduced, findings.length), "of findings reproduced", `${findings.length} found by scanners, each re-run in the sandbox`],
    [pct(findings.length - diagnoses.length, findings.length), "fewer repair sessions", `${findings.length} findings grouped into ${diagnoses.length} root causes`],
    [pct(merged.length, patches.length), "of patches verified", "tests pass, finding gone, Challenger agrees"],
    [pct(rejected, patches.length), "of patches rejected", "before a person had to look at them"],
  ];

  return (
    <div className="res">
      <section className="intro">
        <span className="eyebrow">sample report · a real run · {date}</span>
        <h1 className="intro__title">{REPORT.target}</h1>
        <p className="res__lede">
          The trust report Repro produced for our deliberately vulnerable demo repo, exported as it was. Every patch below was proven or rejected by the
          sandbox, not by a model's say-so. The run was stopped early to restart the control plane.
        </p>
      </section>

      <section className="res__grid">
        {stats.map(([big, label, sub]) => (
          <div key={label} className="panel res__stat">
            <span className="res__num">{big}</span>
            <span className="res__label">{label}</span>
            <span className="res__sub">{sub}</span>
          </div>
        ))}
      </section>

      <h2 className="rep__h">Verified patches · {pct(merged.length, patches.length)}</h2>
      {merged.map((p) => (
        <PatchCard key={p.id} patch={p} open />
      ))}

      <h2 className="rep__h">Stopped by the gate · {pct(rest.length, patches.length)}</h2>
      {rest.map((p) => (
        <PatchCard key={p.id} patch={p} open={false} />
      ))}

      <h2 className="rep__h">Every finding · {findings.length}</h2>
      <section className="panel">
        <div className="card__tab">
          <span>{SEVERITY.filter((s) => findings.some((f) => f.severity === s)).map((s) => `${s} ${pct(findings.filter((f) => f.severity === s).length, findings.length)}`).join(" · ")}</span>
          <span>{pct(reproduced, findings.length)} reproduced</span>
        </div>
        {findings.map((f) => (
          <div key={f.id} className="receipt__row res__row rep__finding">
            <span>
              <span className="rep__sev" data-sev={f.severity}>
                {f.severity}
              </span>{" "}
              {f.file}:{f.line}
              <span className="res__how">
                {f.detector} · {f.rule} · {f.message}
              </span>
            </span>
            <span className="receipt__v rep__fstatus">{f.status}</span>
          </div>
        ))}
      </section>

      <p className="res__note">
        Run {REPORT.runId}. Exported from Repro's run store; finding evidence is left out and one hardcoded secret planted in the demo repo is redacted from two
        diffs.
      </p>
    </div>
  );
}

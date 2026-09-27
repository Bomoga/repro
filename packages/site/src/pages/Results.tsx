import { RESULTS } from "../results.ts";

// Every headline is a share computed from the raw counts in results.ts, so the page stays true for
// any run size: swap in another run's numbers and the percentages follow.
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const pct = (part: number, whole: number) => {
  const value = share(part, whole);
  return `${value.toFixed(value > 0 && value < 10 ? 1 : 0)}%`;
};
const n = (value: number) => value.toLocaleString("en-US");

export function Results() {
  const { run, runs, tokens, saved, benchmarks } = RESULTS;
  const avoided = saved.grouping.tokens + saved.gate.tokens;
  const withoutRepro = tokens.total + avoided;
  const challengerWithoutGate = tokens.byRole.challenger + saved.gate.tokens;
  const benchFound = benchmarks.reduce((sum, b) => sum + (b.reproduced === null ? 0 : b.findings), 0);
  const benchReproduced = benchmarks.reduce((sum, b) => sum + (b.reproduced ?? 0), 0);

  const headlines: [string, string, string][] = [
    [pct(avoided, withoutRepro), "fewer tokens overall", "grouping + early rejection vs. one repair and one review per finding"],
    ["0%", "of tokens spent finding bugs", `${run.findings} findings detected and reproduced by scanners and the sandbox`],
    [pct(run.findings - run.diagnoses, run.findings), "fewer repair sessions", `${run.findings} findings grouped into ${run.diagnoses} root causes`],
    [pct(tokens.cached, tokens.input), "of input served from cache", "billed at the cached rate"],
    [pct(run.rejected, run.attempts), "of patches blocked by the gate", "before a person ever saw them"],
    [pct(tokens.flash, tokens.requests), "of requests on the smaller model", "the larger model only for diagnosis and the Challenger"],
  ];

  const rows = (items: [string, number, number, string?][]) =>
    items.map(([label, part, whole, note]) => (
      <div key={label} className="receipt__row res__row">
        <span>
          {label}
          <span className="res__how">{note ?? `${n(part)} of ${n(whole)}`}</span>
        </span>
        <span className="receipt__v">{pct(part, whole)}</span>
      </div>
    ));

  return (
    <div className="res">
      <section className="intro">
        <span className="eyebrow">results · measured at ShellHacks 2026</span>
        <h1 className="intro__title">Real runs. Real numbers.</h1>
        <p className="res__lede">Every figure comes from Repro's own run store and logs, as a share of the run, so it holds at any scale. No model wrote any of them.</p>
      </section>

      <section className="res__grid">
        {headlines.map(([big, label, sub]) => (
          <div key={label} className="panel res__stat">
            <span className="res__num">{big}</span>
            <span className="res__label">{label}</span>
            <span className="res__sub">{sub}</span>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="card__tab">
          <span>tokens saved</span>
          <span>{pct(avoided, withoutRepro)} of the no-Repro estimate</span>
        </div>
        {rows([
          ["Detection and reproduction on the model", 0, run.findings, "scanners + sandbox: no model involved"],
          ["Repair sessions avoided by root-cause grouping", run.findings - run.diagnoses, run.findings],
          ["Challenger reviews avoided by deterministic checks", saved.gate.tokens, challengerWithoutGate, `${pct(run.rejectedBeforeChallenger, run.attempts)} of patches rejected before the Challenger ran`],
          ["Input tokens served from cache", tokens.cached, tokens.input],
        ])}
      </section>

      <section className="panel">
        <div className="card__tab">
          <span>the runs · combined above</span>
          <span>{runs.length} targets</span>
        </div>
        {runs.map((r) => (
          <div key={r.target} className="receipt__row res__row">
            <span>
              {r.target}
              {!r.finished && <span className="res__live"> · still running</span>}
              <span className="res__how">
                {r.how} {pct(r.reproduced, r.findings)} reproduced · {pct(r.findings - r.diagnoses, r.findings)} fewer repair sessions ·{" "}
                {pct(r.rejected, r.attempts)} of patches blocked · {pct(r.tokens.cached, r.tokens.input)} cached
              </span>
            </span>
            <span className="receipt__v">{pct(r.total, tokens.total)} of tokens</span>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="card__tab">
          <span>where the tokens went · {run.target}</span>
          <span>100% = every run above</span>
        </div>
        <div className="res__bar" aria-label="Tokens by stage">
          {Object.entries(tokens.byRole).map(([role, value]) => (
            <span key={role} className="res__seg" data-role={role} style={{ flexGrow: value }} title={`${role}: ${pct(value, tokens.total)}`} />
          ))}
        </div>
        {rows([
          ["Repair", tokens.byRole.repair, tokens.total, "the agent that writes the patch"],
          ["Challenger", tokens.byRole.challenger, tokens.total, "counter-tests that try to break each patch"],
          ["Diagnosis", tokens.byRole.diagnose, tokens.total, "one request covers every finding in a run"],
          ["Thinking tokens", tokens.thought, tokens.total, "model reasoning"],
          ["Requests on the larger model", tokens.pro, tokens.requests],
        ])}
      </section>

      <section className="panel">
        <div className="card__tab">
          <span>the gate · every repair attempt</span>
          <span>100% = all attempts</span>
        </div>
        {rows([
          ["Rejected before the Challenger ran", run.rejectedBeforeChallenger, run.attempts],
          ["Disputed by the Challenger's counter-tests", run.challengerDisputes, run.attempts],
          ["Original finding still reproduced after the patch", run.stillReproduced, run.attempts],
          ["Verified: tests pass, finding gone, Challenger agrees", run.verified, run.attempts],
          ["Verified patches merged by a person", run.merged, run.verified],
        ])}
        {rows(
          (Object.entries(run.stageSeconds) as [string, number][]).map(([stage, seconds]) => [
            `Time in ${stage}`,
            seconds,
            Object.values(run.stageSeconds).reduce((a, b) => a + b, 0),
            `${seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`}`,
          ]),
        )}
      </section>

      <section className="panel">
        <div className="card__tab">
          <span>benchmarks · public vulnerable apps</span>
          <span>{pct(benchReproduced, benchFound)} reproduced in the sandbox</span>
        </div>
        {benchmarks.map((b) => (
          <div key={b.repo} className="receipt__row res__row">
            <span>
              {b.repo}
              <span className="res__how">
                {b.files !== null && `${n(b.files)} files · `}
                {b.reproduced === null ? `${n(b.findings)} findings detected · reproduction hit the 15-minute cap` : `${n(b.findings)} findings · ${b.seconds}s`}
              </span>
            </span>
            <span className="receipt__v">{b.reproduced === null ? "n/a" : pct(b.reproduced, b.findings)}</span>
          </div>
        ))}
      </section>

      <p className="res__note">
        {run.note} Savings are estimates: avoided repair sessions and reviews multiplied by this run's measured tokens per repair attempt and per review.
        Static findings are reproduced by re-running their rule in the sandbox, so near-100% reproduction on these apps is expected.
      </p>
    </div>
  );
}

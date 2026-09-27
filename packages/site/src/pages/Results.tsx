import { RESULTS } from "../results.ts";

const n = (value: number) => value.toLocaleString("en-US");
const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

export function Results() {
  const { run, tokens, saved, benchmarks } = RESULTS;
  const savedTotal = saved.grouping.tokens + saved.gate.tokens;
  return (
    <>
      <section className="intro">
        <span className="eyebrow">results · measured at ShellHacks 2026</span>
        <h1 className="intro__title">Real runs. Real numbers.</h1>
        <p className="res__lede">Every figure below comes from Repro's own run store and logs. No model wrote any of them.</p>
      </section>

      <section className="res__grid">
        {[
          [n(run.findings), "findings found and reproduced", "0 model tokens"],
          [`${run.findings} → ${run.diagnoses}`, "findings grouped into root causes", `${pct(run.findings - run.diagnoses, run.findings)} fewer repair sessions`],
          [n(savedTotal), "tokens saved (estimate)", "grouping + early rejection"],
          [pct(tokens.cached, tokens.input), "of input tokens from cache", `${n(tokens.cached)} tokens`],
          [String(run.rejected), "bad patches blocked", `${run.regressionsCaught} regressions caught`],
          [String(run.verified), "fixes verified and merged", "tests pass · finding gone · Challenger agrees"],
        ].map(([big, label, sub]) => (
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
          <span>{n(savedTotal)} tokens</span>
        </div>
        {Object.values(saved).map((s) => (
          <div key={s.label} className="receipt__row res__row">
            <span>
              {s.label}
              <span className="res__how">{s.how}</span>
            </span>
            <span className="receipt__v">{s.tokens === 0 ? "0 spent" : n(s.tokens)}</span>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="card__tab">
          <span>where the tokens went · {run.target}</span>
          <span>{n(tokens.total)} tokens · {tokens.requests} requests</span>
        </div>
        <div className="res__bar" aria-label="Tokens by stage">
          {Object.entries(tokens.byRole).map(([role, value]) => (
            <span key={role} className="res__seg" data-role={role} style={{ flexGrow: value }} title={`${role}: ${n(value)}`} />
          ))}
        </div>
        {[
          ["Repair (Flash, 196 requests)", tokens.byRole.repair],
          ["Challenger (Pro, 60 requests)", tokens.byRole.challenger],
          ["Diagnose (Pro, 1 request for all 29 findings)", tokens.byRole.diagnose],
          ["Tokens per repair attempt", tokens.perRepairAttempt],
          ["Tokens per Challenger review", tokens.perChallenge],
          ["Tokens per verified fix", tokens.perVerifiedFix],
        ].map(([k, v]) => (
          <div key={String(k)} className="receipt__row">
            <span>{k}</span>
            <span className="receipt__v">{n(Number(v))}</span>
          </div>
        ))}
        <div className="receipt__row">
          <span>Pro-tier share of requests</span>
          <span className="receipt__v">{pct(tokens.pro, tokens.requests)}</span>
        </div>
      </section>

      <section className="panel">
        <div className="card__tab">
          <span>the gate · {run.attempts} repair attempts</span>
          <span>{run.verified} verified</span>
        </div>
        {[
          ["Rejected by deterministic checks before the Challenger ran", run.rejectedBeforeChallenger],
          ["Disputed by the Challenger's counter-tests", run.challengerDisputes],
          ["Original finding still reproduced after the patch", run.stillReproduced],
          ["New findings (regressions) caught on patched code", run.regressionsCaught],
          ["Verified, then merged by a person", run.merged],
        ].map(([k, v]) => (
          <div key={String(k)} className="receipt__row">
            <span>{k}</span>
            <span className="receipt__v">{v}</span>
          </div>
        ))}
        <div className="receipt__row">
          <span>Time per stage</span>
          <span className="receipt__v">
            ingest {run.stageSeconds.ingest}s · detect {run.stageSeconds.detect}s · diagnose {Math.round(run.stageSeconds.diagnose / 60)}m · repair {Math.round(run.stageSeconds.repair / 60)}m
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="card__tab">
          <span>benchmarks · public vulnerable apps</span>
          <span>detect + reproduce, no model</span>
        </div>
        {benchmarks.map((b) => (
          <div key={b.repo} className="receipt__row">
            <span>
              {b.repo} <span className="res__how">{b.files} files</span>
            </span>
            <span className="receipt__v">
              {b.reproduced === null ? `${n(b.findings)} found · reproducing…` : `${n(b.reproduced)}/${n(b.findings)} reproduced · ${b.seconds}s`}
            </span>
          </div>
        ))}
      </section>

      <p className="res__note">{run.note} Estimates multiply measured per-attempt averages from this run; they're labelled as such.</p>
    </>
  );
}

import type { SieveStep } from "../lib/sieve.ts";

/**
 * The run's findings poured through each gate. Each bar starts at the previous gate's height and
 * settles to its own; the dashed ghost above it is what that gate filtered out.
 */
export function Sieve({ steps, settled }: { steps: SieveStep[]; settled: boolean }) {
  const found = steps[0]?.count ?? 0;
  if (found === 0) {
    return <p className="boxed">No findings yet. This fills in as soon as detection reports.</p>;
  }
  const max = Math.max(1, found);
  const pct = (n: number) => `${(n / max) * 100}%`;

  return (
    <section className="sieve" aria-label="The sieve">
      <div className="sieve__chart">
        {steps.map((step, i) => {
          const prev = steps[i - 1]?.count ?? step.count;
          return (
            <div key={step.key} className="sieve__col">
              <span className="sieve__ghost" style={{ height: pct(prev) }} />
              <span className="sieve__n">{step.count}</span>
              <span
                className="sieve__bar"
                data-merged={step.key === "merged" || undefined}
                style={{ height: pct(settled ? step.count : prev), transitionDelay: `${i * 90}ms` }}
              />
            </div>
          );
        })}
      </div>
      <div className="sieve__labels">
        {steps.map((step, i) => {
          const before = steps[i - 1];
          const drop = before ? before.count - step.count : null;
          return (
            <div key={step.key} className="sieve__label">
              <span className="sieve__name">{step.label}</span>
              <span className="sieve__drop" data-zero={drop === 0 || drop === null || undefined}>
                {drop === null ? "all" : `−${drop}`}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

import { useEffect } from "react";
import { CLI, DOC_NAV, DOC_STEPS } from "../content.ts";

export function Docs() {
  // Arriving on a section link (#scan, #cli, …) lands on that section.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (DOC_NAV.some((n) => n.id === id)) document.getElementById(id)?.scrollIntoView();
  }, []);

  return (
    <section className="docs">
      <nav className="docs__nav panel" aria-label="Docs">
        <div className="panel__tab">docs/</div>
        <div className="docs__links">
          {DOC_NAV.map((n) => (
            <a key={n.id} className="docs__link" href={`#${n.id}`}>
              {n.label}
            </a>
          ))}
        </div>
      </nav>

      <article className="docs__body">
        <div className="docs__head">
          <span className="eyebrow">quickstart · 5 minutes</span>
          <h1 className="intro__title">From clone to proof.</h1>
        </div>

        {DOC_STEPS.map((s) => (
          <div key={s.id} id={s.id} className="step">
            <h2 className="step__title">
              <span className="step__n">{s.n}</span>
              {s.t}
            </h2>
            <p className="step__p">{s.p}</p>
            <div className="step__code">{s.code}</div>
          </div>
        ))}

        <div id="cli" className="step">
          <h2 className="step__title">CLI reference</h2>
          <div className="panel">
            {CLI.map((c) => (
              <div key={c.cmd} className="cli__row">
                <code className="cli__cmd">{c.cmd}</code>
                <span className="cli__d">{c.d}</span>
              </div>
            ))}
          </div>
        </div>
      </article>
    </section>
  );
}

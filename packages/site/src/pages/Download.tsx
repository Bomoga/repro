import { useRef } from "react";
import { DOWNLOADS, GITHUB_URL, INSTALL_COMMAND, REQUIREMENTS, type DownloadOption } from "../content.ts";
import { useCopy } from "../lib.ts";

function DownloadCard({ option }: { option: DownloadOption }) {
  const [copied, copy] = useCopy(INSTALL_COMMAND);
  const code = useRef<HTMLDivElement>(null);

  const cta =
    option.action === "copy" ? (
      <button type="button" className="card__cta" onClick={() => copy(code.current)}>
        {copied ? "Copied ✓" : option.cta}
      </button>
    ) : option.action === "github" ? (
      <button type="button" className="card__cta" onClick={() => window.open(GITHUB_URL, "_blank", "noopener")}>
        {option.cta}
      </button>
    ) : (
      <a className="card__cta" href={`${GITHUB_URL}/releases`}>
        {option.cta}
      </a>
    );

  return (
    <div className="card">
      <div className="card__tab">
        <span>{option.file}</span>
        <span>{option.tag}</span>
      </div>
      <div className="card__body">
        <span className="card__name">{option.name}</span>
        <span className="card__desc">{option.desc}</span>
        <div className="card__code" ref={code}>
          {option.code}
        </div>
        {cta}
        <span className="card__meta">{option.meta}</span>
      </div>
    </div>
  );
}

export function Download() {
  return (
    <>
      <section className="intro">
        <span className="eyebrow">download · v0.1.0 · MIT</span>
        <h1 className="intro__title intro__title--download">Get Repro.</h1>
        <p className="intro__lede">Free and open source. Runs on your machine; your code never leaves it. Needs Docker for the sandbox.</p>
      </section>

      <section className="downloads">
        {DOWNLOADS.map((option) => (
          <DownloadCard key={option.file} option={option} />
        ))}
      </section>

      <section className="panel">
        <div className="panel__tab">requirements.txt</div>
        <div className="cells">
          {REQUIREMENTS.map((r) => (
            <div key={r.k} className="cell">
              <span className="cell__k">{r.k}</span>
              <span className="cell__v">{r.v}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

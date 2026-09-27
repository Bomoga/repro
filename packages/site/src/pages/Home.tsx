import { useRef } from "react";
import { INSTALL_COMMAND, type Page } from "../content.ts";
import { useCopy } from "../lib.ts";

export function Home({ go }: { go: (page: Page) => void }) {
  const [copied, copy] = useCopy(INSTALL_COMMAND);
  const code = useRef<HTMLElement>(null);

  return (
    <>
      <section className="hero">
        <h1 className="hero__title">Proof, not promises.</h1>
        <p className="hero__lede">Repro reproduces every scanner warning in a sandbox and fixes only what it proves. You merge.</p>
        <div className="cmd">
          <code ref={code} className="cmd__code">
            $ {INSTALL_COMMAND}
          </code>
          <button type="button" className="cmd__copy" onClick={() => copy(code.current)}>
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </section>

      <section className="stat">
        <div className="stat__row">
          <span className="stat__item">
            <span className="stat__num">29</span>
            <span className="stat__label">findings reproduced</span>
          </span>
          <span className="stat__arrow" aria-hidden="true">
            →
          </span>
          <span className="stat__item">
            <span className="stat__num stat__num--real">15</span>
            <span className="stat__label">root causes to fix</span>
          </span>
        </div>
        <p className="stat__stages">Ingest → Detect → Diagnose → Repair → Verify</p>
      </section>

      <section className="proof">
        <h2 className="proof__title">Same command. Before and after.</h2>
        <div className="proof__grid">
          <div className="proof__card">
            <span className="proof__verdict proof__verdict--before">! Reproduces</span>
            <span className="proof__log">
              $ npm run repro:login-sqli
              <br />← 200 OK · exit 0
            </span>
          </div>
          <div className="proof__card">
            <span className="proof__verdict proof__verdict--after">✓ No longer reproduces</span>
            <span className="proof__log">
              $ npm run repro:login-sqli
              <br />← 401 Unauthorized · exit 1
            </span>
          </div>
        </div>
      </section>

      <section className="cta">
        <h2 className="cta__title">Point it at the scary repo.</h2>
        <button type="button" className="btn-solid cta__btn" onClick={() => go("download")}>
          Download Repro
        </button>
      </section>
    </>
  );
}

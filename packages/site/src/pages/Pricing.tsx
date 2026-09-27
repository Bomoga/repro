import { GITHUB_URL, RECEIPT, type Page } from "../content.ts";

export function Pricing({ go }: { go: (page: Page) => void }) {
  return (
    <section className="pricing">
      <div className="pricing__pitch">
        <span className="eyebrow">pricing</span>
        <h1 className="pricing__price">$0.</h1>
        <p className="pricing__lede">Free forever. Source on GitHub. No account, no seats, no telemetry.</p>
        <div className="pricing__actions">
          <button type="button" className="btn-solid btn-solid--sm" onClick={() => go("download")}>
            Download ↓
          </button>
          <a className="btn-line" href={GITHUB_URL}>
            Source on GitHub ↗
          </a>
        </div>
      </div>

      <div className="panel">
        <div className="card__tab">
          <span>receipt.txt</span>
          <span>what you actually pay</span>
        </div>
        {RECEIPT.map((r) => (
          <div key={r.k} className="receipt__row">
            <span>{r.k}</span>
            <span className="receipt__v">{r.v}</span>
          </div>
        ))}
        <div className="receipt__note">Model calls use your own key: Gemini by default, or any model through the MCP server. Tokens measured on the ShellHacks run of Bomoga/repro-demo.</div>
      </div>
    </section>
  );
}

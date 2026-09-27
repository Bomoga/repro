import { useRef, useState } from "react";
import { CHECKSUMS, GITHUB_URL, INSTALL_COMMAND, PLATFORMS, RELEASE_URL, REQUIREMENTS, VERSION, type Os } from "../content.ts";
import { useCopy } from "../lib.ts";

const ORDER: Os[] = ["linux", "mac", "windows"];

// The visitor's OS, from the client hints where the browser has them, else the user agent.
function detectOs(): Os {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const hint = `${nav.userAgentData?.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (hint.includes("win")) return "windows";
  if (hint.includes("mac") || hint.includes("iphone") || hint.includes("ipad")) return "mac";
  return "linux";
}

export function Download() {
  const [detected] = useState(detectOs);
  const [os, setOs] = useState<Os>(detected);
  const [copied, copy] = useCopy(INSTALL_COMMAND);
  const command = useRef<HTMLDivElement>(null);
  const platform = PLATFORMS[os];

  return (
    <div className="dl">
      <section className="intro">
        <span className="eyebrow">download · v{VERSION}</span>
        <h1 className="intro__title intro__title--download">Get Repro.</h1>
        <p className="intro__lede">Free. Runs on your machine; your code never leaves it. Needs Docker for the sandbox.</p>
      </section>

      <section className="dl__os" role="tablist" aria-label="Operating system">
        {ORDER.map((o) => (
          <button key={o} type="button" role="tab" aria-selected={o === os} className="dl__tab" onClick={() => setOs(o)}>
            {PLATFORMS[o].name}
            {o === detected && <span className="dl__you">your system</span>}
          </button>
        ))}
      </section>

      <section className="downloads">
        <div className="card">
          <div className="card__tab">
            <span>install.sh</span>
            <span>{os === "windows" ? "in WSL" : "recommended"}</span>
          </div>
          <div className="card__body">
            <span className="card__name">Install command</span>
            <span className="card__desc">
              {os === "windows"
                ? "The full app: desktop window, control plane and sandbox. Run it in WSL."
                : "The full app: the Repro desktop app, the control plane, the sandbox and the repro command. Opens Repro when it's done."}
            </span>
            <div className="card__code" ref={command}>
              $ {INSTALL_COMMAND}
            </div>
            <button type="button" className="card__cta" onClick={() => copy(command.current)}>
              {copied ? "Copied ✓" : "Copy install command"}
            </button>
            <span className="card__meta">
              Needs git, Node 20.6+ and Docker · <a href="/install">read the script</a>
            </span>
          </div>
        </div>

        <div className="card">
          <div className="card__tab">
            <span>{platform.primary.file}</span>
            <span>{platform.name}</span>
          </div>
          <div className="card__body">
            <span className="card__name">{os === "linux" ? "Desktop app" : `${platform.name} download`}</span>
            <span className="card__desc">{platform.pitch}</span>
            <div className="card__code">{platform.steps}</div>
            <a className="card__cta" href={platform.primary.href}>
              {platform.primary.label} ↓ <span className="dl__size">{platform.primary.size}</span>
            </a>
            <span className="dl__also">
              {platform.also.map((f) => (
                <a key={f.file} className="btn-line dl__alt" href={f.href}>
                  {f.label} <span className="dl__size">{f.size}</span>
                </a>
              ))}
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="card__tab">
          <span>all files · v{VERSION}</span>
          <a href={RELEASE_URL}>release notes ↗</a>
        </div>
        {ORDER.flatMap((o) => [PLATFORMS[o].primary, ...PLATFORMS[o].also].map((f) => ({ ...f, os: PLATFORMS[o].name })))
          .concat([{ ...CHECKSUMS, os: "all" }])
          .map((f) => (
            <a key={f.file} className="receipt__row dl__row" href={f.href}>
              <span>
                {f.file}
                <span className="res__how">{f.os}</span>
              </span>
              <span className="receipt__v">{f.size} ↓</span>
            </a>
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
        <div className="card__meta dl__src">
          Or build from source: <a href={GITHUB_URL}>{GITHUB_URL.replace("https://", "")}</a>
        </div>
      </section>
    </div>
  );
}

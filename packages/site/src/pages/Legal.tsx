import { GITHUB_URL } from "../content.ts";

const SECTIONS: [string, string[]][] = [
  [
    "Terms of use",
    [
      "Repro is provided as is, without warranty of any kind, express or implied, including fitness for a particular purpose. Use it at your own risk.",
      "Only scan code you own or are authorized to test. You are responsible for how you use Repro and for any patch you merge.",
      "Patches are generated automatically. Repro verifies them in a sandbox, but a verified patch can still be wrong: review every change before merging it.",
      "Model calls run under your own Google account or API key and are subject to that provider's terms and pricing.",
    ],
  ],
  [
    "Privacy",
    [
      "This website sets no cookies and runs no analytics or tracking. It may remember your theme choice in your browser's local storage.",
      "The site is hosted on Vercel, which processes standard request logs (such as IP address and time of request) to serve and protect it.",
      "The Repro app runs on your own machine. Your code stays there, except for the excerpts sent to the model provider you configure (Google Gemini by default) and, if you choose GitHub pull requests, the patches sent to GitHub.",
      "Google sign-in in the app is used only to call the model on your behalf; the credentials are stored locally on your machine.",
    ],
  ],
  [
    "Trademarks",
    ["Semgrep, gitleaks, Docker, Google, Gemini and GitHub are trademarks of their respective owners. Repro is not affiliated with or endorsed by them."],
  ],
  [
    "Contact",
    [
      "Repro was built at ShellHacks 2026 by Alexander Gese, Adrian Morton and Brandon Delgado.",
      `For questions, legal notices or security reports, open an issue at ${GITHUB_URL.replace("https://", "")}.`,
    ],
  ],
];

export function Legal() {
  return (
    <div className="res">
      <section className="intro">
        <span className="eyebrow">legal · last updated Sep 27, 2026</span>
        <h1 className="intro__title">Legal.</h1>
      </section>
      {SECTIONS.map(([title, paragraphs]) => (
        <section key={title} className="panel">
          <div className="panel__tab">{title}</div>
          <div className="rep__body legal__body">
            {paragraphs.map((p) => (
              <p key={p} className="rep__p">
                {p}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// Every word on the site, copied from the design handoff (Repro Site.dc.html).

export const INSTALL_COMMAND = "curl -fsSL repro.sh/install | sh";

export const DASHBOARD_URL = (import.meta.env.VITE_DASHBOARD_URL ?? "http://localhost:5173").replace(/\/$/, "");
export const GITHUB_URL = import.meta.env.VITE_GITHUB_URL ?? "https://github.com/Bomoga/repro";

/** "Sample report" is a real finished run in the dashboard, opened on its Report tab. */
export const SAMPLE_REPORT_URL = `${DASHBOARD_URL}/#/overview/run_demo_completed/report`;

export const PAGES = ["home", "download", "docs", "pricing", "faq", "credits"] as const;
export type Page = (typeof PAGES)[number];

export const NAV: { label: string; page?: Page; href?: string }[] = [
  { label: "Docs", page: "docs" },
  { label: "Sample report", href: SAMPLE_REPORT_URL },
  { label: "Pricing", page: "pricing" },
  { label: "FAQ", page: "faq" },
  { label: "Credits", page: "credits" },
];

export const PAGE_TITLE: Record<Page, string> = {
  home: "Repro · Proof, not promises.",
  download: "Get Repro",
  docs: "Repro docs · Quickstart",
  pricing: "Repro pricing",
  faq: "Repro FAQ",
  credits: "Repro credits",
};

export interface DownloadOption {
  file: string;
  tag: string;
  name: string;
  desc: string;
  code: string;
  cta: string;
  action: "copy" | "none" | "github";
  meta: string;
}

export const DOWNLOADS: DownloadOption[] = [
  {
    file: "install.sh",
    tag: "recommended",
    name: "curl script",
    desc: "One line. Installs the CLI to ~/.repro/bin.",
    code: "$ curl -fsSL repro.sh/install | sh\n$ repro --version\nrepro 0.9.2",
    cta: "Copy install command",
    action: "copy",
    meta: "sha256 9f2c…e41a · signed",
  },
  {
    file: "Repro-0.9.2.dmg",
    tag: "macOS 13+",
    name: "macOS app",
    desc: "The live run view as a native app. CLI included.",
    code: "Apple Silicon · 48 MB\nIntel · 51 MB",
    cta: "Download .dmg ↓",
    action: "none",
    meta: "notarized · sha256 3b71…0cd2",
  },
  {
    file: "README.md",
    tag: "source",
    name: "Build from source",
    desc: "Node 20 and Docker. Takes about two minutes.",
    code: "$ git clone github.com/repro-sh/repro\n$ cd repro && npm ci\n$ npm run build && npm link",
    cta: "Open on GitHub ↗",
    action: "github",
    meta: "MIT licensed",
  },
];

export const REQUIREMENTS = [
  { k: "OS", v: "macOS 13+ · Linux" },
  { k: "Sandbox", v: "Docker 24+" },
  { k: "Runtime", v: "Node 20+" },
  { k: "Model", v: "your API key" },
];

export const DOC_NAV = [
  { id: "install", label: "01 Install" },
  { id: "scan", label: "02 Scan" },
  { id: "proof", label: "03 Read the proof" },
  { id: "merge", label: "04 Merge on GitHub" },
  { id: "config", label: "05 Config" },
  { id: "cli", label: "CLI reference" },
];

export const DOC_STEPS = [
  { id: "install", n: "01", t: "Install", p: "Grab the CLI. Make sure Docker is running.", code: "$ curl -fsSL repro.sh/install | sh" },
  {
    id: "scan",
    n: "02",
    t: "Scan",
    p: "Point it at a local path or a GitHub repo. That’s the only input.",
    code: "$ repro scan ./inherited-service\n$ repro scan owner/repo",
  },
  {
    id: "proof",
    n: "03",
    t: "Read the proof",
    p: "Each finding shows the reproduction command, its output before and after the patch, test results, and the challenger’s verdict.",
    code: "$ repro show sqli-login\n✓ Fixed and verified · attempt 2 · PR #14",
  },
  {
    id: "merge",
    n: "04",
    t: "Merge on GitHub",
    p: "Repro opens a PR with the proof in its body. Review it and merge it yourself.",
    code: "$ repro prs\n#11 #12 #13 #14  open · awaiting review",
  },
  { id: "config", n: "05", t: "Config", p: "Turn plugins on or off in repro.toml.", code: "[plugins]\nsemgrep  = true\ngitleaks = true\njudge    = false" },
];

export const CLI = [
  { cmd: "repro scan <target>", d: "Run all five stages against a path or repo." },
  { cmd: "repro show <finding>", d: "Print a finding’s full journey and proof." },
  { cmd: "repro report", d: "Write a static run report (HTML, no external assets)." },
  { cmd: "repro report --all", d: "Totals across every run on this machine." },
  { cmd: "repro prs", d: "List the pull requests Repro opened." },
];

export const RECEIPT = [
  { k: "Repro", v: "$0" },
  { k: "Semgrep, gitleaks", v: "$0" },
  { k: "Sandbox (your Docker)", v: "$0" },
  { k: "Model tokens / verified fix", v: "≈ $0.19" },
  { k: "Seats, accounts, telemetry", v: "none" },
];

export const FAQ: [string, string][] = [
  ["Is this a chatbot?", "No. There is no chat box anywhere. You give it a target, flip plugins on or off, and read the proof."],
  ["Does Repro merge anything?", "Never. It opens pull requests with before-and-after proof. A person reads the proof and merges on GitHub."],
  [
    "What counts as \"reproduced\"?",
    "A reproduction command runs in the sandbox and demonstrates the bug, with the exit code recorded. If the command fails to show it, the warning is discarded as unconfirmed.",
  ],
  [
    "Why a second AI?",
    "The challenger model tries to break every fix: weakened tests, out-of-scope edits, patches that only mask the symptom. A rejected patch goes back to Repair.",
  ],
  [
    "Does my code leave my machine?",
    "Scanning and reproduction run locally in Docker with the network off. Only the proven findings and their evidence go to the model API you configure.",
  ],
  ["What about secrets it finds?", "They are redacted everywhere: in the app, reports and PRs. Only the last four characters are shown."],
  ["What languages work?", "Anything Semgrep and gitleaks cover. Reproduction templates currently ship for TypeScript, JavaScript and Python."],
  ["What if a number isn’t known?", "It says \"not measured\". Repro never shows a zero or an estimate in place of missing data."],
];

export const TEAM = [
  { n: "01", handle: "@alex.ingest", name: "Alex Moreno", role: "Pipeline + sandbox" },
  { n: "02", handle: "@priya.detect", name: "Priya Nair", role: "Scanners + reproduction" },
  { n: "03", handle: "@sam.verify", name: "Sam Okafor", role: "Repair + challenger" },
  { n: "04", handle: "@jules.ui", name: "Jules Brandt", role: "Interface + reports" },
];

export const OSS = [
  { n: "Semgrep", d: "static analysis" },
  { n: "gitleaks", d: "secret scanning" },
  { n: "Docker", d: "sandbox" },
  { n: "VT323", d: "typeface" },
];

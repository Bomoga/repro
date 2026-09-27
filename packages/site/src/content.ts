import { TOKENS_SAVED_PCT } from "./results.ts";
// Every word on the site, copied from the design handoff (Repro Site.dc.html).

export const INSTALL_COMMAND = "curl -fsSL repro.miami/install | sh";

export const DASHBOARD_URL = (import.meta.env.VITE_DASHBOARD_URL ?? "http://localhost:5173").replace(/\/$/, "");
export const GITHUB_URL = import.meta.env.VITE_GITHUB_URL ?? "https://github.com/Bomoga/repro";

/** "Sample report" is a real finished run in the dashboard, opened on its Report tab. */
export const SAMPLE_REPORT_URL = `${DASHBOARD_URL}/#/overview/run_demo_completed/report`;

export const PAGES = ["home", "download", "docs", "results", "pricing", "faq", "credits"] as const;
export type Page = (typeof PAGES)[number];

export const NAV: { label: string; page?: Page; href?: string }[] = [
  { label: "Docs", page: "docs" },
  { label: "Results", page: "results" },
  { label: "Sample report", href: SAMPLE_REPORT_URL },
  { label: "Pricing", page: "pricing" },
  { label: "FAQ", page: "faq" },
  { label: "Credits", page: "credits" },
];

export const PAGE_TITLE: Record<Page, string> = {
  home: "Repro · Proof, not promises.",
  download: "Get Repro",
  docs: "Repro docs · Quickstart",
  results: "Repro results · ShellHacks 2026",
  pricing: "Repro pricing",
  faq: "Repro FAQ",
  credits: "Repro credits",
};

export const VERSION = "0.1.0";
export const RELEASE_URL = `${GITHUB_URL}/releases/tag/v${VERSION}`;
const asset = (file: string) => `${GITHUB_URL}/releases/download/v${VERSION}/${file}`;

export type Os = "linux" | "mac" | "windows";

export interface ReleaseFile {
  label: string;
  file: string;
  size: string;
  href: string;
}

export interface Platform {
  os: Os;
  name: string;
  /** What the recommended path installs, in one line. */
  pitch: string;
  primary: ReleaseFile;
  also: ReleaseFile[];
  /** Shown under the buttons: how to run it once downloaded. */
  steps: string;
}

const file = (label: string, name: string, size: string): ReleaseFile => ({ label, file: name, size, href: asset(name) });

export const PLATFORMS: Record<Os, Platform> = {
  linux: {
    os: "linux",
    name: "Linux",
    pitch: "The Repro desktop app and the repro command. Repro shows up in your app menu.",
    primary: file("Download .deb", `repro_${VERSION}_amd64.deb`, "37 MB"),
    also: [file(".rpm", `repro-${VERSION}-1.x86_64.rpm`, "30 MB"), file("CLI x64 .tar.gz", `repro-${VERSION}-linux-x64.tar.gz`, "37 MB"), file("CLI arm64", `repro-${VERSION}-linux-arm64`, "81 MB")],
    steps: `$ sudo apt install ./repro_${VERSION}_amd64.deb\n$ repro app        # or open Repro from the app menu`,
  },
  mac: {
    os: "mac",
    name: "macOS",
    pitch: "The install command puts Repro.app in ~/Applications and the repro command on your PATH.",
    primary: file("CLI · Apple Silicon", `repro-${VERSION}-macos-arm64.tar.gz`, "26 MB"),
    also: [file("CLI · Intel", `repro-${VERSION}-macos-x64.tar.gz`, "29 MB")],
    steps: "$ tar xzf repro-*-macos-*.tar.gz\n$ xattr -d com.apple.quarantine repro   # unsigned build\n$ ./repro status",
  },
  windows: {
    os: "windows",
    name: "Windows",
    pitch: "The repro command for Windows. For the full desktop app, run the install command in WSL.",
    primary: file("Download .exe", `repro-${VERSION}-windows-x64.exe`, "86 MB"),
    also: [file(".zip", `repro-${VERSION}-windows-x64.zip`, "40 MB")],
    steps: "> set REPRO_API_URL=http://localhost:4000\n> repro-0.1.0-windows-x64.exe status",
  },
};

export const CHECKSUMS = { label: "SHA256SUMS", file: "SHA256SUMS", size: "1 KB", href: asset("SHA256SUMS") };

export const REQUIREMENTS = [
  { k: "OS", v: "Linux · macOS · Windows (WSL)" },
  { k: "Sandbox", v: "Docker 24+" },
  { k: "Runtime", v: "Node 20.6+ · git" },
  { k: "Model", v: "Google sign-in or your API key" },
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
  { id: "install", n: "01", t: "Install", p: "Grab the CLI. Make sure Docker is running.", code: "$ curl -fsSL repro.miami/install | sh" },
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
  { k: "Tokens vs. fixing every finding separately", v: `−${TOKENS_SAVED_PCT}%` },
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
  { n: "01", handle: "@AlexanderGese", photo: "/team/alexander-gese.jpg", name: "Alexander Gese", role: "Orchestrator, run store + dashboard" },
  { n: "02", handle: "@brandondelgadoo", photo: "/team/brandon-delgado.jpg", name: "Brandon Delgado", role: "Scanners + sandbox reproduction" },
  { n: "03", handle: "@Bomoga", photo: "/team/adrian-morton.jpg", name: "Adrian Morton", role: "Diagnosis, repair + challenger" },
];

export const OSS = [
  { n: "Semgrep", d: "static analysis" },
  { n: "gitleaks", d: "secret scanning" },
  { n: "Docker", d: "sandbox" },
  { n: "VT323", d: "typeface" },
];

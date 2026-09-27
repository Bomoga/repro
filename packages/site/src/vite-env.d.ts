/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where "Sample report" sends people: a running Repro dashboard. */
  readonly VITE_DASHBOARD_URL?: string;
  /** The source repository behind "GitHub" and "Source on GitHub". */
  readonly VITE_GITHUB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

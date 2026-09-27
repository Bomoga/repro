import { useState } from "react";
import type { PullRequestMode } from "@repro/api";
import { api } from "../api.ts";
import { usePoll } from "../lib/poll.ts";

const OPTIONS: { mode: PullRequestMode; label: string; tip: string }[] = [
  { mode: "auto", label: "Auto", tip: "A GitHub PR when your token can push to the repo, a local branch otherwise" },
  { mode: "github", label: "GitHub PRs", tip: "Always open a GitHub PR (needs REPRO_GITHUB_TOKEN)" },
  { mode: "local", label: "Local only", tip: "Never touch GitHub: each verified patch becomes a commit on repro/<patch> under ~/.repro/local-branches" },
];

/** Where the control plane sends verified patches, switchable while it runs. */
export function FixDestination({ onError }: { onError: (message: string) => void }) {
  const settings = usePoll(api.settings, 10_000, "settings");
  const [saving, setSaving] = useState(false);
  const current = settings.data?.pullRequestMode;
  if (!current) return null;

  const choose = async (mode: PullRequestMode) => {
    if (mode === current || saving) return;
    setSaving(true);
    try {
      await api.setPullRequestMode(mode);
      await settings.refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dest" role="group" aria-label="Where verified fixes go">
      <span className="dest__label">FIXES GO TO</span>
      {OPTIONS.map((option) => (
        <button key={option.mode} type="button" className="chip" aria-pressed={current === option.mode} title={option.tip} disabled={saving} onClick={() => choose(option.mode)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

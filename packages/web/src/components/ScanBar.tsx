import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Run } from "@repro/contracts";
import { api } from "../api.ts";

const GITHUB_REF = /^[\w.-]+\/[\w.-]+(#.+)?$/;
const GITHUB_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/;

// The dashboard's one free-text input (section 8): a target ref to queue a Run. Nothing typed
// here is ever read by a model.
export function ScanBar({
  onQueued,
  onRefused,
  focusSignal,
  onFocused,
}: {
  onQueued: (run: Run) => void;
  onRefused: (ref: string) => void;
  /** Non-zero asks for focus once; onFocused hands the request back so a later remount won't refocus. */
  focusSignal: number;
  onFocused: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSignal === 0) return;
    input.current?.focus();
    onFocused();
  }, [focusSignal, onFocused]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ref = value.trim();
    if (!ref || busy) return;
    if (!ref.startsWith("/") && !GITHUB_REF.test(ref) && !GITHUB_URL.test(ref)) {
      setError(`Not a GitHub ref (expected owner/repo, owner/repo#rev, or https://github.com/owner/repo): ${ref}`);
      onRefused(ref);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const run = await api.createRun(ref);
      setValue("");
      onQueued(run);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onRefused(ref);
    } finally {
      setBusy(false);
    }
  };

  const empty = !value.trim();
  return (
    <form className="scan" onSubmit={submit} noValidate aria-label="Scan a repository">
      <label htmlFor="rp-scan" className="scan__label">
        SCAN
      </label>
      <div className="scan__field" data-error={error ? "" : undefined}>
        <div className="scan__input-wrap">
          <input
            id="rp-scan"
            ref={input}
            className="scan__input"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(undefined);
            }}
            placeholder="owner/repo, a GitHub URL, or /absolute/path"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby="rp-scan-helper"
          />
          {!value && (
            <kbd className="scan__kbd" aria-hidden="true">
              /
            </kbd>
          )}
        </div>
        <button type="submit" className="scan__btn" disabled={empty || busy}>
          {busy ? "Queuing…" : "Scan"}
        </button>
      </div>
      <span id="rp-scan-helper" role="status" className="scan__helper">
        {error ? `✕ ${error}` : ""}
      </span>
    </form>
  );
}

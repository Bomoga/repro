import { AnimatePresence, MotionConfig } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import type { Patch, Run } from "@repro/contracts";
import type { PatchDecision } from "@repro/api";
import { API_UNREACHABLE, api } from "./api.ts";
import { usePoll } from "./lib/poll.ts";
import { useReviewQueue } from "./lib/review.ts";
import { useRoute } from "./lib/route.ts";
import { useTheme } from "./lib/theme.ts";
import { Overview } from "./components/Overview.tsx";
import { ReviewQueue } from "./components/ReviewQueue.tsx";
import { RunSheet } from "./components/RunSheet.tsx";
import { RunsList } from "./components/RunsList.tsx";
import { GoogleAccount } from "./components/GoogleAccount.tsx";
import { ServerStatus, serverState } from "./components/ServerStatus.tsx";
import { Toasts, useToasts } from "./components/Toasts.tsx";
import { MainTabs } from "./components/UnderlineTabs.tsx";

// Section 8: the only inputs are a target ref (to start a Run) and merge/reject on a Patch.
// No chat surface, no free-form prompt box anywhere on this page.
export function App() {
  const theme = useTheme();
  const [route, navigate] = useRoute();
  const summaries = usePoll(api.summaries, 4000, "summaries");
  const health = usePoll(api.health, 10_000, "health");
  const google = usePoll(api.googleAccount, 15_000, "google");
  const review = useReviewQueue(summaries.data);
  const [toasts, toast] = useToasts();
  const [logoKey, setLogoKey] = useState(0);
  const [scanFocus, setScanFocus] = useState(0);

  const refreshSummaries = summaries.refresh;
  const refreshReview = review.refresh;
  const server = summaries.error === API_UNREACHABLE ? "offline" : serverState(health);
  const offline = server === "offline";

  const focusScan = useCallback(() => {
    navigate({ tab: "overview" });
    setScanFocus((n) => n + 1);
  }, [navigate]);

  // "/" jumps to the scan box from anywhere outside a text field, closing an open run first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      focusScan();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusScan]);

  const onScanFocused = useCallback(() => setScanFocus(0), []);

  const onQueued = useCallback(
    (run: Run) => {
      toast(`Scan queued: ${run.target.ref.replace(/^https:\/\/github\.com\//, "")}`);
      setLogoKey((n) => n + 1);
      void refreshSummaries();
    },
    [toast, refreshSummaries],
  );

  const onRefused = useCallback((ref: string) => toast(`Scan not queued: ${ref}`, true), [toast]);

  const onDecided = useCallback(
    (patch: Patch, decision: PatchDecision) => {
      toast(`${decision === "merge" ? "Merged" : "Rejected"} ${patch.id}`);
      void refreshSummaries();
      void refreshReview();
    },
    [toast, refreshSummaries, refreshReview],
  );

  const onError = useCallback((message: string) => toast(message, true), [toast]);

  return (
    <MotionConfig reducedMotion="user">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <div className="masthead__inner">
          <a className="brand" href="#/overview" aria-label="Repro overview">
            <img
              key={logoKey}
              className="brand__logo"
              src={theme === "dark" ? "/brand/repro-logo-dark.png" : "/brand/repro-logo-light.png"}
              alt="Repro"
              width={94}
              height={48}
            />
          </a>
          <nav className="masthead__nav" aria-label="Views">
            <MainTabs
              active={route.tab}
              onSelect={(tab) => navigate({ tab })}
              counts={summaries.data ? { runs: summaries.data.length, ...(review.data ? { review: review.data.length } : {}) } : {}}
            />
          </nav>
          <GoogleAccount status={google} />
          <ServerStatus state={server} />
        </div>
      </header>

      {offline ? (
        <div className="banner" role="alert">
          <div className="banner__inner">
            <span data-ink="fail">✕ Can't reach the Repro API.</span>
            <span>
              Start it with <code>npm run dev:api</code>. This page reconnects on its own.
            </span>
          </div>
        </div>
      ) : (
        summaries.error && (
          <div className="banner" role="alert">
            <div className="banner__inner">
              <span data-ink="fail">✕ The Repro API returned an error.</span>
              <span>{summaries.error}</span>
            </div>
          </div>
        )
      )}

      <main id="main" className="main">
        <div key={route.tab} role="tabpanel" aria-labelledby={`view-tab-${route.tab}`} className="fade">
          {route.tab === "overview" && (
            <Overview
              summaries={summaries}
              review={review}
              onQueued={onQueued}
              onRefused={onRefused}
              scanFocus={scanFocus}
              onScanFocused={onScanFocused}
              onScanLink={focusScan}
              onError={onError}
            />
          )}
          {route.tab === "runs" && <RunsList summaries={summaries} />}
          {route.tab === "review" && <ReviewQueue review={review} onDecided={onDecided} onError={onError} />}
        </div>
      </main>

      <AnimatePresence>
        {route.runId && (
          <RunSheet
            key="run"
            tab={route.tab}
            runId={route.runId}
            runTab={route.runTab}
            onClose={() => navigate({ tab: route.tab })}
            onTab={(runTab) => navigate({ ...route, runTab }, { replace: true })}
            onDecided={onDecided}
            onError={onError}
          />
        )}
      </AnimatePresence>

      <Toasts toasts={toasts} />
    </MotionConfig>
  );
}

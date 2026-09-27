import { useCallback, useEffect, useState } from "react";

// The view lives in the URL hash (#/runs/run_123/patches) so a run can be linked to, the back
// button closes the run popup, and every state can be opened directly.

export const TABS = ["overview", "runs", "review"] as const;
export type Tab = (typeof TABS)[number];

export const RUN_TABS = ["findings", "diagnoses", "patches", "report"] as const;
export type RunTab = (typeof RUN_TABS)[number];

export interface Route {
  tab: Tab;
  runId?: string;
  runTab?: RunTab;
}

function decode(part: string | undefined): string | undefined {
  if (!part) return undefined;
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

export function parseHash(hash: string): Route {
  const [tab, runId, runTab] = hash.replace(/^#\/?/, "").split("/");
  return {
    tab: (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "overview",
    runId: decode(runId),
    runTab: (RUN_TABS as readonly string[]).includes(runTab ?? "") ? (runTab as RunTab) : undefined,
  };
}

export function toHash(route: Route): string {
  let hash = `#/${route.tab}`;
  if (route.runId) {
    hash += `/${encodeURIComponent(route.runId)}`;
    if (route.runTab) hash += `/${route.runTab}`;
  }
  return hash;
}

export function useRoute(): [Route, (route: Route, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: Route, options?: { replace?: boolean }) => {
    const hash = toHash(next);
    if (options?.replace) {
      window.history.replaceState(null, "", hash);
      setRoute(parseHash(hash));
    } else if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
  }, []);

  return [route, navigate];
}

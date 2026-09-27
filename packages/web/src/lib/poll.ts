import { useCallback, useEffect, useRef, useState } from "react";

export interface Poll<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Loads `load()` now and every `intervalMs` after the previous load settles, so slow responses
 * never pile up. Changing `key` starts over with empty state; a failed refresh keeps the last
 * good data and reports the error alongside it. While `enabled` is false nothing loads and the
 * poll reports itself as loading.
 */
export function usePoll<T>(load: () => Promise<T>, intervalMs: number, key: string, enabled = true): Poll<T> {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key });
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(key);
  keyRef.current = key;

  const refresh = useCallback(async () => {
    const requestKey = keyRef.current;
    try {
      const data = await loadRef.current();
      if (keyRef.current === requestKey) setState({ key: requestKey, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (keyRef.current === requestKey) {
        setState((prev) => ({ key: requestKey, data: prev.key === requestKey ? prev.data : undefined, error: message }));
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await refresh();
      if (alive) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, intervalMs, refresh, enabled]);

  const current = state.key === key ? state : { key };
  return {
    data: current.data,
    error: current.error,
    loading: current.data === undefined && current.error === undefined,
    refresh,
  };
}

/**
 * IDs that showed up after the first batch arrived, held for `holdMs` so new rows can announce
 * themselves. The first batch never counts as new.
 */
export function useFreshIds(ids: string[] | undefined, holdMs = 2600): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const key = ids?.join("\n");

  useEffect(() => {
    if (!ids) return;
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const known = seen.current;
    const added = ids.filter((id) => !known.has(id));
    if (added.length === 0) return;
    for (const id of added) known.add(id);
    setFresh((prev) => new Set([...prev, ...added]));
    timers.current.push(
      setTimeout(() => {
        setFresh((prev) => {
          const next = new Set(prev);
          for (const id of added) next.delete(id);
          return next;
        });
      }, holdMs),
    );
  }, [key]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return fresh;
}

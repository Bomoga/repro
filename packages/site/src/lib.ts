import { useCallback, useEffect, useRef, useState } from "react";
import { DOC_NAV, PAGES, PAGE_TITLE, type Page } from "./content.ts";

function pageFromHash(): Page {
  const hash = window.location.hash.slice(1);
  if ((PAGES as readonly string[]).includes(hash)) return hash as Page;
  // A docs section link (#install, #cli, …) belongs to the docs page.
  if (DOC_NAV.some((n) => n.id === hash)) return "docs";
  return "home";
}

/** Hash routing (#download, #docs, #cli, …). Anything unknown, including an empty hash, is home. */
export function usePage(): [Page, (page: Page) => void] {
  const [page, setPage] = useState<Page>(pageFromHash);

  useEffect(() => {
    const sync = () => setPage(pageFromHash());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  useEffect(() => {
    document.title = PAGE_TITLE[page];
  }, [page]);

  const go = useCallback((next: Page) => {
    if (pageFromHash() !== next || !window.location.hash) window.history.pushState(null, "", `#${next}`);
    setPage(next);
    window.scrollTo(0, 0);
  }, []);

  return [page, go];
}

export type Theme = "light" | "dark";

/** `?theme=dark` switches the palette; light is the default. */
export function useTheme(): Theme {
  const [theme] = useState<Theme>(() => (new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return theme;
}

/**
 * Copies text to the clipboard. Where the Clipboard API is refused, selects `fallback`'s text
 * instead so the person can press Ctrl+C / ⌘C. Resolves to whether the copy happened.
 */
export async function copyText(text: string, fallback?: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallback) return false;
    const range = document.createRange();
    range.selectNodeContents(fallback);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

/** A copy action whose "copied" flag resets after 1.5 s, like the design's copy button. */
export function useCopy(text: string): [boolean, (fallback?: HTMLElement | null) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    (fallback?: HTMLElement | null) => {
      void copyText(text, fallback).then((ok) => {
        if (!ok) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      });
    },
    [text],
  );
  return [copied, copy];
}

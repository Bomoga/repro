import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { TABS, type Tab } from "../lib/route.ts";
import { Num } from "./Bits.tsx";

const LABEL: Record<Tab, string> = { overview: "Overview", runs: "Runs", review: "Review" };

/**
 * The header's view tabs. One 2px indicator slides between them, measured from the selected
 * tab's offsetLeft and offsetWidth. Roving tabindex; ←/→ move and activate.
 */
export function MainTabs({ active, counts, onSelect }: { active: Tab; counts: Partial<Record<Tab, number>>; onSelect: (tab: Tab) => void }) {
  const refs = useRef<Partial<Record<Tab, HTMLAnchorElement | null>>>({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const measure = useCallback(() => {
    const el = refs.current[active];
    if (!el) return;
    const next = { left: el.offsetLeft, width: el.offsetWidth };
    setIndicator((prev) => (prev.left === next.left && prev.width === next.width ? prev : next));
  }, [active]);

  useLayoutEffect(() => {
    measure();
  });

  useLayoutEffect(() => {
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(active) + step + TABS.length) % TABS.length];
    if (!next) return;
    onSelect(next);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label="Views" className="tabs" onKeyDown={onKeyDown}>
      {TABS.map((tab) => {
        const selected = tab === active;
        const count = counts[tab];
        return (
          <a
            key={tab}
            ref={(el) => {
              refs.current[tab] = el;
            }}
            role="tab"
            id={`view-tab-${tab}`}
            href={`#/${tab}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="tab"
            onClick={(event) => {
              event.preventDefault();
              onSelect(tab);
            }}
          >
            {LABEL[tab]}
            {count !== undefined && (
              <span className="tab__badge" data-hot={(tab === "review" && count > 0) || undefined}>
                <Num value={count} />
              </span>
            )}
          </a>
        );
      })}
      <span aria-hidden="true" className="tabs__indicator" style={{ left: indicator.left, width: indicator.width }} />
    </div>
  );
}

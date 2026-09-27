import type { ReactNode } from "react";
import type { Severity } from "@repro/contracts";
import type { TrustReport } from "@repro/api";
import { SEVERITY_CELLS, TRUST_CELLS, capitalize } from "../lib/format.ts";

/** A row of outlined cells, the first `lit` filled: the severity and trust meters. */
export function Cells({ lit, of, w, h }: { lit: number; of: number; w: number; h: number }) {
  return (
    <span className="cells" aria-hidden="true">
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className="cell" data-lit={i < lit || undefined} style={{ width: w, height: h }} />
      ))}
    </span>
  );
}

export function SeverityMeter({ level }: { level: Severity }) {
  return (
    <span className="sev">
      <Cells lit={SEVERITY_CELLS[level]} of={5} w={5} h={14} />
      {level}
    </span>
  );
}

/** "Trust ▮▮▯ Medium", with the reasons in the tooltip. `compact` drops the word "Trust". */
export function TrustMeter({ trust, compact }: { trust: TrustReport; compact?: boolean }) {
  return (
    <span className="trust" data-compact={compact || undefined} title={trust.reasons.join("\n")}>
      {!compact && <span className="trust__word">Trust</span>}
      <Cells lit={TRUST_CELLS[trust.confidence]} of={3} w={compact ? 5 : 6} h={compact ? 12 : 14} />
      {capitalize(trust.confidence)}
    </span>
  );
}

/** A polled number that crossfades when it changes instead of snapping. */
export function Num({ value }: { value: ReactNode }) {
  return (
    <span key={String(value)} className="num">
      {value}
    </span>
  );
}

/** The window frame: ink border, hard shadow, and a pinstriped title bar. */
export function Window({ title, count, children }: { title: string; count?: ReactNode; children: ReactNode }) {
  return (
    <section className="win" aria-label={title}>
      <div className="win__bar">
        <span>{title.toUpperCase()}</span>
        <span className="win__stripes" aria-hidden="true" />
        {count !== undefined && <Num value={count} />}
      </div>
      {children}
    </section>
  );
}

export function Skeleton({ height, width }: { height: number; width?: string }) {
  return <span className="skel" style={{ height, width }} aria-hidden="true" />;
}

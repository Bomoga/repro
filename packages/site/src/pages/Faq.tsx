import { useState } from "react";
import { FAQ } from "../content.ts";

export function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section className="faq">
      <span className="eyebrow">faq</span>
      <h1 className="intro__title">Straight answers.</h1>
      <div className="panel">
        {FAQ.map(([q, a], i) => {
          const isOpen = open === i;
          return (
            <div key={q} className="faq__item">
              <button
                type="button"
                className="faq__q"
                data-open={isOpen || undefined}
                aria-expanded={isOpen}
                aria-controls={`faq-${i}`}
                onClick={() => setOpen(isOpen ? -1 : i)}
              >
                <span className="faq__caret" aria-hidden="true">
                  {isOpen ? "▾" : "▸"}
                </span>
                {q}
              </button>
              {isOpen && (
                <p className="faq__a" id={`faq-${i}`}>
                  {a}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

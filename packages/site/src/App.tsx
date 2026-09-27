import { useEffect, useRef, useState, type MouseEvent } from "react";
import { GITHUB_URL, NAV, SAMPLE_REPORT_URL, type Page } from "./content.ts";
import { usePage, useTheme } from "./lib.ts";
import { Home } from "./pages/Home.tsx";
import { Download } from "./pages/Download.tsx";
import { Docs } from "./pages/Docs.tsx";
import { Pricing } from "./pages/Pricing.tsx";
import { Results } from "./pages/Results.tsx";
import { Faq } from "./pages/Faq.tsx";
import { Credits } from "./pages/Credits.tsx";

function NavLinks({ page, go, variant }: { page: Page; go: (p: Page) => void; variant: "bar" | "menu" }) {
  const cls = variant === "bar" ? "nav__link" : "menu__item";
  return (
    <>
      {NAV.map((item) =>
        item.page ? (
          <button
            key={item.label}
            type="button"
            className={cls}
            aria-current={page === item.page ? "page" : undefined}
            onClick={() => go(item.page!)}
          >
            {item.label}
          </button>
        ) : (
          <a key={item.label} className={cls} href={item.href}>
            {item.label}
          </a>
        ),
      )}
    </>
  );
}

function PhoneMenu({ page, go }: { page: Page; go: (p: Page) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="menu" ref={root}>
      <button type="button" className="menu__toggle" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(!open)}>
        Menu {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="menu__list" id="site-menu">
          <NavLinks
            page={page}
            go={(p) => {
              setOpen(false);
              go(p);
            }}
            variant="menu"
          />
        </div>
      )}
    </div>
  );
}

export function App() {
  const [page, go] = usePage();
  const theme = useTheme();

  const toDownload = (e: MouseEvent) => {
    e.preventDefault();
    go("download");
  };

  return (
    <div className="site">
      <header className="hdr">
        <div className="hdr__in">
          <button type="button" className="brand" aria-label="Repro home" onClick={() => go("home")}>
            <img src={`/brand/repro-logo-${theme}.png`} alt="Repro" width={117} height={60} />
          </button>
          <nav className="nav" aria-label="Site">
            <NavLinks page={page} go={go} variant="bar" />
          </nav>
          <PhoneMenu page={page} go={go} />
          <a className="hdr__download" href="#download" onClick={toDownload}>
            Download
          </a>
        </div>
      </header>

      <main className="main">
        {page === "home" && <Home go={go} />}
        {page === "download" && <Download />}
        {page === "docs" && <Docs />}
        {page === "results" && <Results />}
        {page === "pricing" && <Pricing go={go} />}
        {page === "faq" && <Faq />}
        {page === "credits" && <Credits />}
      </main>

      <footer className="ftr">
        <span>Repro · v0.1.0</span>
        <a href={SAMPLE_REPORT_URL}>Sample report</a>
        <a href={GITHUB_URL}>GitHub</a>
        <span className="ftr__made">Made at ShellHacks 2026</span>
      </footer>
    </div>
  );
}

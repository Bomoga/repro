import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

/** `?theme=light|dark` wins; otherwise the system setting, followed live. */
export function useTheme(): Theme {
  const forced = new URLSearchParams(window.location.search).get("theme");
  const [prefersLight, setPrefersLight] = useState(() => window.matchMedia("(prefers-color-scheme: light)").matches);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setPrefersLight(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme: Theme = forced === "light" || forced === "dark" ? forced : prefersLight ? "light" : "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#121212" : "#ECEAE3");
  }, [theme]);

  return theme;
}

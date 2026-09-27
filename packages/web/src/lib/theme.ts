import { useEffect } from "react";

export type Theme = "dark" | "light";

/** Light is the dashboard's main theme; `?theme=dark` switches to the dark one. */
export function useTheme(): Theme {
  const theme: Theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#121212" : "#ECEAE3");
  }, [theme]);

  return theme;
}

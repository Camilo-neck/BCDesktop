import { useCallback, useEffect, useState } from "react";
import { useSettings } from "./settings";

/**
 * SVG presentation attributes (`stroke`, `fill`, `stopColor`) do not accept
 * `var(--x)`, and charting libraries pass colors that way. This resolves a
 * theme token to a concrete color, refreshed whenever the theme changes.
 */
export function useThemeColor() {
  const { theme } = useSettings();
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setRev((r) => r + 1));
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setRev((r) => r + 1);
    mq.addEventListener("change", onChange);
    return () => (cancelAnimationFrame(id), mq.removeEventListener("change", onChange));
  }, [theme]);
  return useCallback(
    (token: string, alpha = 1) => {
      void rev;
      const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();
      return raw ? `rgb(${raw} / ${alpha})` : "currentColor";
    },
    [rev],
  );
}

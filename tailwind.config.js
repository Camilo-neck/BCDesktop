/** @type {import('tailwindcss').Config} */
import animate from "tailwindcss-animate";

// Every color is a CSS variable (see src/styles/globals.css) so light and dark
// themes share one class name: `bg-surface` instead of `bg-surface-light dark:bg-surface-dark`.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Roboto Flex Variable"', "Roboto", "system-ui", "sans-serif"],
      },
      colors: {
        primary: { DEFAULT: token("primary"), on: token("on-primary"), container: token("primary-container"), "on-container": token("on-primary-container") },
        secondary: { DEFAULT: token("secondary"), on: token("on-secondary"), container: token("secondary-container"), "on-container": token("on-secondary-container") },
        tertiary: { DEFAULT: token("tertiary"), container: token("tertiary-container"), "on-container": token("on-tertiary-container") },
        error: { DEFAULT: token("error"), container: token("error-container"), "on-container": token("on-error-container") },
        warning: { DEFAULT: token("warning"), container: token("warning-container") },
        surface: {
          DEFAULT: token("surface"),
          lowest: token("surface-lowest"),
          low: token("surface-low"),
          container: token("surface-container"),
          high: token("surface-high"),
          highest: token("surface-highest"),
        },
        "on-surface": { DEFAULT: token("on-surface"), variant: token("on-surface-variant") },
        outline: { DEFAULT: token("outline"), variant: token("outline-variant") },
        typology: {
          disciplinar: token("typ-disciplinar"),
          fundamental: token("typ-fundamental"),
          libre: token("typ-libre"),
          nivelacion: token("typ-nivelacion"),
          grado: token("typ-grado"),
          otra: token("outline"),
        },
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        elev1: "0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.08)",
        elev2: "0 4px 12px rgb(0 0 0 / 0.10), 0 1px 3px rgb(0 0 0 / 0.06)",
        elev3: "0 12px 32px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.08)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-up": "fade-up 180ms ease-out both",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [animate],
};

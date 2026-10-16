import { useEffect } from "react";
import { createHashRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/primitives";
import { TourHost } from "@/components/tour/Tour";
import { AppShell } from "@/components/shell/AppShell";
import { isTauri } from "@/lib/api";
import { applyTheme, useSettings } from "@/lib/settings";
import { useUi } from "@/lib/store";
import type { Progress } from "@/lib/types";
import { HomePage } from "@/pages/Home";
import { PlannerPage } from "@/pages/Planner";
import { ProgressPage } from "@/pages/Progress";
import { CurriculumPage } from "@/pages/Curriculum";
import { SettingsPage } from "@/pages/Settings";
import { AboutPage } from "@/pages/About";

const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/planner", element: <PlannerPage /> },
      { path: "/progress", element: <ProgressPage /> },
      { path: "/curriculum", element: <CurriculumPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/about", element: <AboutPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  const { theme } = useSettings();
  const setProgress = useUi((s) => s.setProgress);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => {
    if (!isTauri()) return;
    // The window starts hidden (tauri.conf.json) so it appears already painted.
    void getCurrentWindow().show();
    // The last event (done >= total) is kept: the indicator shows it as finished, then hides itself.
    const un = listen<Progress>("bc://progress", (e) => setProgress(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, [setProgress]);

  return (
    <TooltipProvider delayDuration={350}>
      <RouterProvider router={router} />
      <TourHost />
      <Toaster
        position="bottom-right"
        theme={theme}
        toastOptions={{
          classNames: {
            toast: "!rounded-xl !border-outline-variant/60 !bg-surface-lowest dark:!bg-surface-high !text-on-surface !shadow-elev2 !font-sans",
            description: "!text-on-surface-variant",
            actionButton: "!bg-primary !text-primary-on !rounded-lg",
          },
        }}
      />
    </TooltipProvider>
  );
}

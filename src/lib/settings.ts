import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { CareerRef, Term } from "./types";

export type Theme = "light" | "dark" | "system";

export interface Settings {
  theme: Theme;
  defaultCareer: CareerRef | null;
  statsApiUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  /** Tour id -> completed. */
  tours: Record<string, boolean>;
  gridHours: [number, number];
  showWeekend: boolean;
  term: Term;
  onboarded: boolean;
  activeScheduleId: string | null;
}

function defaultTerm(): Term {
  const now = new Date();
  const y = now.getFullYear();
  const second = now.getMonth() >= 6;
  return second
    ? { from: `${y}-08-15`, until: `${y}-12-15`, useGroupDates: true }
    : { from: `${y}-02-01`, until: `${y}-06-15`, useGroupDates: true };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  defaultCareer: null,
  statsApiUrl: "",
  googleClientId: "",
  googleClientSecret: "",
  tours: {},
  gridHours: [6, 22],
  showWeekend: true,
  term: defaultTerm(),
  onboarded: false,
  activeScheduleId: null,
};

function useSettingsQuery() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => ({ ...DEFAULT_SETTINGS, ...(await api.settings()) }) as Settings,
    staleTime: Infinity,
  });
}

export function useSettings() {
  return useSettingsQuery().data ?? DEFAULT_SETTINGS;
}

/** False until the stored settings arrive (defaults are shown meanwhile). */
export function useSettingsLoaded() {
  return useSettingsQuery().isSuccess;
}

/** Returns `set(key, value)`: optimistic update of the cached settings, then persist. */
export function useSetSetting() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: ({ key, value }: { key: keyof Settings; value: unknown }) => api.setSetting(key, value),
    // Commands run concurrently in the backend: queue writes so a slider drag stores its last value.
    scope: { id: "settings" },
    onMutate: async ({ key, value }) => {
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<Settings>(["settings"]);
      qc.setQueryData<Settings>(["settings"], (s) => ({ ...(s ?? DEFAULT_SETTINGS), [key]: value }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["settings"], ctx.prev);
    },
  });
  return <K extends keyof Settings>(key: K, value: Settings[K]) => m.mutateAsync({ key, value });
}

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("bc-theme", theme);
  } catch {
    /* storage unavailable: the theme still applies for this session */
  }
}

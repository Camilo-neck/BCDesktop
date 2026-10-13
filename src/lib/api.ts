// Typed wrappers over the Tauri commands in src-tauri/src/commands.
import { invoke } from "@tauri-apps/api/core";
import { useUi } from "./store";
import type {
  AppInfo,
  CareerRef,
  Course,
  CourseSummary,
  CoreError,
  CurriculumGraph,
  DropdownOption,
  FetchReport,
  GenerateRequest,
  GenerateResult,
  GoogleAccount,
  Library,
  PlanSummary,
  Progress,
  Professor,
  Projection,
  Schedule,
  Selection,
  StoredHistory,
  Term,
} from "./types";

export class ApiError extends Error {
  kind: string;
  constructor(e: CoreError) {
    super(e.message);
    this.kind = e.kind;
  }
}

/** Commands that report progress through `bc://progress`, and the task they report as. */
const LONG_TASKS: Partial<Record<string, Progress["task"]>> = {
  library_fetch: "courses",
  library_refresh: "courses",
  plan_fetch: "plan",
  google_export: "google",
};

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Remove the indicator if it still shows the starting state of `task` (no event ever arrived). */
function clearIfStarting(task: Progress["task"]) {
  const { progress, setProgress } = useUi.getState();
  if (progress?.task === task && progress.total === 0) setProgress(null);
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const task = LONG_TASKS[cmd];
  try {
    if (import.meta.env.DEV && !isTauri()) {
      const { mockInvoke } = await import("../dev/mock");
      return await mockInvoke<T>(cmd, args);
    }
    // Show the indicator at once: the first progress event can take seconds while the SIA sessions open.
    if (task) useUi.getState().setProgress({ task, done: 0, total: 0, current: "" });
    const result = await invoke<T>(cmd, args);
    // A task with nothing to do finishes without any event.
    if (task) clearIfStarting(task);
    return result;
  } catch (e) {
    // A task that fails midway never sends its final progress event: clear the indicator here.
    if (task) useUi.getState().setProgress(null);
    if (e && typeof e === "object" && "message" in e) throw new ApiError(e as CoreError);
    throw new ApiError({ kind: "external", message: String(e) });
  }
}

export const api = {
  appInfo: () => call<AppInfo>("app_info"),
  settings: () => call<Record<string, unknown>>("settings_get"),
  setSetting: (key: string, value: unknown) => call<void>("settings_set", { key, value }),
  clearCache: () => call<number>("cache_clear"),
  resetData: (includeSettings: boolean) => call<void>("data_reset", { includeSettings }),

  levels: (force = false) => call<DropdownOption[]>("catalog_levels", { force }),
  campuses: (level: string, force = false) => call<DropdownOption[]>("catalog_campuses", { level, force }),
  faculties: (level: string, campus: string, force = false) =>
    call<DropdownOption[]>("catalog_faculties", { level, campus, force }),
  plans: (level: string, campus: string, faculty: string, force = false) =>
    call<DropdownOption[]>("catalog_plans", { level, campus, faculty, force }),
  catalogCourses: (career: CareerRef, force = false) =>
    call<{ career: CareerRef; courses: CourseSummary[] }>("catalog_courses", { career, force }),
  cancel: () => call<void>("sia_cancel"),

  library: () => call<Library>("library_list"),
  fetchCourses: (career: CareerRef, codes: string[]) => call<FetchReport>("library_fetch", { career, codes }),
  refreshCourses: (codes?: string[]) => call<FetchReport>("library_refresh", { codes: codes ?? null }),
  saveManualCourse: (course: Course) => call<Library>("library_save_manual", { course }),
  removeCourse: (code: string) => call<Library>("library_remove", { code }),
  setCourseColor: (code: string, color: string) => call<void>("library_set_color", { code, color }),
  toggleFavorite: (selection: Selection) => call<boolean>("favorites_toggle", { selection }),

  schedules: () => call<Schedule[]>("schedules_list"),
  createSchedule: (name: string) => call<Schedule>("schedule_create", { name }),
  saveSchedule: (schedule: Schedule) => call<Schedule>("schedule_save", { schedule }),
  duplicateSchedule: (id: string) => call<Schedule>("schedule_duplicate", { id }),
  deleteSchedule: (id: string) => call<void>("schedule_delete", { id }),
  reorderSchedules: (ids: string[]) => call<void>("schedules_reorder", { ids }),
  generate: (request: GenerateRequest) => call<GenerateResult>("schedules_generate", { request }),

  parseHistory: (text: string) => call<StoredHistory>("history_parse", { text }),
  latestHistory: () => call<StoredHistory | null>("history_latest"),
  clearHistory: () => call<void>("history_clear"),
  papaAfter: (papi: number, credits: number) => call<Projection>("calc_papa_after", { papi, credits }),
  papiFor: (target: number, credits: number) => call<Projection>("calc_papi_for", { target, credits }),
  maxPapa: () => call<Projection>("calc_max_papa"),

  downloadedPlans: () =>call<PlanSummary[]>("plans_list"),
  fetchPlan: (career: CareerRef) => call<PlanSummary>("plan_fetch", { career }),
  deletePlan: (careerKey: string) => call<void>("plan_delete", { careerKey }),
  planGraph: (careerKey: string, options: { hideLeveling: boolean; hideExternal: boolean }, withHistory: boolean) =>
    call<CurriculumGraph>("plan_graph", { careerKey, options, withHistory }),

  professor: (name: string) => call<Professor | null>("professor_lookup", { name }),
  inscriptionStats: (careerName: string, courseCode: string) =>
    call<unknown>("stats_inscriptions", { careerName, courseCode }),
  exportIcs: (scheduleId: string, term: Term, path: string) => call<string>("export_ics", { scheduleId, term, path }),
  googleStatus: () => call<GoogleAccount | null>("google_status"),
  googleConnect: () => call<GoogleAccount>("google_connect"),
  googleDisconnect: () => call<void>("google_disconnect"),
  googleExport: (scheduleId: string, term: Term) =>
    call<{ calendarId: string; created: number; failed: number }>("google_export", { scheduleId, term }),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

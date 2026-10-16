// In-browser stand-in for the Tauri commands, used only by `npm run dev` outside
// Tauri (UI work, screenshots). Data comes from real SIA exports in ./fixtures,
// produced by `cargo run -p bc-core --example dump_fixtures`.
import catalog from "./fixtures/catalog.json";
import coursesFixture from "./fixtures/courses.json";
import graphFixture from "./fixtures/graph.json";
import historyFixture from "./fixtures/history.json";
import { PALETTE } from "@/lib/palette";
import type { AcademicHistory, Course, CurriculumGraph, GenerateRequest, GenerateResult, Library, Schedule, Selection } from "@/lib/types";
import { groupsCollide } from "@/lib/utils";
import { useUi } from "@/lib/store";
import type { UpdateHandle } from "@/lib/updater";

const params = new URLSearchParams(window.location.search);
const now = () => new Date().toISOString();
const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

const courses = coursesFixture as unknown as Course[];
const library: Library = {
  courses: courses.map((c, i) => ({ course: c, color: PALETTE[i % PALETTE.length], addedAt: now() })),
  favorites: [],
};

function initialSelections(): Selection[] {
  const chosen: { code: string; group: Course["groups"][number] }[] = [];
  for (const c of courses.slice(0, 6)) {
    const g = c.groups.find((g) => g.sessions.length && !chosen.some((x) => groupsCollide(x.group, g)));
    if (g) chosen.push({ code: c.code, group: g });
  }
  return chosen.map((x) => ({ courseCode: x.code, groupId: x.group.id }));
}

let schedules: Schedule[] = [
  { id: "s1", name: "2026-2 · Plan A", selections: params.has("empty") ? [] : initialSelections(), blocks: [{ day: "FRI", start: 14 * 60, end: 18 * 60, label: "Trabajo" }], createdAt: now(), updatedAt: now() },
  { id: "s2", name: "Plan B", selections: [], blocks: [], createdAt: now(), updatedAt: now() },
];

const tourIds = ["welcome", "planner", "addCourses", "generator", "progress", "curriculum"];
const settings: Record<string, unknown> = {
  tours: params.get("tours") === "on" ? {} : Object.fromEntries(tourIds.map((t) => [t, true])),
  defaultCareer: catalog.career,
};
let history = params.has("nohistory") ? null : { id: 1, history: historyFixture as unknown as AcademicHistory, createdAt: now() };

function graphWith(withHistory: boolean): CurriculumGraph {
  const g = structuredClone(graphFixture) as unknown as CurriculumGraph;
  if (!withHistory || !history) return g;
  const passed = new Set(history.history.periods.flatMap((p) => p.courses.filter((c) => c.passed).map((c) => c.code)));
  for (const n of g.nodes) {
    if (n.status === "external") continue;
    if (passed.has(n.code)) n.status = "approved";
    else if (n.conditions.filter((c) => c.kind === "M").every((c) => c.courses.filter((x) => passed.has(x.code)).length >= (c.all ? c.courses.length : (c.required ?? 1))))
      n.status = "available";
    else n.status = "locked";
  }
  g.stats.approved = g.nodes.filter((n) => n.status === "approved").length;
  g.stats.available = g.nodes.filter((n) => n.status === "available").length;
  return g;
}

function naiveGenerate(req: GenerateRequest): GenerateResult {
  const out: Selection[][] = [];
  const rec = (i: number, picked: { code: string; group: Course["groups"][number] }[]) => {
    if (out.length >= 12) return;
    if (i === req.courses.length) return void out.push(picked.map((p) => ({ courseCode: p.code, groupId: p.group.id })));
    for (const g of req.courses[i].groups.filter((g) => g.sessions.length)) {
      if (picked.some((p) => groupsCollide(p.group, g))) continue;
      rec(i + 1, [...picked, { code: req.courses[i].code, group: g }]);
    }
  };
  rec(0, []);
  return {
    schedules: out.map((selections, i) => ({
      selections,
      omitted: [],
      score: i,
      metrics: { gapMinutes: 60 * (i % 3), days: 4 + (i % 2), credits: 16, earliest: 7 * 60, latest: 18 * 60, favorites: 0, minSpots: 12 },
    })),
    unschedulable: [],
    complete: true,
    explored: 1840,
    truncated: false,
  };
}

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const handlers: Record<string, (a: Args) => unknown> = {
  app_info: () => ({ version: "0.1.0-dev", dataDir: "~/.local/share/co.com.bettercampus.desktop", os: "linux", arch: "x86_64", defaultStatsApi: "", googleConfigured: false }),
  settings_get: () => settings,
  settings_set: (a) => void (settings[a.key] = a.value),
  cache_clear: () => 12,
  data_reset: () => undefined,
  catalog_levels: () => catalog.levels,
  catalog_campuses: () => catalog.campuses,
  catalog_faculties: () => catalog.faculties,
  catalog_plans: () => catalog.plans,
  catalog_courses: () => ({ career: catalog.career, courses: catalog.courses }),
  sia_cancel: () => undefined,
  library_list: () => library,
  library_fetch: (a) => ({ updated: a.codes, failed: [] }),
  library_refresh: () => ({ updated: library.courses.map((c) => c.course.code), failed: [] }),
  library_save_manual: (a) => {
    library.courses = [...library.courses.filter((c) => c.course.code !== a.course.code), { course: a.course, color: PALETTE[library.courses.length % PALETTE.length], addedAt: now() }];
    return library;
  },
  library_remove: (a) => {
    library.courses = library.courses.filter((c) => c.course.code !== a.code);
    return library;
  },
  library_set_color: (a) => void library.courses.forEach((c) => c.course.code === a.code && (c.color = a.color)),
  favorites_toggle: (a) => {
    const has = library.favorites.some((f) => f.courseCode === a.selection.courseCode && f.groupId === a.selection.groupId);
    library.favorites = has ? library.favorites.filter((f) => !(f.courseCode === a.selection.courseCode && f.groupId === a.selection.groupId)) : [...library.favorites, a.selection];
    return !has;
  },
  schedules_list: () => schedules,
  schedule_create: (a) => {
    const s: Schedule = { id: crypto.randomUUID(), name: a.name, selections: [], blocks: [], createdAt: now(), updatedAt: now() };
    schedules = [...schedules, s];
    return s;
  },
  schedule_save: (a) => {
    schedules = schedules.map((s) => (s.id === a.schedule.id ? a.schedule : s));
    return a.schedule;
  },
  schedule_duplicate: (a) => {
    const src = schedules.find((s) => s.id === a.id)!;
    const s = { ...structuredClone(src), id: crypto.randomUUID(), name: `${src.name} (copia)` };
    schedules = [...schedules, s];
    return s;
  },
  schedule_delete: (a) => void (schedules = schedules.filter((s) => s.id !== a.id)),
  schedules_reorder: () => undefined,
  schedules_generate: (a) => naiveGenerate(a.request),
  history_parse: () => (history = { id: 2, history: historyFixture as unknown as AcademicHistory, createdAt: now() }),
  history_latest: () => history,
  history_clear: () => void (history = null),
  calc_papa_after: (a) => ({ currentPapa: 4.0, approvedCredits: 63, value: +((4.0 * 63 + a.papi * a.credits) / (63 + a.credits)).toFixed(2), reachable: true }),
  calc_papi_for: (a) => {
    const v = +((a.target * (63 + a.credits) - 4.0 * 63) / a.credits).toFixed(2);
    return { currentPapa: 4.0, approvedCredits: 63, value: v, reachable: v >= 0 && v <= 5 };
  },
  calc_max_papa: () => ({ currentPapa: 4.0, approvedCredits: 63, value: 4.65, reachable: true }),
  plans_list: () => [{ careerKey: "0-2-8-4", careerName: catalog.career.name, fetchedAt: now() }],
  plan_fetch: () => ({ careerKey: "0-2-8-4", careerName: catalog.career.name, fetchedAt: now() }),
  plan_delete: () => undefined,
  plan_graph: (a) => {
    const g = graphWith(a.withHistory);
    if (!a.options.hideExternal) return g;
    const keep = new Set(g.nodes.filter((n) => n.status !== "external").map((n) => n.code));
    return { ...g, nodes: g.nodes.filter((n) => keep.has(n.code)), edges: g.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
  },
  professor_lookup: (a) => ({ name: a.name, url: "https://losestudiantes.com", rating: 4.3, gradeAverage: 3.9, approvalRatio: 0.86, reviews: 27, departments: [] }),
  stats_inscriptions: () => {
    throw { kind: "invalid", message: "Configura la URL de la API de estadísticas en Ajustes." };
  },
  export_ics: (a) => a.path,
  google_status: () => null,
  google_connect: () => {
    throw { kind: "auth", message: "No disponible en el navegador" };
  },
  google_disconnect: () => undefined,
  google_export: () => ({ calendarId: "x", created: 0, failed: 0 }),
};

// `?open=gen|add|export|palette` opens that panel on load (screenshots).
setTimeout(() => {
  const ui = useUi.getState();
  const open = params.get("open");
  if (open === "gen") ui.setGeneratorOpen(true);
  if (open === "add") ui.setAddCoursesOpen(true);
  if (open === "export") ui.setExportOpen(true);
  if (open === "palette") ui.setPaletteOpen(true);
}, 300);

export async function mockInvoke<T>(cmd: string, args?: Args): Promise<T> {
  await delay();
  const h = handlers[cmd];
  if (!h) throw { kind: "external", message: `mock: ${cmd} no implementado` };
  return structuredClone(h(args ?? {})) as T;
}

/** Fake release for `?update`: an 8 MB download in about two seconds; installing reloads the page. */
export function mockUpdate(): UpdateHandle {
  const total = 8 * 1024 * 1024;
  return {
    version: "0.2.0",
    currentVersion: "0.1.0",
    async download(onEvent) {
      onEvent?.({ event: "Started", data: { contentLength: total } });
      for (let sent = 0; sent < total; sent += total / 20) {
        await delay(100);
        onEvent?.({ event: "Progress", data: { chunkLength: total / 20 } });
      }
      onEvent?.({ event: "Finished" });
    },
    async install() {
      await delay(800);
    },
  };
}

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "./api";
import { useSetSetting, useSettings } from "./settings";
import { useUi } from "./store";
import type { Block, Course, Group, Library, LibraryCourse, Schedule, Selection } from "./types";
import { groupsCollide } from "./utils";

export function useLibrary() {
  return useQuery({ queryKey: ["library"], queryFn: api.library, staleTime: Infinity });
}

export function useSchedules() {
  return useQuery({ queryKey: ["schedules"], queryFn: api.schedules, staleTime: Infinity });
}

export interface ResolvedSelection {
  selection: Selection;
  course: Course;
  group: Group;
  color: string;
}

export interface LibraryIndex {
  items: LibraryCourse[];
  byCode: Map<string, LibraryCourse>;
  favorites: Set<string>;
}

export const selKey = (s: Selection) => `${s.courseCode}::${s.groupId}`;

export function useLibraryIndex(): LibraryIndex {
  const { data } = useLibrary();
  return useMemo(() => {
    const items = data?.courses ?? [];
    return {
      items,
      byCode: new Map(items.map((i) => [i.course.code, i])),
      favorites: new Set((data?.favorites ?? []).map(selKey)),
    };
  }, [data]);
}

export function resolve(index: LibraryIndex, selections: Selection[]): ResolvedSelection[] {
  const out: ResolvedSelection[] = [];
  for (const selection of selections) {
    const item = index.byCode.get(selection.courseCode);
    const group = item?.course.groups.find((g) => g.id === selection.groupId);
    if (item && group) out.push({ selection, course: item.course, group, color: item.color });
  }
  return out;
}

/** Courses of `selections` whose group collides with `group` (other than `courseCode` itself). */
export function collidingWith(index: LibraryIndex, selections: Selection[], courseCode: string, group: Group): ResolvedSelection[] {
  return resolve(index, selections).filter((r) => r.course.code !== courseCode && groupsCollide(r.group, group));
}

export function useActiveSchedule() {
  const { data: schedules } = useSchedules();
  const settings = useSettings();
  const active = schedules?.find((s) => s.id === settings.activeScheduleId) ?? schedules?.[0];
  return { schedules: schedules ?? [], active };
}

/** Every mutation of the active schedule goes through here: optimistic cache
 *  update, persistence, undo history and conflict feedback. */
export function useScheduleEditor() {
  const qc = useQueryClient();
  const { active, schedules } = useActiveSchedule();
  const index = useLibraryIndex();
  const setSetting = useSetSetting();
  const pushUndo = useUi((s) => s.pushUndo);
  const popUndo = useUi((s) => s.popUndo);
  const popRedo = useUi((s) => s.popRedo);

  const save = useMutation({
    mutationFn: api.saveSchedule,
    // Commands run concurrently in the backend: queue saves so an older edit never lands last.
    scope: { id: "schedules" },
    onMutate: async (s: Schedule) => {
      await qc.cancelQueries({ queryKey: ["schedules"] });
      const prev = qc.getQueryData<Schedule[]>(["schedules"]);
      qc.setQueryData<Schedule[]>(["schedules"], (list) => list?.map((x) => (x.id === s.id ? s : x)));
      return { prev };
    },
    onError: (e, _s, ctx) => {
      if (ctx?.prev) qc.setQueryData(["schedules"], ctx.prev);
      toast.error("No se pudo guardar el horario", { description: errorMessage(e) });
    },
  });

  // `mutate` keeps its identity across renders, unlike the mutation object: depending on it keeps
  // every editor action stable, so memoized components that receive one don't re-render.
  const { mutate } = save;

  /** Schedule `id` as the cache holds it now. Actions that run later than the render that created
   *  them (a toast button) read it instead of `active`, which may be outdated by then. */
  const currentSchedule = useCallback((id: string) => qc.getQueryData<Schedule[]>(["schedules"])?.find((s) => s.id === id), [qc]);

  const commit = useCallback(
    (id: string, next: Partial<Schedule>, recordUndo = true) => {
      const current = currentSchedule(id);
      if (!current) return;
      if (recordUndo && next.selections) pushUndo(id, current.selections);
      mutate({ ...current, ...next });
    },
    [currentSchedule, mutate, pushUndo],
  );

  /** Courses in the schedule whose group collides with `group`. */
  const conflictsWith = useCallback(
    (courseCode: string, group: Group): ResolvedSelection[] => {
      if (!active) return [];
      return collidingWith(index, active.selections, courseCode, group);
    },
    [active, index],
  );

  const blockConflicts = useCallback(
    (group: Group): Block[] =>
      (active?.blocks ?? []).filter((b) => group.sessions.some((s) => s.day === b.day && s.start < b.end && b.start < s.end)),
    [active],
  );

  const selectGroup = useCallback(
    (courseCode: string, groupId: string, opts: { force?: boolean } = {}) => {
      if (!active) return false;
      const item = index.byCode.get(courseCode);
      const group = item?.course.groups.find((g) => g.id === groupId);
      if (!item || !group) return false;
      const current = active.selections.find((s) => s.courseCode === courseCode);
      if (current?.groupId === groupId) {
        commit(active.id, { selections: active.selections.filter((s) => s.courseCode !== courseCode) });
        return true;
      }
      const clashes = conflictsWith(courseCode, group);
      if (clashes.length && !opts.force) {
        toast.error(`Choca con ${clashes.map((c) => c.course.name).join(", ")}`, {
          description: "Quita esa asignatura o elige otro grupo.",
          action: {
            label: "Reemplazar",
            // The student may edit the schedule before pressing this: start from the schedule as it is then.
            onClick: () => {
              const latest = currentSchedule(active.id);
              if (!latest) return;
              const colliding = new Set(collidingWith(index, latest.selections, courseCode, group).map((r) => r.course.code));
              const keep = latest.selections.filter((s) => s.courseCode !== courseCode && !colliding.has(s.courseCode));
              commit(latest.id, { selections: [...keep, { courseCode, groupId }] });
            },
          },
        });
        return false;
      }
      if (group.spots === 0) toast.warning("Este grupo no tiene cupos disponibles", { description: "Se agregó igual, por si se liberan." });
      const rest = active.selections.filter((s) => s.courseCode !== courseCode);
      commit(active.id, { selections: [...rest, { courseCode, groupId }] });
      return true;
    },
    [active, index, commit, conflictsWith, currentSchedule],
  );

  const removeCourse = useCallback(
    (courseCode: string) => active && commit(active.id, { selections: active.selections.filter((s) => s.courseCode !== courseCode) }),
    [active, commit],
  );

  const activeId = active?.id;
  const replaceSelections = useCallback((selections: Selection[]) => activeId && commit(activeId, { selections }), [activeId, commit]);

  const setBlocks = useCallback((blocks: Block[]) => activeId && commit(activeId, { blocks }, false), [activeId, commit]);

  const rename = useCallback((name: string) => activeId && commit(activeId, { name }, false), [activeId, commit]);

  const undo = useCallback(() => {
    if (!active) return;
    const prev = popUndo(active.id, active.selections);
    if (prev) mutate({ ...active, selections: prev });
  }, [active, popUndo, mutate]);

  const redo = useCallback(() => {
    if (!active) return;
    const next = popRedo(active.id, active.selections);
    if (next) mutate({ ...active, selections: next });
  }, [active, popRedo, mutate]);

  const setActive = useCallback((id: string) => setSetting("activeScheduleId", id), [setSetting]);

  const create = useCallback(
    async (name: string, selections: Selection[] = []) => {
      let s = await api.createSchedule(name);
      if (selections.length) s = await api.saveSchedule({ ...s, selections });
      qc.setQueryData<Schedule[]>(["schedules"], (l) => [...(l ?? []), s]);
      await setActive(s.id);
      return s;
    },
    [qc, setActive],
  );

  const duplicate = useCallback(
    async (id: string) => {
      const s = await api.duplicateSchedule(id);
      qc.setQueryData<Schedule[]>(["schedules"], (l) => [...(l ?? []), s]);
      await setActive(s.id);
    },
    [qc, setActive],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteSchedule(id);
      const list = await qc.fetchQuery({ queryKey: ["schedules"], queryFn: api.schedules });
      if (active?.id === id && list[0]) await setActive(list[0].id);
    },
    [qc, active, setActive],
  );

  return {
    active,
    schedules,
    index,
    resolved: active ? resolve(index, active.selections) : [],
    selectGroup,
    removeCourse,
    replaceSelections,
    setBlocks,
    rename,
    undo,
    redo,
    setActive,
    create,
    duplicate,
    remove,
    conflictsWith,
    blockConflicts,
  };
}

export function useLibraryActions() {
  const qc = useQueryClient();
  const setLib = (l: Library) => qc.setQueryData(["library"], l);
  const refetchAll = () => Promise.all([qc.invalidateQueries({ queryKey: ["library"] }), qc.invalidateQueries({ queryKey: ["schedules"] })]);
  return {
    async remove(code: string) {
      setLib(await api.removeCourse(code));
      await qc.invalidateQueries({ queryKey: ["schedules"] });
    },
    async setColor(code: string, color: string) {
      qc.setQueryData<Library>(["library"], (l) =>
        l ? { ...l, courses: l.courses.map((c) => (c.course.code === code ? { ...c, color } : c)) } : l,
      );
      await api.setCourseColor(code, color);
    },
    async toggleFavorite(sel: Selection) {
      qc.setQueryData<Library>(["library"], (l) => {
        if (!l) return l;
        const has = l.favorites.some((f) => f.courseCode === sel.courseCode && f.groupId === sel.groupId);
        return {
          ...l,
          favorites: has ? l.favorites.filter((f) => !(f.courseCode === sel.courseCode && f.groupId === sel.groupId)) : [...l.favorites, sel],
        };
      });
      await api.toggleFavorite(sel);
    },
    async saveManual(course: Course) {
      setLib(await api.saveManualCourse(course));
    },
    refetchAll,
  };
}

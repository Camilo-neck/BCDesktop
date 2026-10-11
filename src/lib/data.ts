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
  const { pushUndo, popUndo, popRedo } = useUi();

  const save = useMutation({
    mutationFn: api.saveSchedule,
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

  const commit = useCallback(
    (next: Partial<Schedule>, recordUndo = true) => {
      if (!active) return;
      if (recordUndo && next.selections) pushUndo(active.id, active.selections);
      save.mutate({ ...active, ...next });
    },
    [active, save, pushUndo],
  );

  /** Courses in the schedule whose group collides with `group`. */
  const conflictsWith = useCallback(
    (courseCode: string, group: Group): ResolvedSelection[] => {
      if (!active) return [];
      return resolve(index, active.selections).filter((r) => r.course.code !== courseCode && groupsCollide(r.group, group));
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
        commit({ selections: active.selections.filter((s) => s.courseCode !== courseCode) });
        return true;
      }
      const clashes = conflictsWith(courseCode, group);
      if (clashes.length && !opts.force) {
        toast.error(`Choca con ${clashes.map((c) => c.course.name).join(", ")}`, {
          description: "Quita esa asignatura o elige otro grupo.",
          action: {
            label: "Reemplazar",
            onClick: () => {
              const keep = active.selections.filter(
                (s) => s.courseCode !== courseCode && !clashes.some((c) => c.course.code === s.courseCode),
              );
              commit({ selections: [...keep, { courseCode, groupId }] });
            },
          },
        });
        return false;
      }
      if (group.spots === 0) toast.warning("Este grupo no tiene cupos disponibles", { description: "Se agregó igual, por si se liberan." });
      const rest = active.selections.filter((s) => s.courseCode !== courseCode);
      commit({ selections: [...rest, { courseCode, groupId }] });
      return true;
    },
    [active, index, commit, conflictsWith],
  );

  const removeCourse = useCallback(
    (courseCode: string) => active && commit({ selections: active.selections.filter((s) => s.courseCode !== courseCode) }),
    [active, commit],
  );

  const replaceSelections = useCallback((selections: Selection[]) => commit({ selections }), [commit]);

  const setBlocks = useCallback((blocks: Block[]) => commit({ blocks }, false), [commit]);

  const rename = useCallback((name: string) => commit({ name }, false), [commit]);

  const undo = useCallback(() => {
    if (!active) return;
    const prev = popUndo(active.id, active.selections);
    if (prev) save.mutate({ ...active, selections: prev });
  }, [active, popUndo, save]);

  const redo = useCallback(() => {
    if (!active) return;
    const next = popRedo(active.id, active.selections);
    if (next) save.mutate({ ...active, selections: next });
  }, [active, popRedo, save]);

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

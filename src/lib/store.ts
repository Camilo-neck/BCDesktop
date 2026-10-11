import { create } from "zustand";
import type { GeneratedSchedule, Progress, Selection } from "./types";

type Snapshot = Selection[];

interface UiState {
  /** Group hovered in the library or generator, drawn as a ghost on the grid. */
  preview: Selection[] | null;
  setPreview: (p: Selection[] | null) => void;

  progress: Progress | null;
  setProgress: (p: Progress | null) => void;

  addCoursesOpen: boolean;
  setAddCoursesOpen: (o: boolean) => void;
  generatorOpen: boolean;
  setGeneratorOpen: (o: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  exportOpen: boolean;
  setExportOpen: (o: boolean) => void;

  /** Group whose detail sheet is open. */
  groupDetail: Selection | null;
  setGroupDetail: (s: Selection | null) => void;

  /** Course expanded in the library list (scrolls into view). */
  focusedCourse: string | null;
  setFocusedCourse: (c: string | null) => void;

  generated: GeneratedSchedule[];
  setGenerated: (g: GeneratedSchedule[]) => void;

  /** Undo/redo stacks of selections per schedule id. */
  undo: Record<string, Snapshot[]>;
  redo: Record<string, Snapshot[]>;
  pushUndo: (scheduleId: string, before: Snapshot) => void;
  popUndo: (scheduleId: string, current: Snapshot) => Snapshot | undefined;
  popRedo: (scheduleId: string, current: Snapshot) => Snapshot | undefined;
}

const LIMIT = 50;

export const useUi = create<UiState>((set, get) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
  progress: null,
  setProgress: (progress) => set({ progress }),
  addCoursesOpen: false,
  setAddCoursesOpen: (addCoursesOpen) => set({ addCoursesOpen }),
  generatorOpen: false,
  setGeneratorOpen: (generatorOpen) => set({ generatorOpen }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  exportOpen: false,
  setExportOpen: (exportOpen) => set({ exportOpen }),
  groupDetail: null,
  setGroupDetail: (groupDetail) => set({ groupDetail }),
  focusedCourse: null,
  setFocusedCourse: (focusedCourse) => set({ focusedCourse }),
  generated: [],
  setGenerated: (generated) => set({ generated }),

  undo: {},
  redo: {},
  pushUndo: (id, before) =>
    set((s) => ({
      undo: { ...s.undo, [id]: [...(s.undo[id] ?? []), before].slice(-LIMIT) },
      redo: { ...s.redo, [id]: [] },
    })),
  popUndo: (id, current) => {
    const stack = get().undo[id] ?? [];
    const prev = stack.at(-1);
    if (!prev) return undefined;
    set((s) => ({
      undo: { ...s.undo, [id]: stack.slice(0, -1) },
      redo: { ...s.redo, [id]: [...(s.redo[id] ?? []), current] },
    }));
    return prev;
  },
  popRedo: (id, current) => {
    const stack = get().redo[id] ?? [];
    const next = stack.at(-1);
    if (!next) return undefined;
    set((s) => ({
      redo: { ...s.redo, [id]: stack.slice(0, -1) },
      undo: { ...s.undo, [id]: [...(s.undo[id] ?? []), current] },
    }));
    return next;
  },
}));

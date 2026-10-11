import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { CalendarMinus, Download, Info, MapPin, Redo2, Repeat2, Sparkles, TriangleAlert, Undo2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/primitives";
import { useAutoTour } from "@/components/tour/Tour";
import { AddCoursesDialog } from "@/components/planner/AddCoursesDialog";
import { AddBlockButton, BlockForm } from "@/components/planner/BlockPopover";
import { ExportDialog } from "@/components/planner/ExportDialog";
import { GeneratorPanel } from "@/components/planner/GeneratorPanel";
import { GroupDetailSheet } from "@/components/planner/GroupDetailSheet";
import { LibraryPanel } from "@/components/planner/LibraryPanel";
import { ManualCourseDialog } from "@/components/planner/ManualCourseDialog";
import { ScheduleTabs } from "@/components/planner/ScheduleTabs";
import { blockEvents, eventsFrom, WeekGrid, type GridEvent } from "@/components/planner/WeekGrid";
import { resolve, useScheduleEditor } from "@/lib/data";
import { useSettings } from "@/lib/settings";
import { useUi } from "@/lib/store";
import { DAYS, type Day } from "@/lib/types";
import { cn, DAY_LONG, groupTag, hhmm, modKey, overlaps, professorLine } from "@/lib/utils";

export function PlannerPage() {
  const editor = useScheduleEditor();
  const settings = useSettings();
  const { preview, generatorOpen, setGeneratorOpen, setExportOpen } = useUi();
  const [manual, setManual] = useState<{ open: boolean; code?: string }>({ open: false });
  useAutoTour("planner");

  // Keyboard: undo/redo and the generator.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || (e.target as HTMLElement)?.closest("input,textarea")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) (e.preventDefault(), editor.undo());
      else if ((k === "z" && e.shiftKey) || k === "y") (e.preventDefault(), editor.redo());
      else if (k === "g") (e.preventDefault(), setGeneratorOpen(!generatorOpen));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, generatorOpen, setGeneratorOpen]);

  const resolved = editor.resolved;
  const previewResolved = useMemo(() => (preview ? resolve(editor.index, preview) : []), [preview, editor.index]);

  const events = useMemo(() => {
    const previewCodes = new Set(previewResolved.map((r) => r.course.code));
    // While previewing a whole generated schedule, hide the current one.
    const replacing = previewResolved.length > 1;
    const base = eventsFrom(replacing ? [] : resolved.filter((r) => !previewCodes.has(r.course.code) || preview?.length !== 1));
    const ghost = eventsFrom(previewResolved, replacing ? "class" : "preview");
    const blocks = blockEvents(editor.active?.blocks ?? []);
    const solid = [...base, ...blocks];
    for (const e of [...base, ...ghost]) {
      e.conflict = [...solid, ...ghost].some(
        (o) => o.key !== e.key && o.source?.course.code !== e.source?.course.code && overlaps(e, o) && (e.kind !== "preview" || o.kind !== "preview"),
      );
    }
    return [...solid, ...ghost];
  }, [resolved, previewResolved, preview, editor.active?.blocks]);

  const days = useMemo<Day[]>(() => {
    const used = new Set(events.map((e) => e.day));
    return DAYS.filter((d) => ["MON", "TUE", "WED", "THU", "FRI"].includes(d) || (d === "SAT" && (settings.showWeekend || used.has(d))) || (d === "SUN" && used.has(d)));
  }, [events, settings.showWeekend]);

  const hours = useMemo<[number, number]>(() => {
    let [a, b] = settings.gridHours;
    for (const e of events) {
      a = Math.min(a, Math.floor(e.start / 60));
      b = Math.max(b, Math.ceil(e.end / 60));
    }
    return [a, b];
  }, [events, settings.gridHours]);

  const summary = useMemo(() => {
    const credits = resolved.reduce((a, r) => a + r.course.credits, 0);
    const sessions = resolved.flatMap((r) => r.group.sessions);
    const dayCount = new Set(sessions.map((s) => s.day)).size;
    const minutes = sessions.reduce((a, s) => a + s.end - s.start, 0);
    const conflicts = events.filter((e) => e.conflict && e.kind === "class").length;
    return { credits, dayCount, hours: minutes / 60, conflicts };
  }, [resolved, events]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-outline-variant/50 px-5 py-2.5">
        <h1 className="shrink-0 text-lg font-semibold tracking-tight">Planeador</h1>
        <div className="mx-1 h-5 w-px bg-outline-variant/70" />
        <ScheduleTabs />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip content="Deshacer" shortcut={`${modKey()} Z`}>
            <Button variant="ghost" size="icon-sm" onClick={editor.undo} aria-label="Deshacer">
              <Undo2 />
            </Button>
          </Tooltip>
          <Tooltip content="Rehacer" shortcut={`${modKey()} ⇧ Z`}>
            <Button variant="ghost" size="icon-sm" onClick={editor.redo} aria-label="Rehacer">
              <Redo2 />
            </Button>
          </Tooltip>
          <AddBlockButton onAdd={(b) => editor.setBlocks([...(editor.active?.blocks ?? []), b])} />
          <Button data-tour="export" variant="ghost" size="sm" onClick={() => setExportOpen(true)} disabled={!resolved.length}>
            <Download /> Exportar
          </Button>
          <Tooltip content="Generar combinaciones" shortcut={`${modKey()} G`}>
            <Button data-tour="generate" size="sm" variant={generatorOpen ? "tonal" : "primary"} onClick={() => setGeneratorOpen(!generatorOpen)}>
              <Sparkles /> Generar
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <LibraryPanel onManual={(code) => setManual({ open: true, code })} />

        <section data-tour="grid" className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-4 overflow-hidden whitespace-nowrap px-5 py-2.5 text-[12.5px] text-on-surface-variant">
            <SummaryItem label="Créditos" value={summary.credits} />
            <SummaryItem label="Asignaturas" value={resolved.length} />
            <SummaryItem label="Días" value={summary.dayCount} />
            <SummaryItem label="Horas" value={summary.hours.toFixed(summary.hours % 1 ? 1 : 0)} />
            {summary.conflicts > 0 && (
              <span className="flex items-center gap-1 font-medium text-error">
                <TriangleAlert className="size-3.5" /> Cruces de horario
              </span>
            )}
            {preview && previewResolved.length > 1 && <span className="ml-auto rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">Vista previa</span>}
          </div>
          <div className="min-h-0 flex-1 px-3 pb-3">
            <div className="h-full rounded-2xl border border-outline-variant/50 bg-surface-lowest px-2 dark:bg-surface-low">
              <WeekGrid events={events} days={days} hours={hours} renderPopover={(e, trigger) => <EventPopover event={e} trigger={trigger} />} />
            </div>
          </div>
        </section>

        <AnimatePresence>{generatorOpen && <GeneratorPanel key="gen" />}</AnimatePresence>
      </div>

      <AddCoursesDialog />
      <ExportDialog />
      <GroupDetailSheet />
      <ManualCourseDialog open={manual.open} code={manual.code} onOpenChange={(open) => setManual((m) => ({ ...m, open }))} />
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span>
      {label} <b className="tabular ml-0.5 font-semibold text-on-surface">{value}</b>
    </span>
  );
}

function EventPopover({ event: e, trigger }: { event: GridEvent; trigger: ReactNode }) {
  const editor = useScheduleEditor();
  const { setGroupDetail, setFocusedCourse } = useUi();
  const [open, setOpen] = useState(false);

  if (e.kind === "block" && e.block) {
    const blocks = editor.active?.blocks ?? [];
    const idx = blocks.indexOf(e.block);
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className="w-72" side="right" align="start">
          <BlockForm
            initial={e.block}
            onSubmit={(b) => (editor.setBlocks(blocks.map((x, i) => (i === idx ? b : x))), setOpen(false))}
            onDelete={() => (editor.setBlocks(blocks.filter((_, i) => i !== idx)), setOpen(false))}
          />
        </PopoverContent>
      </Popover>
    );
  }
  const r = e.source;
  if (!r) return <>{trigger}</>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-80 p-0" side="right" align="start">
        <div className="border-b border-outline-variant/50 p-4">
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <span className="size-2.5 rounded-full" style={{ background: r.color }} />
            {r.course.code} · {groupTag(r.group.id)} · {r.course.credits} cr
          </div>
          <div className="mt-1 text-[15px] font-semibold leading-snug">{r.course.name}</div>
          <div className="tabular mt-1 text-[13px]">
            {DAY_LONG[e.day]} · {hhmm(e.start)}–{hhmm(e.end)}
          </div>
        </div>
        <div className="flex flex-col gap-2 p-4 text-[12.5px]">
          <div className="flex items-start gap-2">
            <UserRound className="mt-0.5 size-3.5 shrink-0 text-on-surface-variant" /> {professorLine(r.group)}
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-on-surface-variant" />
            <span data-selectable>{e.room || "Salón no informado"}</span>
          </div>
          {e.conflict && (
            <div className="flex items-center gap-2 rounded-lg bg-error/10 px-2 py-1.5 text-error">
              <TriangleAlert className="size-3.5" /> Se cruza con otra clase o bloque
            </div>
          )}
        </div>
        <div className={cn("flex gap-1 border-t border-outline-variant/50 p-2")}>
          <Button variant="ghost" size="sm" onClick={() => (setGroupDetail(r.selection), setOpen(false))}>
            <Info /> Detalles
          </Button>
          <Button variant="ghost" size="sm" onClick={() => (setFocusedCourse(r.course.code), setOpen(false))}>
            <Repeat2 /> Cambiar grupo
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto text-error" onClick={() => (editor.removeCourse(r.course.code), setOpen(false))}>
            <CalendarMinus /> Quitar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

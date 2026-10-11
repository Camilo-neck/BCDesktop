import { useState } from "react";
import { Copy, MoreHorizontal, PenLine, Plus, Trash2 } from "lucide-react";
import { Confirm, Menu, MenuContent, MenuItem, MenuTrigger, Tooltip } from "@/components/ui/primitives";
import { useScheduleEditor } from "@/lib/data";
import type { Schedule } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ScheduleTabs() {
  const editor = useScheduleEditor();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);

  return (
    <div data-tour="schedule-tabs" className="scroll-thin flex min-w-0 items-center gap-1 overflow-x-auto">
      {editor.schedules.map((s) => {
        const active = s.id === editor.active?.id;
        return (
          <div
            key={s.id}
            className={cn(
              "group flex h-8 shrink-0 items-center rounded-lg pl-3 pr-1 text-[13px] transition",
              active ? "bg-secondary-container font-medium text-secondary-on-container" : "text-on-surface-variant hover:bg-on-surface/5",
            )}
          >
            {renaming === s.id ? (
              <input
                autoFocus
                defaultValue={s.name}
                className="w-36 bg-transparent outline-none"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== s.name) editor.rename(v);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <button
                className="max-w-[180px] truncate"
                onClick={() => editor.setActive(s.id)}
                onDoubleClick={() => active && setRenaming(s.id)}
                title={active ? "Doble clic para renombrar" : s.name}
              >
                {s.name}
                <span className="tabular ml-1.5 text-[11px] opacity-60">{s.selections.length}</span>
              </button>
            )}
            <Menu>
              <MenuTrigger asChild>
                <button
                  className={cn("ml-0.5 grid size-6 place-items-center rounded-md opacity-0 transition hover:bg-on-surface/10 group-hover:opacity-100", active && "opacity-60")}
                  aria-label="Opciones del horario"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </MenuTrigger>
              <MenuContent align="start">
                <MenuItem onSelect={() => (editor.setActive(s.id), setRenaming(s.id))}>
                  <PenLine /> Renombrar
                </MenuItem>
                <MenuItem onSelect={() => editor.duplicate(s.id)}>
                  <Copy /> Duplicar
                </MenuItem>
                <MenuItem danger disabled={editor.schedules.length === 1} onSelect={() => setDeleting(s)}>
                  <Trash2 /> Eliminar
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        );
      })}
      <Tooltip content="Nuevo horario">
        <button
          onClick={() => editor.create(`Horario ${editor.schedules.length + 1}`)}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-on-surface-variant transition hover:bg-on-surface/5 hover:text-on-surface"
          aria-label="Nuevo horario"
        >
          <Plus className="size-4" />
        </button>
      </Tooltip>
      <Confirm
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`¿Eliminar «${deleting?.name}»?`}
        description="Las asignaturas siguen en tu lista; solo se borra esta combinación."
        confirmLabel="Eliminar"
        danger
        onConfirm={() => deleting && editor.remove(deleting.id)}
      />
    </div>
  );
}

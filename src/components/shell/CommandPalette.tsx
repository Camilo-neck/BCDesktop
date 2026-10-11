import { useNavigate } from "react-router";
import { Command } from "cmdk";
import * as D from "@radix-ui/react-dialog";
import {
  BookPlus,
  CalendarPlus,
  CalendarRange,
  Download,
  GraduationCap,
  House,
  Info,
  Moon,
  RotateCcw,
  Settings,
  Sparkles,
  Waypoints,
} from "lucide-react";
import type { ReactNode } from "react";
import { useLibraryIndex, useScheduleEditor } from "@/lib/data";
import { useSetSetting, useSettings } from "@/lib/settings";
import { useUi } from "@/lib/store";
import { TYPOLOGY } from "@/lib/utils";
import { useTourStore } from "@/components/tour/Tour";

function Item({ icon, children, onSelect, hint, value }: { icon: ReactNode; children: ReactNode; onSelect: () => void; hint?: string; value?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-10 cursor-default items-center gap-3 rounded-xl px-3 text-[13.5px] data-[selected=true]:bg-on-surface/[0.06] [&_svg]:size-4 [&_svg]:text-on-surface-variant"
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-on-surface-variant">{hint}</span>}
    </Command.Item>
  );
}

const groupClass =
  "px-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-on-surface-variant";

export function CommandPalette() {
  const navigate = useNavigate();
  const { paletteOpen, setPaletteOpen, setAddCoursesOpen, setGeneratorOpen, setExportOpen, setFocusedCourse } = useUi();
  const index = useLibraryIndex();
  const editor = useScheduleEditor();
  const { theme } = useSettings();
  const setSetting = useSetSetting();
  const startTour = useTourStore((s) => s.start);

  const run = (fn: () => void) => () => {
    setPaletteOpen(false);
    fn();
  };

  return (
    <D.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[14vh] z-50 w-[min(92vw,600px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-lowest shadow-elev3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] dark:bg-surface-low"
        >
          <D.Title className="sr-only">Paleta de comandos</D.Title>
          <Command loop>
            <Command.Input
              autoFocus
              placeholder="Busca una materia, una vista o una acción…"
              className="h-14 w-full border-b border-outline-variant/60 bg-transparent px-5 text-[15px] outline-none placeholder:text-on-surface-variant/70"
            />
            <Command.List className="scroll-thin max-h-[420px] overflow-y-auto p-2">
              <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">Sin resultados</Command.Empty>

              <Command.Group heading="Acciones" className={groupClass}>
                <Item icon={<BookPlus />} onSelect={run(() => (navigate("/planner"), setAddCoursesOpen(true)))}>
                  Agregar materias del SIA
                </Item>
                <Item icon={<Sparkles />} onSelect={run(() => (navigate("/planner"), setGeneratorOpen(true)))}>
                  Generar horarios
                </Item>
                <Item icon={<CalendarPlus />} onSelect={run(() => (navigate("/planner"), void editor.create(`Horario ${editor.schedules.length + 1}`)))}>
                  Nuevo horario
                </Item>
                <Item icon={<Download />} onSelect={run(() => (navigate("/planner"), setExportOpen(true)))}>
                  Exportar horario al calendario
                </Item>
                <Item icon={<Moon />} onSelect={run(() => setSetting("theme", theme === "dark" ? "light" : "dark"))}>
                  Cambiar tema claro/oscuro
                </Item>
                <Item icon={<RotateCcw />} onSelect={run(() => (navigate("/"), startTour("welcome")))}>
                  Repetir tutorial de bienvenida
                </Item>
              </Command.Group>

              <Command.Group heading="Ir a" className={groupClass}>
                <Item icon={<House />} onSelect={run(() => navigate("/"))}>Inicio</Item>
                <Item icon={<CalendarRange />} onSelect={run(() => navigate("/planner"))}>Planeador</Item>
                <Item icon={<GraduationCap />} onSelect={run(() => navigate("/progress"))}>Mi avance</Item>
                <Item icon={<Waypoints />} onSelect={run(() => navigate("/curriculum"))}>Plan de estudios</Item>
                <Item icon={<Settings />} onSelect={run(() => navigate("/settings"))}>Ajustes</Item>
                <Item icon={<Info />} onSelect={run(() => navigate("/about"))}>Acerca de</Item>
              </Command.Group>

              {editor.schedules.length > 1 && (
                <Command.Group heading="Horarios" className={groupClass}>
                  {editor.schedules.map((s) => (
                    <Item key={s.id} value={`horario ${s.name}`} icon={<CalendarRange />} onSelect={run(() => (navigate("/planner"), void editor.setActive(s.id)))}>
                      {s.name}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {index.items.length > 0 && (
                <Command.Group heading="Mis asignaturas" className={groupClass}>
                  {index.items.map(({ course, color }) => (
                    <Item
                      key={course.code}
                      value={`${course.name} ${course.code}`}
                      hint={`${course.credits} cr · ${TYPOLOGY[course.typology].short}`}
                      icon={<span className="size-2.5 rounded-full" style={{ background: color }} />}
                      onSelect={run(() => (navigate("/planner"), setFocusedCourse(course.code)))}
                    >
                      {course.name}
                    </Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

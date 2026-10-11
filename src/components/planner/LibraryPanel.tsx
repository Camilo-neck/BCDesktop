import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BookPlus,
  Check,
  CalendarMinus,
  ChevronRight,
  Heart,
  Info,
  MoreHorizontal,
  Palette,
  PenLine,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Input, SpotsBadge, TypologyBadge } from "@/components/ui/misc";
import { Confirm, Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { selKey, useLibraryActions, useScheduleEditor } from "@/lib/data";
import { PALETTE } from "@/lib/palette";
import { useUi } from "@/lib/store";
import type { Group, LibraryCourse } from "@/lib/types";
import { ageInDays, cn, groupSchedule, groupTag, normalizeText, professorLine, relativeTime } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

export function LibraryPanel({ onManual }: { onManual: (code?: string) => void }) {
  const editor = useScheduleEditor();
  const { items } = editor.index;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { setAddCoursesOpen, focusedCourse, setFocusedCourse } = useUi();
  const qc = useQueryClient();

  useEffect(() => {
    if (focusedCourse) {
      setOpen(focusedCourse);
      setQuery("");
      setFocusedCourse(null);
      requestAnimationFrame(() => document.getElementById(`course-${focusedCourse}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }, [focusedCourse, setFocusedCourse]);

  const selected = useMemo(() => new Map(editor.active?.selections.map((s) => [s.courseCode, s.groupId]) ?? []), [editor.active]);

  const filtered = useMemo(() => {
    const q = normalizeText(query.trim());
    const list = q ? items.filter((i) => normalizeText(`${i.course.name} ${i.course.code}`).includes(q)) : items;
    // Courses in the schedule first, then alphabetical.
    return [...list].sort((a, b) => Number(selected.has(b.course.code)) - Number(selected.has(a.course.code)) || a.course.name.localeCompare(b.course.name));
  }, [items, query, selected]);

  const stale = items.filter((i) => i.course.source === "sia" && ageInDays(i.course.fetchedAt) > 1).length;

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const r = await api.refreshCourses();
      await qc.invalidateQueries({ queryKey: ["library"] });
      if (r.failed.length) toast.warning(`${r.updated.length} actualizadas, ${r.failed.length} con error`, { description: r.failed[0]?.message });
      else toast.success(`${r.updated.length} asignaturas actualizadas`);
    } catch (e) {
      toast.error("No se pudo actualizar", { description: errorMessage(e) });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section data-tour="library" className="flex min-h-0 w-[340px] shrink-0 flex-col border-r border-outline-variant/50">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <div className="flex-1">
          <h2 className="text-[15px] font-semibold">Asignaturas</h2>
          <p className="text-xs text-on-surface-variant">
            {items.length === 0 ? "Aún no has agregado ninguna" : `${items.length} en tu lista · ${selected.size} en el horario`}
          </p>
        </div>
        <Menu>
          <Tooltip content="Más opciones">
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Más opciones">
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
          </Tooltip>
          <MenuContent align="end">
            <MenuItem onSelect={() => onManual()}>
              <PenLine /> Agregar asignatura manual
            </MenuItem>
            <MenuItem disabled={!items.length || refreshing} onSelect={refreshAll}>
              <RefreshCw /> Actualizar cupos de todas
            </MenuItem>
          </MenuContent>
        </Menu>
        <Button data-tour="add-courses" size="sm" onClick={() => setAddCoursesOpen(true)}>
          <BookPlus /> Agregar
        </Button>
      </div>

      {items.length > 0 && (
        <div className="px-4 pb-2">
          <Input icon={<Search />} placeholder="Filtrar asignaturas" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {stale > 0 && (
        <button
          onClick={refreshAll}
          disabled={refreshing}
          className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-left text-xs text-warning transition hover:bg-warning/15"
        >
          <RefreshCw className={cn("size-3.5 shrink-0", refreshing && "animate-spin")} />
          <span className="flex-1">
            {stale === 1 ? "1 asignatura tiene" : `${stale} asignaturas tienen`} datos de hace más de un día. Actualiza los cupos.
          </span>
        </button>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {items.length === 0 ? (
          <EmptyState
            icon={<BookPlus />}
            title="Tu lista está vacía"
            description="Trae asignaturas del SIA para ver sus grupos, horarios y cupos, o agrega una a mano."
            action={
              <div className="flex flex-col gap-2">
                <Button onClick={() => setAddCoursesOpen(true)}>
                  <BookPlus /> Agregar del SIA
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onManual()}>
                  Agregar manualmente
                </Button>
              </div>
            }
          />
        ) : filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-on-surface-variant">Ninguna asignatura coincide con «{query}».</p>
        ) : (
          filtered.map((item) => (
            <CourseItem
              key={item.course.code}
              item={item}
              open={open === item.course.code}
              onToggle={() => setOpen((o) => (o === item.course.code ? null : item.course.code))}
              selectedGroup={selected.get(item.course.code)}
              onEdit={() => onManual(item.course.code)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function CourseItem({
  item,
  open,
  onToggle,
  selectedGroup,
  onEdit,
}: {
  item: LibraryCourse;
  open: boolean;
  onToggle: () => void;
  selectedGroup?: string;
  onEdit: () => void;
}) {
  const { course, color } = item;
  const editor = useScheduleEditor();
  const actions = useLibraryActions();
  const [filter, setFilter] = useState("");
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const old = course.source === "sia" && ageInDays(course.fetchedAt) > 1;
  const spots = course.groups.reduce((a, g) => a + (g.spots ?? 0), 0);

  const groups = useMemo(() => {
    const q = normalizeText(filter.trim());
    const list = q ? course.groups.filter((g) => normalizeText(`${g.id} ${g.label} ${g.professors.join(" ")}`).includes(q)) : course.groups;
    const fav = (g: Group) => editor.index.favorites.has(selKey({ courseCode: course.code, groupId: g.id }));
    return [...list].sort((a, b) => Number(fav(b)) - Number(fav(a)));
  }, [course, filter, editor.index.favorites]);

  return (
    <div id={`course-${course.code}`} ref={ref} className="mb-1">
      <div
        className={cn(
          "group flex cursor-pointer items-stretch gap-3 rounded-xl px-2.5 py-2.5 transition hover:bg-on-surface/[0.04]",
          open && "bg-on-surface/[0.04]",
        )}
        onClick={onToggle}
      >
        <span className="w-1 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <div className="line-clamp-2 flex-1 text-[13.5px] font-medium leading-snug">{course.name}</div>
            {selectedGroup && (
              <Tooltip content={`${groupTag(selectedGroup)} en el horario`}>
                <Badge className="bg-primary/10 text-primary">
                  <Check /> {groupTag(selectedGroup)}
                </Badge>
              </Tooltip>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-on-surface-variant">
            <span className="tabular">{course.code}</span>
            <span>·</span>
            <span>{course.credits} cr</span>
            <TypologyBadge typology={course.typology} short />
            {course.source === "manual" ? (
              <Badge className="bg-tertiary/10 text-tertiary">Manual</Badge>
            ) : course.groups.length === 0 ? (
              <Badge className="bg-error/10 text-error">Sin grupos</Badge>
            ) : (
              <span className="tabular">
                {course.groups.length} gr · {spots} cupos
              </span>
            )}
            {old && (
              <Tooltip content={`Datos ${relativeTime(course.fetchedAt)}`}>
                <TriangleAlert className="size-3.5 text-warning" />
              </Tooltip>
            )}
          </div>
        </div>
        <ChevronRight className={cn("mt-0.5 size-4 shrink-0 text-on-surface-variant transition-transform", open && "rotate-90")} />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-1 px-2 pb-1 pt-1">
              {course.groups.length > 4 && (
                <Input className="flex-1" placeholder="Filtrar por grupo o profesor" value={filter} onChange={(e) => setFilter(e.target.value)} />
              )}
              <div className={cn("flex items-center gap-0.5", course.groups.length <= 4 && "ml-auto")}>
                <ColorButton color={color} onChange={(c) => actions.setColor(course.code, c)} />
                {course.source === "manual" && (
                  <Tooltip content="Editar">
                    <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Editar">
                      <PenLine />
                    </Button>
                  </Tooltip>
                )}
                {selectedGroup && (
                  <Tooltip content="Quitar del horario">
                    <Button variant="ghost" size="icon-sm" onClick={() => editor.removeCourse(course.code)} aria-label="Quitar del horario">
                      <CalendarMinus />
                    </Button>
                  </Tooltip>
                )}
                <Tooltip content="Eliminar de la lista">
                  <Button variant="ghost" size="icon-sm" onClick={() => setConfirm(true)} aria-label="Eliminar">
                    <Trash2 />
                  </Button>
                </Tooltip>
              </div>
            </div>
            <div className="flex flex-col gap-1 px-1 pb-2">
              {groups.length === 0 && (
                <p className="px-3 py-3 text-xs text-on-surface-variant">
                  {course.groups.length === 0 ? "El SIA no publica grupos para esta asignatura este semestre." : "Ningún grupo coincide."}
                </p>
              )}
              {groups.map((g) => (
                <GroupRow key={g.id} courseCode={course.code} group={g} selected={selectedGroup === g.id} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={`¿Eliminar ${course.name}?`}
        description="Se quitará de tu lista y de todos tus horarios."
        confirmLabel="Eliminar"
        danger
        onConfirm={() => actions.remove(course.code)}
      />
    </div>
  );
}

function GroupRow({ courseCode, group, selected }: { courseCode: string; group: Group; selected: boolean }) {
  const editor = useScheduleEditor();
  const actions = useLibraryActions();
  const { setPreview, setGroupDetail } = useUi();
  const sel = { courseCode, groupId: group.id };
  const fav = editor.index.favorites.has(selKey(sel));
  const clashes = selected ? [] : editor.conflictsWith(courseCode, group);
  const blocked = selected ? [] : editor.blockConflicts(group);
  const noSessions = group.sessions.length === 0;

  return (
    <div
      onMouseEnter={() => !selected && !noSessions && setPreview([sel])}
      onMouseLeave={() => setPreview(null)}
      className={cn(
        "group/row relative flex items-start gap-2.5 rounded-xl border px-2.5 py-2 transition",
        selected ? "border-primary/50 bg-primary/[0.06]" : "border-transparent hover:border-outline-variant/60 hover:bg-surface-lowest dark:hover:bg-surface-container",
      )}
    >
      <button
        onClick={() => editor.selectGroup(courseCode, group.id)}
        className={cn(
          "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border-2 transition",
          selected ? "border-primary bg-primary text-primary-on" : "border-outline hover:border-primary",
        )}
        aria-label={selected ? "Quitar grupo" : "Elegir grupo"}
        aria-pressed={selected}
      >
        {selected && <Check className="size-3" strokeWidth={3} />}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={() => editor.selectGroup(courseCode, group.id)}>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold">{groupTag(group.id)}</span>
          <SpotsBadge spots={group.spots} />
          {clashes.length > 0 && (
            <Tooltip content={`Choca con ${clashes.map((c) => c.course.name).join(", ")}`}>
              <Badge className="bg-error/10 text-error">
                <TriangleAlert /> Choque
              </Badge>
            </Tooltip>
          )}
          {blocked.length > 0 && clashes.length === 0 && (
            <Tooltip content={`Se cruza con ${blocked.map((b) => b.label || "un bloque personal").join(", ")}`}>
              <Badge className="bg-warning/15 text-warning">Bloque</Badge>
            </Tooltip>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-on-surface-variant">
          <Users className="size-3 shrink-0" /> <span className="truncate">{professorLine(group)}</span>
        </div>
        <div className="tabular mt-0.5 text-[11.5px] text-on-surface-variant/90">{groupSchedule(group)}</div>
      </button>
      <div className="flex flex-col items-center gap-0.5">
        <Tooltip content={fav ? "Quitar de favoritos" : "Favorito: el generador lo prefiere"}>
          <button
            onClick={() => actions.toggleFavorite(sel)}
            className={cn("rounded-md p-1 transition hover:bg-on-surface/5", fav ? "text-error" : "text-on-surface-variant/50 group-hover/row:text-on-surface-variant")}
            aria-label="Favorito"
          >
            <Heart className={cn("size-3.5", fav && "fill-current")} />
          </button>
        </Tooltip>
        <Tooltip content="Detalles del grupo">
          <button
            onClick={() => setGroupDetail(sel)}
            className="rounded-md p-1 text-on-surface-variant/50 transition hover:bg-on-surface/5 group-hover/row:text-on-surface-variant"
            aria-label="Detalles"
          >
            <Info className="size-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function ColorButton({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  return (
    <Popover>
      <Tooltip content="Color">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Color">
            <Palette style={{ color }} />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="w-auto p-2" align="end">
        <div className="grid grid-cols-6 gap-1.5">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => onChange(c)}
              className={cn("size-7 rounded-lg ring-offset-2 ring-offset-surface-lowest transition hover:scale-110", c === color && "ring-2 ring-on-surface")}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
        </div>
        <div className="my-2 h-px bg-outline-variant/60" />
        <label className="mt-1 flex items-center gap-2 px-1 text-xs text-on-surface-variant">
          Otro
          <input type="color" value={color} onChange={(e) => onChange(e.target.value)} className="h-6 w-10 cursor-pointer rounded border-0 bg-transparent" />
        </label>
      </PopoverContent>
    </Popover>
  );
}


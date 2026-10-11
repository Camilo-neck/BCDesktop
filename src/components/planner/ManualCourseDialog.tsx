import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/misc";
import { Select } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { useLibraryActions, useLibraryIndex } from "@/lib/data";
import { DAYS, type Course, type Group, type Session, type Typology } from "@/lib/types";
import { DAY_LONG, hhmm, parseHHMM, TYPOLOGY } from "@/lib/utils";

const emptySession = (): Session => ({ day: "MON", start: 7 * 60, end: 9 * 60, room: "" });
const emptyGroup = (n: number): Group => ({
  id: String(n),
  label: `Grupo ${n}`,
  professors: [],
  faculty: "",
  sessions: [emptySession()],
  duration: "",
  shift: "",
  spots: null,
  startsOn: null,
  endsOn: null,
});

/** Create or edit a course the SIA does not list (or that the student wants to plan by hand). */
export function ManualCourseDialog({ code, open, onOpenChange }: { code?: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const index = useLibraryIndex();
  const actions = useLibraryActions();
  const [course, setCourse] = useState<Course>(() => blank());
  const [saving, setSaving] = useState(false);

  function blank(): Course {
    return { code: "", name: "", credits: 3, typology: "LIBRE_ELECCION", groups: [emptyGroup(1)], fetchedAt: new Date().toISOString(), source: "manual", career: null };
  }

  useEffect(() => {
    if (!open) return;
    const existing = code ? index.byCode.get(code)?.course : undefined;
    setCourse(existing ? structuredClone(existing) : blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, code]);

  const patchGroup = (gi: number, patch: Partial<Group>) =>
    setCourse((c) => ({ ...c, groups: c.groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) }));
  const patchSession = (gi: number, si: number, patch: Partial<Session>) =>
    patchGroup(gi, { sessions: course.groups[gi].sessions.map((s, i) => (i === si ? { ...s, ...patch } : s)) });

  const save = async () => {
    const bad = course.groups.flatMap((g) => g.sessions).find((s) => s.end <= s.start);
    if (bad) return toast.error("Hay una sesión que termina antes de empezar");
    setSaving(true);
    try {
      await actions.saveManual({
        ...course,
        code: course.code.trim(),
        name: course.name.trim(),
        groups: course.groups.map((g) => ({ ...g, label: g.label || `Grupo ${g.id}` })),
      });
      toast.success(code ? "Asignatura actualizada" : "Asignatura agregada");
      onOpenChange(false);
    } catch (e) {
      toast.error("No se pudo guardar", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,720px)]">
        <DialogHeader>
          <DialogTitle>{code ? "Editar asignatura manual" : "Agregar asignatura manual"}</DialogTitle>
          <DialogDescription>Útil para cursos de otra sede, intersemestrales o actividades que quieras ver en tu semana.</DialogDescription>
        </DialogHeader>
        <div className="scroll-thin flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-6 pb-5">
          <div className="grid grid-cols-[1fr_160px] gap-3">
            <div>
              <Label>Nombre</Label>
              <Input value={course.name} onChange={(e) => setCourse({ ...course, name: e.target.value })} placeholder="Ej. Cálculo diferencial" autoFocus />
            </div>
            <div>
              <Label>Código</Label>
              <Input value={course.code} disabled={!!code} onChange={(e) => setCourse({ ...course, code: e.target.value })} placeholder="1000004-B" />
            </div>
            <div>
              <Label>Tipología</Label>
              <Select
                value={course.typology}
                onValueChange={(v) => setCourse({ ...course, typology: v as Typology })}
                options={Object.entries(TYPOLOGY).map(([value, t]) => ({ value, label: t.label }))}
              />
            </div>
            <div>
              <Label>Créditos</Label>
              <Input type="number" min={0} max={20} value={course.credits} onChange={(e) => setCourse({ ...course, credits: Number(e.target.value) })} />
            </div>
          </div>

          {course.groups.map((g, gi) => (
            <div key={gi} className="rounded-2xl border border-outline-variant/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Input className="w-24" value={g.id} onChange={(e) => patchGroup(gi, { id: e.target.value })} aria-label="Grupo" />
                <Input
                  className="flex-1"
                  placeholder="Profesor (opcional)"
                  value={g.professors.join(", ")}
                  onChange={(e) => patchGroup(gi, { professors: e.target.value ? [e.target.value] : [] })}
                />
                {course.groups.length > 1 && (
                  <Button variant="ghost" size="icon-sm" onClick={() => setCourse({ ...course, groups: course.groups.filter((_, i) => i !== gi) })} aria-label="Eliminar grupo">
                    <Trash2 />
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {g.sessions.map((s, si) => (
                  <div key={si} className="grid grid-cols-[140px_100px_100px_1fr_auto] items-center gap-2">
                    <Select value={s.day} onValueChange={(v) => patchSession(gi, si, { day: v as Session["day"] })} options={DAYS.map((d) => ({ value: d, label: DAY_LONG[d] }))} />
                    <Input type="time" value={hhmm(s.start)} onChange={(e) => patchSession(gi, si, { start: parseHHMM(e.target.value) ?? s.start })} />
                    <Input type="time" value={hhmm(s.end)} onChange={(e) => patchSession(gi, si, { end: parseHHMM(e.target.value) ?? s.end })} />
                    <Input placeholder="Salón" value={s.room} onChange={(e) => patchSession(gi, si, { room: e.target.value })} />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={g.sessions.length === 1}
                      onClick={() => patchGroup(gi, { sessions: g.sessions.filter((_, i) => i !== si) })}
                      aria-label="Quitar sesión"
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="self-start" onClick={() => patchGroup(gi, { sessions: [...g.sessions, emptySession()] })}>
                  <Plus /> Sesión
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" className="self-start" onClick={() => setCourse({ ...course, groups: [...course.groups, emptyGroup(course.groups.length + 1)] })}>
            <Plus /> Otro grupo
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!course.name.trim() || !course.code.trim()}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

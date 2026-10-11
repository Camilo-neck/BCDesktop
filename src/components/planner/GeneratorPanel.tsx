import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { CalendarCheck2, CalendarPlus, Heart, Info, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Input, Label, Segmented } from "@/components/ui/misc";
import { Checkbox, Slider, Switch, Tooltip } from "@/components/ui/primitives";
import { useAutoTour } from "@/components/tour/Tour";
import { api, errorMessage } from "@/lib/api";
import { resolve, useScheduleEditor } from "@/lib/data";
import { useSettings } from "@/lib/settings";
import { useUi } from "@/lib/store";
import { DAYS, type Day, type GenerateResult, type TimeOfDay } from "@/lib/types";
import { cn, DAY_SHORT, hhmm } from "@/lib/utils";
import { eventsFrom, WeekGrid } from "./WeekGrid";

const WEIGHTS = [
  { value: "0", label: "No importa" },
  { value: "1", label: "Algo" },
  { value: "3", label: "Mucho" },
];

export function GeneratorPanel() {
  const editor = useScheduleEditor();
  const settings = useSettings();
  const { setGeneratorOpen, setPreview } = useUi();
  const candidates = editor.index.items.filter((i) => i.course.groups.some((g) => g.sessions.length > 0));
  const [chosen, setChosen] = useState<Set<string>>(() => {
    const inSchedule = new Set(editor.active?.selections.map((s) => s.courseCode));
    const base = candidates.filter((c) => inSchedule.has(c.course.code));
    return new Set((base.length ? base : candidates).map((c) => c.course.code));
  });
  const [days, setDays] = useState<Day[]>(["MON", "TUE", "WED", "THU", "FRI", "SAT"]);
  const [range, setRange] = useState<[number, number]>([settings.gridHours[0], settings.gridHours[1]]);
  const [maxCredits, setMaxCredits] = useState("");
  const [onlySpots, setOnlySpots] = useState(true);
  const [keepCurrent, setKeepCurrent] = useState(false);
  const [gaps, setGaps] = useState("3");
  const [dayWeight, setDayWeight] = useState("1");
  const [tod, setTod] = useState<TimeOfDay>("any");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [running, setRunning] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  useAutoTour("generator");

  const credits = useMemo(() => candidates.filter((c) => chosen.has(c.course.code)).reduce((a, c) => a + c.course.credits, 0), [candidates, chosen]);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const courses = candidates.filter((c) => chosen.has(c.course.code)).map((c) => c.course);
      const r = await api.generate({
        courses,
        constraints: {
          days,
          window: [range[0] * 60, range[1] * 60],
          maxCredits: maxCredits ? Number(maxCredits) : null,
          onlyWithSpots: onlySpots,
          blocks: editor.active?.blocks ?? [],
          locked: keepCurrent ? (editor.active?.selections ?? []).filter((s) => chosen.has(s.courseCode)) : [],
          excluded: [],
        },
        preferences: {
          gaps: Number(gaps),
          days: Number(dayWeight),
          timeOfDay: tod,
          favorites: [...editor.index.favorites].map((k) => {
            const [courseCode, groupId] = k.split("::");
            return { courseCode, groupId };
          }),
          spots: 0.3,
        },
        limit: 40,
      });
      setResult(r);
      if (!r.schedules.length) toast.error("No hay combinaciones posibles con esos filtros");
    } catch (e) {
      toast.error("El generador falló", { description: errorMessage(e) });
    } finally {
      setRunning(false);
    }
  };

  const nameOf = (code: string) => editor.index.byCode.get(code)?.course.name ?? code;

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 400, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-outline-variant/50 bg-surface-low/60 dark:bg-surface-low"
    >
      <div className="flex w-[400px] items-center gap-2 border-b border-outline-variant/50 px-4 py-3">
        <Sparkles className="size-4 text-primary" />
        <h2 className="flex-1 text-[15px] font-semibold">Generador de horarios</h2>
        <Button variant="ghost" size="icon-sm" onClick={() => (setPreview(null), setGeneratorOpen(false))} aria-label="Cerrar">
          <X />
        </Button>
      </div>

      <div className="scroll-thin min-h-0 w-[400px] flex-1 overflow-y-auto">
        {candidates.length === 0 ? (
          <EmptyState icon={<Sparkles />} title="Primero agrega asignaturas" description="El generador combina los grupos de las materias de tu lista." />
        ) : (
          <div className="flex flex-col gap-5 p-4">
            <section data-tour="gen-courses">
              <Label hint={`${chosen.size} · ${credits} créditos`}>Asignaturas</Label>
              <div className="flex flex-col gap-0.5 rounded-xl border border-outline-variant/60 bg-surface-lowest p-1 dark:bg-surface-container">
                {candidates.map(({ course, color }) => (
                  <label key={course.code} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-on-surface/[0.04]">
                    <Checkbox
                      checked={chosen.has(course.code)}
                      onCheckedChange={(v) =>
                        setChosen((s) => {
                          const n = new Set(s);
                          if (v) n.add(course.code);
                          else n.delete(course.code);
                          return n;
                        })
                      }
                    />
                    <span className="size-2 rounded-full" style={{ background: color }} />
                    <span className="flex-1 truncate text-[13px]">{course.name}</span>
                    <span className="tabular text-[11px] text-on-surface-variant">{course.groups.length} gr</span>
                  </label>
                ))}
              </div>
            </section>

            <section data-tour="gen-constraints" className="flex flex-col gap-3">
              <div>
                <Label>Días disponibles</Label>
                <div className="flex gap-1">
                  {DAYS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))}
                      className={cn(
                        "h-8 flex-1 rounded-lg border text-xs font-medium transition",
                        days.includes(d) ? "border-primary bg-primary/10 text-primary" : "border-outline-variant/70 text-on-surface-variant hover:bg-on-surface/5",
                      )}
                    >
                      {DAY_SHORT[d]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label hint={`${hhmm(range[0] * 60)} – ${hhmm(range[1] * 60)}`}>Franja horaria</Label>
                <Slider min={5} max={23} step={1} value={range} onValueChange={(v) => setRange([v[0], v[1]] as [number, number])} minStepsBetweenThumbs={1} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Máximo de créditos</Label>
                  <Input type="number" min={0} placeholder="Sin tope" value={maxCredits} onChange={(e) => setMaxCredits(e.target.value)} />
                </div>
                <div className="flex flex-col justify-end gap-2 pb-1">
                  <label className="flex items-center justify-between gap-2 text-[13px]">
                    Solo con cupos <Switch checked={onlySpots} onCheckedChange={setOnlySpots} />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-[13px]">
                    <Tooltip content="Conserva los grupos que ya elegiste en el horario">
                      <span>Fijar elegidos</span>
                    </Tooltip>
                    <Switch checked={keepCurrent} onCheckedChange={setKeepCurrent} />
                  </label>
                </div>
              </div>
              {!!editor.active?.blocks.length && (
                <p className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                  <Info className="size-3.5" /> Se respetan tus {editor.active.blocks.length} bloques personales.
                </p>
              )}
            </section>

            <section data-tour="gen-preferences" className="flex flex-col gap-3">
              <div>
                <Label>Evitar huecos entre clases</Label>
                <Segmented value={gaps} onChange={setGaps} options={WEIGHTS} className="w-full" />
              </div>
              <div>
                <Label>Ir menos días al campus</Label>
                <Segmented value={dayWeight} onChange={setDayWeight} options={WEIGHTS} className="w-full" />
              </div>
              <div>
                <Label>Jornada preferida</Label>
                <Segmented
                  value={tod}
                  onChange={setTod}
                  className="w-full"
                  options={[
                    { value: "any", label: "Cualquiera" },
                    { value: "morning", label: "Mañana" },
                    { value: "afternoon", label: "Tarde" },
                    { value: "evening", label: "Noche" },
                  ]}
                />
              </div>
            </section>

            {result && (
              <section className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[13px] font-semibold">
                    {result.schedules.length} {result.schedules.length === 1 ? "opción" : "opciones"}
                  </h3>
                  <span className="tabular text-[11px] text-on-surface-variant">{result.explored.toLocaleString("es")} combinaciones evaluadas</span>
                </div>
                {!result.complete && result.schedules.length > 0 && (
                  <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
                    No caben todas a la vez. Estas opciones incluyen el máximo posible ({result.schedules[0].selections.length} de{" "}
                    {result.schedules[0].selections.length + result.schedules[0].omitted.length}).
                  </p>
                )}
                {result.unschedulable.map((u) => (
                  <p key={u.code} className="rounded-xl bg-error/10 px-3 py-2 text-xs text-error">
                    <b>{u.name}</b>: {u.reason}
                  </p>
                ))}
                {result.truncated && <p className="text-xs text-on-surface-variant">Búsqueda recortada: agrega filtros para explorar todo.</p>}
                {result.schedules.map((s, i) => {
                  const resolved = resolve(editor.index, s.selections);
                  return (
                    <div
                      key={i}
                      onMouseEnter={() => (setHovered(i), setPreview(s.selections))}
                      onMouseLeave={() => (setHovered(null), setPreview(null))}
                      className={cn(
                        "rounded-2xl border bg-surface-lowest p-3 transition dark:bg-surface-container",
                        hovered === i ? "border-primary/60 shadow-elev2" : "border-outline-variant/60",
                      )}
                    >
                      <div className="mb-2 flex items-center gap-1.5">
                        <span className="text-[13px] font-semibold">Opción {i + 1}</span>
                        <div className="ml-auto flex flex-wrap justify-end gap-1">
                          <Badge className="bg-surface-high">{s.metrics.days} días</Badge>
                          <Badge className="bg-surface-high">{(s.metrics.gapMinutes / 60).toFixed(1)} h huecos</Badge>
                          <Badge className="bg-surface-high">
                            {hhmm(s.metrics.earliest)}–{hhmm(s.metrics.latest)}
                          </Badge>
                          {s.metrics.favorites > 0 && (
                            <Badge className="bg-error/10 text-error">
                              <Heart className="fill-current" /> {s.metrics.favorites}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="h-[118px] overflow-hidden rounded-lg border border-outline-variant/40">
                        <WeekGrid compact events={eventsFrom(resolved)} days={DAYS.filter((d) => d !== "SUN")} hours={[Math.floor(s.metrics.earliest / 60), Math.ceil(s.metrics.latest / 60)]} />
                      </div>
                      {s.omitted.length > 0 && <p className="mt-2 text-[11.5px] text-on-surface-variant">Sin: {s.omitted.map(nameOf).join(", ")}</p>}
                      <div className="mt-2 flex gap-1.5">
                        <Button size="sm" className="flex-1" onClick={() => (editor.replaceSelections(s.selections), toast.success("Horario actualizado", { action: { label: "Deshacer", onClick: editor.undo } }))}>
                          <CalendarCheck2 /> Aplicar
                        </Button>
                        <Button size="sm" variant="tonal" onClick={() => editor.create(`Opción ${i + 1}`, s.selections).then(() => toast.success("Guardado como horario nuevo"))}>
                          <CalendarPlus /> Nuevo
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </div>
        )}
      </div>

      {candidates.length > 0 && (
        <div className="w-[400px] border-t border-outline-variant/50 p-3">
          <Button data-tour="gen-run" className="w-full" size="lg" onClick={run} loading={running} disabled={chosen.size === 0 || days.length === 0}>
            <Sparkles /> {result ? "Generar de nuevo" : "Generar horarios"}
          </Button>
        </div>
      )}
    </motion.aside>
  );
}

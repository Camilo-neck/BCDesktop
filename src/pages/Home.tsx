import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookPlus, CalendarClock, ClipboardPaste, MapPin, Sparkles, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import { eventsFrom, WeekGrid } from "@/components/planner/WeekGrid";
import { api } from "@/lib/api";
import { useScheduleEditor } from "@/lib/data";
import { useUi } from "@/lib/store";
import { DAYS } from "@/lib/types";
import { DAY_LONG, formatAvg, hhmm, relativeTime } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export function HomePage() {
  const navigate = useNavigate();
  const editor = useScheduleEditor();
  const setAddCoursesOpen = useUi((s) => s.setAddCoursesOpen);
  const setGeneratorOpen = useUi((s) => s.setGeneratorOpen);
  const history = useQuery({ queryKey: ["history"], queryFn: api.latestHistory, staleTime: Infinity });
  const h = history.data?.history;

  const credits = editor.resolved.reduce((a, r) => a + r.course.credits, 0);
  const events = useMemo(() => eventsFrom(editor.resolved), [editor.resolved]);

  // Next class from now, wrapping around the week.
  const next = useMemo(() => {
    const now = new Date();
    const today = (now.getDay() + 6) % 7;
    const minute = now.getHours() * 60 + now.getMinutes();
    const ranked = events
      .map((e) => {
        const d = DAYS.indexOf(e.day);
        let delta = (d - today) * 1440 + (e.start - minute);
        if (delta < 0) delta += 7 * 1440;
        return { e, delta };
      })
      .sort((a, b) => a.delta - b.delta);
    return ranked[0];
  }, [events]);

  const lastFetch = editor.index.items.map((i) => i.course.fetchedAt).sort().at(-1);
  const total = h?.credits["TOTAL"];

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm text-on-surface-variant">{new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {greeting()}
              {h?.username ? `, ${h.username}` : ""}
            </h1>
          </div>
          <div className="flex gap-2">
            <Button variant="tonal" onClick={() => (navigate("/planner"), setAddCoursesOpen(true))}>
              <BookPlus /> Agregar materias
            </Button>
            <Button onClick={() => (navigate("/planner"), setGeneratorOpen(true))}>
              <Sparkles /> Generar horario
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="card col-span-2 flex flex-col p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold">{editor.active?.name ?? "Mi horario"}</h2>
                <p className="text-xs text-on-surface-variant">
                  {editor.resolved.length} asignaturas · {credits} créditos
                  {lastFetch && ` · datos del SIA ${relativeTime(lastFetch)}`}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate("/planner")}>
                Abrir planeador <ArrowRight />
              </Button>
            </div>
            {editor.resolved.length ? (
              <div className="h-64 rounded-xl border border-outline-variant/40">
                <WeekGrid compact events={events} days={DAYS.filter((d) => d !== "SUN")} hours={[6, 22]} />
              </div>
            ) : (
              <div className="grid h-64 place-items-center rounded-xl border border-dashed border-outline-variant text-center">
                <div>
                  <p className="text-sm font-medium">Tu semana está vacía</p>
                  <p className="mt-1 text-xs text-on-surface-variant">Agrega materias del SIA y elige sus grupos.</p>
                  <Button className="mt-4" size="sm" variant="tonal" onClick={() => (navigate("/planner"), setAddCoursesOpen(true))}>
                    <BookPlus /> Empezar
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="card p-5">
              <div className="flex items-center gap-2 text-xs font-medium text-on-surface-variant">
                <CalendarClock className="size-4 text-primary" /> Próxima clase
              </div>
              {next ? (
                <>
                  <div className="mt-2 text-[15px] font-semibold leading-snug">{next.e.title}</div>
                  <div className="tabular mt-1 text-sm">
                    {next.delta < 1440 && DAYS.indexOf(next.e.day) === (new Date().getDay() + 6) % 7 ? "Hoy" : DAY_LONG[next.e.day]} · {hhmm(next.e.start)}–{hhmm(next.e.end)}
                  </div>
                  {next.e.room && (
                    <div className="mt-1.5 flex items-start gap-1 text-xs text-on-surface-variant">
                      <MapPin className="mt-0.5 size-3 shrink-0" /> <span className="line-clamp-2">{next.e.room}</span>
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm text-on-surface-variant">Cuando armes tu horario, aquí verás tu siguiente clase.</p>
              )}
            </div>

            <div className="card flex-1 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-on-surface-variant">Tu avance</span>
                <button onClick={() => navigate("/progress")} className="text-xs font-medium text-primary hover:underline">
                  {h ? "Ver detalle" : "Cargar historia"}
                </button>
              </div>
              {h && total ? (
                <>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="tabular text-3xl font-semibold">{h.progress.toFixed(1)}%</span>
                    <span className="text-xs text-on-surface-variant">
                      {total.approved}/{total.required} créditos
                    </span>
                  </div>
                  <Progress className="mt-2" value={h.progress} />
                  <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-xl bg-surface-container py-2">
                      <div className="text-[11px] text-on-surface-variant">P.A.P.A.</div>
                      <div className="tabular text-lg font-semibold">{formatAvg(h.papa)}</div>
                    </div>
                    <div className="rounded-xl bg-surface-container py-2">
                      <div className="text-[11px] text-on-surface-variant">P.A.</div>
                      <div className="tabular text-lg font-semibold">{formatAvg(h.pa)}</div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-3">
                  <p className="text-sm text-on-surface-variant">Pega tu historia académica del SIA para ver tu P.A.P.A., avance y proyecciones.</p>
                  <Button className="mt-3" size="sm" variant="tonal" onClick={() => navigate("/progress")}>
                    <ClipboardPaste /> Cargar historia
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <QuickLink
            icon={<Sparkles />}
            title="Generador de horarios"
            body="Combina todos los grupos sin choques y ordénalos por huecos, días o jornada."
            onClick={() => (navigate("/planner"), setGeneratorOpen(true))}
          />
          <QuickLink icon={<Waypoints />} title="Mapa de prerrequisitos" body="Visualiza qué materias habilita cada una y cuáles ya puedes ver." onClick={() => navigate("/curriculum")} />
          <QuickLink icon={<ClipboardPaste />} title="Calculadora de P.A.P.A." body="¿Qué PAPI necesitas el próximo semestre para llegar a tu meta?" onClick={() => navigate("/progress")} />
        </div>
      </div>
    </div>
  );
}

function QuickLink({ icon, title, body, onClick }: { icon: React.ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card group flex items-start gap-3 p-5 text-left transition hover:border-primary/40 hover:shadow-elev2">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">{icon}</span>
      <span className="flex-1">
        <span className="flex items-center gap-1 text-[14px] font-semibold">
          {title} <ArrowRight className="size-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-on-surface-variant">{body}</span>
      </span>
    </button>
  );
}

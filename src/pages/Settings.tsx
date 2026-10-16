import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { openPath } from "@tauri-apps/plugin-opener";
import { CalendarDays, Database, FolderOpen, Laptop, Moon, Palette, RefreshCw, RotateCcw, Sun, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Segmented } from "@/components/ui/misc";
import { Confirm, Slider, Switch } from "@/components/ui/primitives";
import { useTourStore } from "@/components/tour/Tour";
import { TOURS, type TourId } from "@/components/tour/tours";
import { api, errorMessage } from "@/lib/api";
import { useSetSetting, useSettings, type Theme } from "@/lib/settings";
import { careerKey } from "@/components/planner/CareerPicker";
import { checkForUpdates, downloadInBackground, useUpdater, type UpdatePhase } from "@/lib/updater";

const TOUR_NAMES: Record<TourId, string> = {
  welcome: "Bienvenida",
  planner: "Planeador",
  addCourses: "Agregar asignaturas",
  generator: "Generador",
  progress: "Mi avance",
  curriculum: "Plan de estudios",
};
const TOUR_ROUTES: Record<TourId, string> = {
  welcome: "/",
  planner: "/planner",
  addCourses: "/planner",
  generator: "/planner",
  progress: "/progress",
  curriculum: "/curriculum",
};

function Section({ id, icon, title, description, children }: { id?: string; icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-6 p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-[18px]">{icon}</span>
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-on-surface-variant">{description}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div>
        <div className="text-[13.5px] font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-xs text-on-surface-variant">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function updateHint(phase: UpdatePhase, version: string | undefined, upToDate: boolean, pct: number) {
  switch (phase) {
    case "checking":
      return "Buscando actualizaciones…";
    case "available":
      return `La versión ${version} está disponible.`;
    case "downloading":
      return `Descargando la versión ${version}${pct ? ` · ${pct} %` : "…"}`;
    case "ready":
      return `La versión ${version} se instalará al cerrar la app.`;
    case "installing":
      return "Instalando…";
    default:
      return upToDate ? "Tienes la última versión." : "Las nuevas versiones se publican en GitHub.";
  }
}

function UpdatesSection() {
  const s = useSettings();
  const set = useSetSetting();
  const info = useQuery({ queryKey: ["appInfo"], queryFn: api.appInfo, staleTime: Infinity });
  const { phase, update, received, total, upToDateAt, setDialogOpen } = useUpdater();
  const pct = total ? Math.round((received / total) * 100) : 0;
  return (
    <Section id="updates" icon={<RefreshCw />} title="Actualizaciones">
      <Row title={`BetterCampus ${info.data?.version ?? ""}`} hint={updateHint(phase, update?.version, !!upToDateAt, pct)}>
        {update ? (
          <Button variant="tonal" size="sm" onClick={() => setDialogOpen(true)}>
            Ver actualización
          </Button>
        ) : (
          <Button variant="outline" size="sm" loading={phase === "checking"} onClick={() => void checkForUpdates(true)}>
            Buscar actualizaciones
          </Button>
        )}
      </Row>
      <Row title="Actualizar automáticamente" hint="Descarga las nuevas versiones en segundo plano y las instala al cerrar la app, sin preguntar.">
        <Switch
          checked={s.autoUpdate}
          onCheckedChange={async (v) => {
            await set("autoUpdate", v);
            if (v) void downloadInBackground();
          }}
        />
      </Row>
    </Section>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const set = useSetSetting();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const info = useQuery({ queryKey: ["appInfo"], queryFn: api.appInfo, staleTime: Infinity });
  const startTour = useTourStore((x) => x.start);
  const [reset, setReset] = useState<null | "data" | "all">(null);

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [location.hash]);

  const doReset = async () => {
    try {
      await api.resetData(reset === "all");
      await qc.invalidateQueries();
      toast.success(reset === "all" ? "BetterCampus quedó como recién instalado" : "Datos borrados");
    } catch (e) {
      toast.error("No se pudo borrar", { description: errorMessage(e) });
    }
  };

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-7">
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>

        <Section icon={<Palette />} title="Apariencia">
          <Row title="Tema">
            <Segmented<Theme>
              value={s.theme}
              onChange={(v) => set("theme", v)}
              options={[
                { value: "light", label: <><Sun /> Claro</> },
                { value: "dark", label: <><Moon /> Oscuro</> },
                { value: "system", label: <><Laptop /> Sistema</> },
              ]}
            />
          </Row>
        </Section>

        <Section icon={<CalendarDays />} title="Planeador" description="Cómo se ve tu semana y qué carrera se propone al agregar materias.">
          <div>
            <Label hint={`${s.gridHours[0]}:00 – ${s.gridHours[1]}:00`}>Horas visibles en la grilla</Label>
            <Slider min={5} max={23} step={1} value={s.gridHours} onValueChange={(v) => set("gridHours", [v[0], v[1]] as [number, number])} minStepsBetweenThumbs={4} />
          </div>
          <Row title="Mostrar sábado" hint="El domingo aparece solo si tienes clases ese día.">
            <Switch checked={s.showWeekend} onCheckedChange={(v) => set("showWeekend", v)} />
          </Row>
          <Row title="Carrera por defecto" hint={s.defaultCareer ? s.defaultCareer.name || careerKey(s.defaultCareer) : "Márcala con la estrella al elegir tu plan."}>
            {s.defaultCareer && (
              <Button variant="ghost" size="sm" onClick={() => set("defaultCareer", null)}>
                Quitar
              </Button>
            )}
          </Row>
        </Section>

        <Section icon={<CalendarDays />} title="Semestre" description="Fechas que se usan al exportar cuando el SIA no publica las de un grupo.">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Inicio</Label>
              <Input type="date" value={s.term.from} onChange={(e) => set("term", { ...s.term, from: e.target.value })} />
            </div>
            <div>
              <Label>Fin</Label>
              <Input type="date" value={s.term.until} onChange={(e) => set("term", { ...s.term, until: e.target.value })} />
            </div>
          </div>
        </Section>

        <UpdatesSection />

        <Section icon={<RotateCcw />} title="Tutoriales" description="Repite el recorrido guiado de cualquier función.">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TOURS) as TourId[]).map((id) => (
              <button
                key={id}
                onClick={async () => {
                  await set("tours", { ...s.tours, [id]: false });
                  navigate(TOUR_ROUTES[id]);
                  if (id === "welcome" || id === "planner" || id === "progress" || id === "curriculum") setTimeout(() => startTour(id), 400);
                }}
                className="flex items-center justify-between rounded-xl border border-outline-variant/60 px-3 py-2.5 text-left text-[13px] transition hover:bg-on-surface/[0.04]"
              >
                {TOUR_NAMES[id]}
                <span className="text-xs text-on-surface-variant">{s.tours[id] ? "Visto" : "Pendiente"}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section icon={<Database />} title="Datos" description="Todo se guarda en una base de datos local en este equipo.">
          <Row title="Carpeta de datos" hint={<span className="font-mono text-[11px]" data-selectable>{info.data?.dataDir}</span>}>
            <Button variant="ghost" size="sm" onClick={() => info.data && openPath(info.data.dataDir)}>
              <FolderOpen /> Abrir
            </Button>
          </Row>
          <Row title="Caché del SIA" hint="Listas de carreras y ofertas consultadas. Se renuevan solas.">
            <Button variant="outline" size="sm" onClick={async () => toast.success(`${await api.clearCache()} entradas eliminadas`)}>
              Limpiar caché
            </Button>
          </Row>
          <Row title="Borrar mis datos" hint="Asignaturas, horarios, historia y planes descargados.">
            <Button variant="outline" size="sm" className="text-error" onClick={() => setReset("data")}>
              <Trash2 /> Borrar
            </Button>
          </Row>
          <Row title="Restablecer todo" hint="Además borra ajustes y desconecta Google.">
            <Button variant="danger" size="sm" onClick={() => setReset("all")}>
              Restablecer
            </Button>
          </Row>
        </Section>

        <p className="pb-4 text-center text-xs text-on-surface-variant">
          BetterCampus {info.data?.version} · {info.data?.os} {info.data?.arch}
        </p>
      </div>
      <Confirm
        open={!!reset}
        onOpenChange={(o) => !o && setReset(null)}
        title={reset === "all" ? "¿Restablecer BetterCampus?" : "¿Borrar tus datos?"}
        description="Esta acción no se puede deshacer."
        confirmLabel={reset === "all" ? "Restablecer" : "Borrar"}
        danger
        onConfirm={doReset}
      />
    </div>
  );
}

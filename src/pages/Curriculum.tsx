import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Search, Trash2, Waypoints, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge, EmptyState, Input, Skeleton, TypologyBadge } from "@/components/ui/misc";
import { Confirm, Select, Switch } from "@/components/ui/primitives";
import { CareerPicker } from "@/components/planner/CareerPicker";
import { GraphView } from "@/components/curriculum/GraphView";
import { useAutoTour } from "@/components/tour/Tour";
import { api, errorMessage } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import type { CareerRef, CurriculumGraph, GraphNode } from "@/lib/types";
import { normalizeText, relativeTime } from "@/lib/utils";

const CONDITION_TEXT: Record<string, string> = {
  M: "No se puede inscribir sin aprobarlas",
  O: "Se puede inscribir, pero no ser calificada sin aprobarlas",
  A: "Anulación si no se aprueba la asignatura llave",
  I: "Asignaturas incluyentes (simultáneas)",
  E: "Excluyentes: se ven a la vez o ya se vieron",
  D: "Diferido",
};

export function CurriculumPage() {
  const qc = useQueryClient();
  const settings = useSettings();
  const plans = useQuery({ queryKey: ["plans"], queryFn: api.downloadedPlans, staleTime: Infinity });
  const history = useQuery({ queryKey: ["history"], queryFn: api.latestHistory, staleTime: Infinity });
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [hideLeveling, setHideLeveling] = useState(true);
  const [hideExternal, setHideExternal] = useState(true);
  const [withHistory, setWithHistory] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useAutoTour("curriculum", plans.isSuccess);

  useEffect(() => {
    if (!planKey && plans.data?.length) setPlanKey(plans.data[0].careerKey);
  }, [planKey, plans.data]);

  const graph = useQuery({
    queryKey: ["graph", planKey, hideLeveling, hideExternal, withHistory && !!history.data],
    queryFn: () => api.planGraph(planKey!, { hideLeveling, hideExternal }, withHistory && !!history.data),
    enabled: !!planKey,
    placeholderData: (prev) => prev,
  });

  const matches = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q || !graph.data) return [];
    return graph.data.nodes.filter((n) => normalizeText(`${n.name} ${n.code}`).includes(q)).slice(0, 8);
  }, [query, graph.data]);

  const plan = plans.data?.find((p) => p.careerKey === planKey);
  const node = selected ? graph.data?.nodes.find((n) => n.code === selected) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-outline-variant/50 px-5 py-2.5">
        <h1 className="shrink-0 text-lg font-semibold tracking-tight">Plan de estudios</h1>
        <div data-tour="plan-picker" className="flex items-center gap-2">
          {!!plans.data?.length && (
            <Select
              className="h-9 w-80"
              value={planKey ?? undefined}
              onValueChange={(v) => (setPlanKey(v), setSelected(null))}
              options={plans.data.map((p) => ({ value: p.careerKey, label: p.careerName }))}
            />
          )}
          <Button size="sm" variant={plans.data?.length ? "ghost" : "primary"} onClick={() => setDownloadOpen(true)}>
            <CloudDownload /> {plans.data?.length ? "Otro plan" : "Descargar plan"}
          </Button>
        </div>
        {graph.data && (
          <div data-tour="graph-filters" className="ml-auto flex items-center gap-4 text-[12.5px]">
            {history.data && (
              <label className="flex items-center gap-2">
                <Switch checked={withHistory} onCheckedChange={setWithHistory} /> Con mi historia
              </label>
            )}
            <label className="flex items-center gap-2">
              <Switch checked={hideLeveling} onCheckedChange={setHideLeveling} /> Ocultar nivelación
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={hideExternal} onCheckedChange={setHideExternal} /> Ocultar externas
            </label>
          </div>
        )}
      </header>

      {!plans.data?.length ? (
        <EmptyState
          className="flex-1"
          icon={<Waypoints />}
          title="Descarga el plan de tu carrera"
          description="BetterCampus consulta en el SIA los prerrequisitos de cada materia y dibuja el mapa de tu carrera. Tarda menos de un minuto y queda guardado."
          action={
            <Button onClick={() => setDownloadOpen(true)}>
              <CloudDownload /> Descargar plan
            </Button>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 p-3">
          <div className="relative min-w-0 flex-1">
            {graph.isLoading || !graph.data ? (
              <Skeleton className="h-full w-full rounded-2xl" />
            ) : (
              <GraphView graph={graph.data} selected={selected} onSelect={setSelected} focus={focus} />
            )}
            <div className="absolute left-3 top-3 w-72" onPointerDown={(e) => e.stopPropagation()}>
              <Input icon={<Search />} placeholder="Buscar en el plan" value={query} onChange={(e) => setQuery(e.target.value)} className="shadow-elev1" />
              {matches.length > 0 && (
                <div className="mt-1 overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-lowest shadow-elev2 dark:bg-surface-high">
                  {matches.map((m) => (
                    <button
                      key={m.code}
                      className="block w-full truncate px-3 py-2 text-left text-[13px] hover:bg-on-surface/5"
                      onClick={() => (setFocus(null), requestAnimationFrame(() => setFocus(m.code)), setSelected(m.code), setQuery(""))}
                    >
                      {m.name} <span className="text-xs text-on-surface-variant">{m.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {graph.data && <Legend stats={graph.data.stats} withHistory={withHistory && !!history.data} />}
          </div>
          <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-outline-variant/50 bg-surface-lowest dark:bg-surface-low">
            {node && graph.data ? (
              <NodeDetail node={node} graph={graph.data} onClose={() => setSelected(null)} onGo={(c) => (setSelected(c), setFocus(c))} />
            ) : (
              <div className="flex flex-1 flex-col p-5">
                <div className="text-xs text-on-surface-variant">Plan</div>
                <div className="mt-0.5 text-[15px] font-semibold leading-snug">{plan?.careerName}</div>
                {plan && <div className="mt-1 text-xs text-on-surface-variant">Descargado {relativeTime(plan.fetchedAt)}</div>}
                {graph.data && (
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <MiniStat label="Asignaturas" value={graph.data.stats.courses} />
                    <MiniStat label="Niveles de cadena" value={graph.data.layers} />
                    {withHistory && history.data && (
                      <>
                        <MiniStat label="Aprobadas" value={graph.data.stats.approved} />
                        <MiniStat label="Disponibles" value={graph.data.stats.available} />
                      </>
                    )}
                  </div>
                )}
                <p className="mt-5 text-xs leading-relaxed text-on-surface-variant">
                  Haz clic en una materia para ver sus condiciones y lo que habilita. Las líneas punteadas son correquisitos o condiciones de “alguna de”.
                </p>
                <div className="mt-auto flex gap-2 pt-4">
                  <Button variant="ghost" size="sm" onClick={() => plan && refetchPlan(plan.careerKey)}>
                    <CloudDownload /> Actualizar
                  </Button>
                  <Button variant="ghost" size="sm" className="text-error" onClick={() => setConfirmDelete(true)}>
                    <Trash2 /> Quitar
                  </Button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      <DownloadPlanDialog
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
        initial={settings.defaultCareer}
        onDone={async (key) => {
          await qc.invalidateQueries({ queryKey: ["plans"] });
          await qc.invalidateQueries({ queryKey: ["graph"] });
          setPlanKey(key);
        }}
      />
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Quitar este plan?"
        description="Se borra la copia local. Puedes volver a descargarlo cuando quieras."
        confirmLabel="Quitar"
        danger
        onConfirm={async () => {
          if (!planKey) return;
          await api.deletePlan(planKey);
          setPlanKey(null);
          await qc.invalidateQueries({ queryKey: ["plans"] });
        }}
      />
    </div>
  );

  async function refetchPlan(key: string) {
    const [level, campus, faculty, planCode] = key.split("-");
    try {
      await api.fetchPlan({ level, campus, faculty, plan: planCode, name: plan?.careerName ?? "", electives: false });
      await qc.invalidateQueries({ queryKey: ["graph"] });
      await qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success("Plan actualizado");
    } catch (e) {
      toast.error("No se pudo actualizar el plan", { description: errorMessage(e) });
    }
  }
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-container px-3 py-2">
      <div className="text-[11px] text-on-surface-variant">{label}</div>
      <div className="tabular text-lg font-semibold">{value}</div>
    </div>
  );
}

function Legend({ stats, withHistory }: { stats: CurriculumGraph["stats"]; withHistory: boolean }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-xl border border-outline-variant/60 bg-surface-lowest/90 px-3 py-2 text-[11.5px] backdrop-blur dark:bg-surface-high/90">
      {withHistory && (
        <>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-primary/50 bg-primary/20" /> Aprobada ({stats.approved})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border-2 border-primary" /> Disponible ({stats.available})
          </span>
        </>
      )}
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border border-dashed border-outline" /> Otro plan
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-px w-4 border-t border-dashed border-outline" /> Correquisito / alguna de
      </span>
    </div>
  );
}

function NodeDetail({ node, graph, onClose, onGo }: { node: GraphNode; graph: CurriculumGraph; onClose: () => void; onGo: (code: string) => void }) {
  const byCode = new Map(graph.nodes.map((n) => [n.code, n]));
  const statusLabel = { approved: "Aprobada", available: "Puedes inscribirla", locked: "Faltan prerrequisitos", external: "De otro plan" }[node.status];
  return (
    <>
      <div className="flex items-start gap-2 border-b border-outline-variant/50 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <TypologyBadge typology={node.typology} />
            <Badge className={node.status === "available" || node.status === "approved" ? "bg-primary/10 text-primary" : "bg-surface-high"}>{statusLabel}</Badge>
          </div>
          <h2 className="mt-2 text-[15px] font-semibold leading-snug">{node.name}</h2>
          <div className="tabular mt-0.5 text-xs text-on-surface-variant">
            {node.code} · {node.credits} créditos
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-on-surface-variant hover:bg-on-surface/5" aria-label="Cerrar">
          <X className="size-4" />
        </button>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        <h3 className="mb-2 text-[13px] font-semibold">Requisitos</h3>
        {node.conditions.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No tiene prerrequisitos.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {node.conditions.map((c) => (
              <div key={c.number} className="rounded-xl border border-outline-variant/60 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs">
                  <Badge className="bg-surface-high">Tipo {c.kind}</Badge>
                  <span className="text-on-surface-variant">{c.all ? "Todas" : `Al menos ${c.required ?? 1}`}</span>
                </div>
                <p className="mb-2 text-[11.5px] text-on-surface-variant">{CONDITION_TEXT[c.kind] ?? "Sin descripción"}</p>
                {c.courses.map((p) => {
                  const n = byCode.get(p.code);
                  return (
                    <button key={p.code} onClick={() => n && onGo(p.code)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12.5px] hover:bg-on-surface/5">
                      <span className={`size-1.5 shrink-0 rounded-full ${n?.status === "approved" ? "bg-primary" : "bg-outline"}`} />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="tabular text-[11px] text-on-surface-variant">{p.code}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <h3 className="mb-2 mt-5 text-[13px] font-semibold">Habilita</h3>
        {node.unlocks.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No es prerrequisito de otras materias del plan.</p>
        ) : (
          <div className="flex flex-col">
            {node.unlocks.map((code) => (
              <button key={code} onClick={() => onGo(code)} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[12.5px] hover:bg-on-surface/5">
                <span className="flex-1 truncate">{byCode.get(code)?.name ?? code}</span>
                <span className="tabular text-[11px] text-on-surface-variant">{code}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function DownloadPlanDialog({
  open,
  onOpenChange,
  initial,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: CareerRef | null;
  onDone: (key: string) => Promise<void>;
}) {
  const [career, setCareer] = useState<CareerRef | null>(initial ? { ...initial, electives: false } : null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!career) return;
    setBusy(true);
    // The download takes up to a minute: close the dialog and let it run with the progress indicator.
    onOpenChange(false);
    try {
      const p = await api.fetchPlan({ ...career, electives: false });
      await onDone(p.careerKey);
      toast.success("Plan descargado", { description: p.careerName });
    } catch (e) {
      if (!(e && typeof e === "object" && "kind" in e && (e as { kind: string }).kind === "cancelled"))
        toast.error("No se pudo descargar el plan", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,440px)]">
        <DialogHeader>
          <DialogTitle>Descargar plan de estudios</DialogTitle>
          <DialogDescription>Se consultan los prerrequisitos de cada asignatura del plan en el SIA.</DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-5">{open && <CareerPicker value={career} onChange={setCareer} allowElectives={false} />}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={run} loading={busy} disabled={!career}>
            <CloudDownload /> Descargar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookPlus, CheckCheck, RefreshCw, Search, SearchX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge, EmptyState, Input, Skeleton } from "@/components/ui/misc";
import { Checkbox, Tooltip } from "@/components/ui/primitives";
import { useAutoTour } from "@/components/tour/Tour";
import { api, errorMessage } from "@/lib/api";
import { useLibraryIndex } from "@/lib/data";
import { useSettings } from "@/lib/settings";
import { useUi } from "@/lib/store";
import type { CareerRef, Typology } from "@/lib/types";
import { cn, normalizeText, TYPOLOGY, TYPOLOGY_CLASSES } from "@/lib/utils";
import { CareerPicker, careerKey } from "./CareerPicker";

const FILTERS: { label: string; match: Typology[] }[] = [
  { label: "Fundamentación", match: ["FUND_OBLIGATORIA", "FUND_OPTATIVA"] },
  { label: "Disciplinar", match: ["DISC_OBLIGATORIA", "DISC_OPTATIVA"] },
  { label: "Libre elección", match: ["LIBRE_ELECCION"] },
  { label: "Nivelación", match: ["NIVELACION"] },
  { label: "Trabajo de grado", match: ["TRABAJO_GRADO"] },
];

export function AddCoursesDialog() {
  const open = useUi((s) => s.addCoursesOpen);
  const setOpen = useUi((s) => s.setAddCoursesOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="h-[min(88vh,720px)] w-[min(94vw,1000px)] overflow-hidden">{open && <Body onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function Body({ onDone }: { onDone: () => void }) {
  const settings = useSettings();
  const index = useLibraryIndex();
  const qc = useQueryClient();
  const [career, setCareer] = useState<CareerRef | null>(settings.defaultCareer);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useAutoTour("addCourses");

  const catalog = useQuery({
    queryKey: ["catalog", "courses", career && careerKey(career)],
    queryFn: () => api.catalogCourses(career!),
    enabled: !!career,
    staleTime: 5 * 60_000,
  });

  const visible = useMemo(() => {
    const q = normalizeText(query.trim());
    return (catalog.data?.courses ?? []).filter(
      (c) => (!q || normalizeText(`${c.name} ${c.code}`).includes(q)) && (filter == null || FILTERS[filter].match.includes(c.typology)),
    );
  }, [catalog.data, query, filter]);

  const toggle = (code: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  const allVisiblePicked = visible.length > 0 && visible.every((c) => picked.has(c.code));
  const pickedCredits = (catalog.data?.courses ?? []).filter((c) => picked.has(c.code)).reduce((a, c) => a + (c.credits ?? 0), 0);

  const add = async () => {
    if (!career || picked.size === 0) return;
    setBusy(true);
    try {
      const report = await api.fetchCourses(catalog.data?.career ?? career, [...picked]);
      await qc.invalidateQueries({ queryKey: ["library"] });
      if (report.failed.length) {
        toast.warning(`${report.updated.length} agregadas · ${report.failed.length} con error`, {
          description: report.failed.map((f) => `${f.code}: ${f.message}`).join("\n"),
        });
      } else {
        toast.success(report.updated.length === 1 ? "Asignatura agregada" : `${report.updated.length} asignaturas agregadas`);
      }
      onDone();
    } catch (e) {
      if (!(e instanceof Error && "kind" in e && (e as { kind: string }).kind === "cancelled"))
        toast.error("No se pudieron traer las asignaturas", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader className="border-b border-outline-variant/50">
        <DialogTitle>Agregar asignaturas del SIA</DialogTitle>
        <DialogDescription>Consulta la oferta del buscador de cursos y elige qué traer a tu lista.</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1">
        <div className="scroll-thin w-[300px] shrink-0 overflow-y-auto border-r border-outline-variant/50 p-5">
          <CareerPicker value={career} onChange={setCareer} />
        </div>
        <div data-tour="catalog" className="flex min-w-0 flex-1 flex-col">
          {!career ? (
            <EmptyState className="flex-1" icon={<Search />} title="Elige un plan de estudios" description="Verás aquí las asignaturas que ofrece este semestre." />
          ) : (
            <>
              <div className="flex flex-col gap-2 border-b border-outline-variant/50 px-5 py-3">
                <div className="flex items-center gap-2">
                  <Input className="flex-1" icon={<Search />} placeholder="Buscar por nombre o código" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
                  <Tooltip content="Volver a consultar el SIA">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => qc.fetchQuery({ queryKey: ["catalog", "courses", careerKey(career)], queryFn: () => api.catalogCourses(career, true) })}
                      aria-label="Recargar"
                    >
                      <RefreshCw className={cn(catalog.isFetching && "animate-spin")} />
                    </Button>
                  </Tooltip>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTERS.map((f, i) => (
                    <button
                      key={f.label}
                      onClick={() => setFilter((x) => (x === i ? null : i))}
                      className={cn(
                        "h-7 rounded-lg border px-2.5 text-xs font-medium transition",
                        filter === i ? "border-primary bg-primary/10 text-primary" : "border-outline-variant/70 text-on-surface-variant hover:bg-on-surface/5",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-2">
                {catalog.isLoading ? (
                  <div className="flex flex-col gap-2 p-2">
                    <p className="mb-2 text-xs text-on-surface-variant">Consultando el SIA… la primera vez toma unos segundos.</p>
                    {Array.from({ length: 8 }, (_, i) => (
                      <Skeleton key={i} className="h-12 w-full rounded-xl" />
                    ))}
                  </div>
                ) : catalog.error ? (
                  <EmptyState
                    icon={<SearchX />}
                    title="No se pudo consultar el SIA"
                    description={errorMessage(catalog.error)}
                    action={<Button variant="tonal" onClick={() => catalog.refetch()}>Reintentar</Button>}
                  />
                ) : visible.length === 0 ? (
                  <p className="py-10 text-center text-sm text-on-surface-variant">Sin resultados.</p>
                ) : (
                  <>
                    <button
                      onClick={() => setPicked((p) => {
                        const n = new Set(p);
                        visible.forEach((c) => (allVisiblePicked ? n.delete(c.code) : n.add(c.code)));
                        return n;
                      })}
                      className="mb-1 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-on-surface/5"
                    >
                      <CheckCheck className="size-3.5" />
                      {allVisiblePicked ? "Quitar selección" : `Seleccionar las ${visible.length} visibles`}
                    </button>
                    {visible.map((c) => {
                      const inLib = index.byCode.has(c.code);
                      const t = TYPOLOGY[c.typology];
                      return (
                        <label
                          key={c.code}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-on-surface/[0.04]",
                            picked.has(c.code) && "bg-primary/[0.06] hover:bg-primary/[0.08]",
                          )}
                        >
                          <Checkbox checked={picked.has(c.code)} onCheckedChange={() => toggle(c.code)} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13.5px] font-medium">{c.name}</div>
                            <div className="tabular text-[11.5px] text-on-surface-variant">{c.code}</div>
                          </div>
                          {inLib && <Badge className="bg-secondary-container text-secondary-on-container">En tu lista</Badge>}
                          <span className={cn("hidden rounded-md px-1.5 py-0.5 text-[11px] font-medium sm:inline", TYPOLOGY_CLASSES[t.color])}>{t.label}</span>
                          <span className="tabular w-10 text-right text-xs text-on-surface-variant">{c.credits ?? "–"} cr</span>
                        </label>
                      );
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <DialogFooter>
        <div className="mr-auto text-xs text-on-surface-variant">
          {picked.size > 0 ? (
            <>
              {picked.size} seleccionadas · {pickedCredits} créditos
            </>
          ) : catalog.data ? (
            `${catalog.data.courses.length} asignaturas en la oferta`
          ) : null}
        </div>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button onClick={add} disabled={picked.size === 0} loading={busy}>
          <BookPlus /> Agregar {picked.size > 0 && picked.size}
        </Button>
      </DialogFooter>
    </>
  );
}



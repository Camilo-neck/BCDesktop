import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { Calculator, ChevronDown, ClipboardPaste, GraduationCap, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge, EmptyState, Input, Label, Progress, Segmented, Stat, Textarea, TypologyBadge } from "@/components/ui/misc";
import { Confirm } from "@/components/ui/primitives";
import { useAutoTour } from "@/components/tour/Tour";
import { api, errorMessage } from "@/lib/api";
import { useThemeColor } from "@/lib/colors";
import type { AcademicHistory, Projection } from "@/lib/types";
import { cn, formatAvg, formatGrade, relativeTime } from "@/lib/utils";

const TYPOLOGY_ROWS: { key: string; label: string; color: string }[] = [
  { key: "FUND. OBLIGATORIA", label: "Fundamentación obligatoria", color: "bg-typology-fundamental" },
  { key: "FUND. OPTATIVA", label: "Fundamentación optativa", color: "bg-typology-fundamental/60" },
  { key: "DISCIPLINAR OBLIGATORIA", label: "Disciplinar obligatoria", color: "bg-typology-disciplinar" },
  { key: "DISCIPLINAR OPTATIVA", label: "Disciplinar optativa", color: "bg-typology-disciplinar/60" },
  { key: "LIBRE ELECCIÓN", label: "Libre elección", color: "bg-typology-libre" },
  { key: "TRABAJO DE GRADO", label: "Trabajo de grado", color: "bg-typology-grado" },
  { key: "NIVELACIÓN", label: "Nivelación", color: "bg-typology-nivelacion" },
];

const tooltipStyle = {
  contentStyle: { background: "rgb(var(--surface-lowest))", border: "1px solid rgb(var(--outline-variant))", borderRadius: 12, fontSize: 12 },
  labelStyle: { color: "rgb(var(--on-surface-variant))" },
};

export function ProgressPage() {
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ["history"], queryFn: api.latestHistory, staleTime: Infinity });
  const [pasteOpen, setPasteOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const h = history.data?.history;

  const clear = async () => {
    await api.clearHistory();
    qc.setQueryData(["history"], null);
    toast.success("Historia eliminada de este equipo");
  };

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-8 py-7">
        <header className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Mi avance</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              {h ? (
                <>
                  {h.plan} · {h.faculty} · cargada {relativeTime(history.data!.createdAt)}
                </>
              ) : (
                "Tu historia académica, analizada en tu equipo."
              )}
            </p>
          </div>
          {h && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
                <Trash2 /> Borrar
              </Button>
              <Button variant="tonal" size="sm" onClick={() => setPasteOpen(true)}>
                <ClipboardPaste /> Actualizar historia
              </Button>
            </div>
          )}
        </header>

        {history.isLoading ? null : h ? <Dashboard h={h} /> : <PasteCard inline onDone={() => {}} />}
      </div>
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="w-[min(94vw,680px)]">
          <PasteCard onDone={() => setPasteOpen(false)} />
        </DialogContent>
      </Dialog>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Borrar tu historia académica?"
        description="Se eliminan las copias guardadas en este equipo. Puedes volver a pegarla cuando quieras."
        confirmLabel="Borrar"
        danger
        onConfirm={clear}
      />
    </div>
  );
}

function PasteCard({ inline, onDone }: { inline?: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  useAutoTour("progress", !!inline);
  const parse = useMutation({
    mutationFn: api.parseHistory,
    onSuccess: (h) => {
      qc.setQueryData(["history"], h);
      void qc.invalidateQueries({ queryKey: ["graph"] });
      toast.success("Historia académica procesada");
      setText("");
      onDone();
    },
    onError: (e) => toast.error("No se pudo leer la historia", { description: errorMessage(e) }),
  });

  const body = (
    <>
      <ol className="mb-4 grid grid-cols-3 gap-3 text-xs text-on-surface-variant">
        {["Entra al SIA y abre «Mi historia académica».", "Selecciona todo con Ctrl + A y copia con Ctrl + C.", "Pégalo aquí con Ctrl + V y presiona Analizar."].map((s, i) => (
          <li key={i} className="flex gap-2 rounded-xl bg-surface-container p-3">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-on">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <Textarea
        data-tour="history-input"
        className="h-56 font-mono text-xs"
        placeholder="Pega aquí el texto de tu historia académica…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="mt-2 flex items-center gap-1.5 text-xs text-on-surface-variant">
        <ShieldCheck className="size-3.5 text-primary" /> Se procesa en tu computador. No se envía a ningún servidor.
      </p>
    </>
  );

  if (inline)
    return (
      <div className="card p-6">
        <EmptyState className="py-4" icon={<GraduationCap />} title="Carga tu historia académica" description="Verás tu P.A.P.A., el avance por tipología, la evolución por semestre y calculadoras de promedio." />
        {body}
        <div className="mt-4 flex justify-end">
          <Button onClick={() => parse.mutate(text)} loading={parse.isPending} disabled={text.trim().length < 50}>
            Analizar
          </Button>
        </div>
      </div>
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Actualizar historia académica</DialogTitle>
        <DialogDescription>Pega el texto completo de la página de tu historia en el SIA.</DialogDescription>
      </DialogHeader>
      <div className="px-6 pb-4">{body}</div>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button onClick={() => parse.mutate(text)} loading={parse.isPending} disabled={text.trim().length < 50}>
          Analizar
        </Button>
      </DialogFooter>
    </>
  );
}

function Dashboard({ h }: { h: AcademicHistory }) {
  const total = h.credits["TOTAL"];
  const series = h.periods.map((p) => ({ name: p.name, PAPA: p.papa, PA: p.pa, PAPI: p.papi, avance: p.accumulatedProgress }));
  const [chart, setChart] = useState<"avg" | "progress">("avg");
  const color = useThemeColor();
  const axis = { tick: { fontSize: 11, fill: color("on-surface-variant") }, stroke: color("outline-variant") };

  return (
    <div className="flex flex-col gap-5 animate-fade-up">
      <div className="grid grid-cols-5 gap-3">
        <Stat label="P.A.P.A." value={formatAvg(h.papa)} hint="Promedio de todas las notas" />
        <Stat label="P.A." value={formatAvg(h.pa)} hint="Mejor nota aprobada por materia" />
        <Stat label="Avance" value={`${h.progress.toFixed(1)}%`} hint={total && `${total.approved} de ${total.required} créditos`} />
        <Stat label="Materias vistas" value={h.coursesSeen} hint={`Mejor nota ${formatGrade(h.highestGrade)} (${h.highestGradeCount})`} />
        <Stat label="Cupo de créditos" value={h.quota.available} hint={`de ${h.quota.quota} disponibles`} />
      </div>

      <div className="grid grid-cols-5 gap-4">
        <div className="card col-span-2 p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Avance por tipología</h2>
          <div className="flex flex-col gap-3.5">
            {TYPOLOGY_ROWS.filter((r) => h.credits[r.key]?.required).map((r) => {
              const c = h.credits[r.key];
              return (
                <div key={r.key}>
                  <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                    <span>{r.label}</span>
                    <span className="tabular text-on-surface-variant">
                      <b className="font-semibold text-on-surface">{c.approved}</b>/{c.required} · {c.progress.toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={c.progress} tone={r.color} className="h-2" />
                </div>
              );
            })}
          </div>
        </div>
        <div className="card col-span-3 flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Evolución por semestre</h2>
            <Segmented
              value={chart}
              onChange={setChart}
              options={[
                { value: "avg", label: "Promedios" },
                { value: "progress", label: "Avance" },
              ]}
            />
          </div>
          <div className="h-60">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={color("outline-variant", 0.5)} vertical={false} />
                <XAxis dataKey="name" {...axis} />
                {chart === "avg" ? <YAxis domain={[2.5, 5]} ticks={[2.5, 3, 3.5, 4, 4.5, 5]} {...axis} /> : <YAxis domain={[0, 100]} unit="%" {...axis} />}
                <ChartTooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {chart === "avg"
                  ? [
                      <Line key="papa" type="monotone" dataKey="PAPA" stroke={color("primary")} strokeWidth={2.2} dot={{ r: 3 }} />,
                      <Line key="pa" type="monotone" dataKey="PA" stroke={color("typ-fundamental")} strokeWidth={2} dot={{ r: 3 }} />,
                      <Line key="papi" type="monotone" dataKey="PAPI" stroke={color("typ-libre")} strokeWidth={1.6} strokeDasharray="4 3" dot={{ r: 2.5 }} />,
                    ]
                  : <Line type="monotone" dataKey="avance" name="Avance acumulado" stroke={color("primary")} strokeWidth={2.2} dot={{ r: 3 }} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <div className="card col-span-3 p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Semestres</h2>
          <div className="flex flex-col gap-1.5">
            {[...h.periods].reverse().map((p, i) => (
              <PeriodRow key={p.name} period={p} defaultOpen={i === 0} />
            ))}
          </div>
        </div>
        <Calculators h={h} />
      </div>
    </div>
  );
}

function PeriodRow({ period: p, defaultOpen }: { period: AcademicHistory["periods"][number]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-outline-variant/50">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-4 px-4 py-3 text-left">
        <span className="w-16 text-[14px] font-semibold">{p.name}</span>
        <span className="tabular flex-1 text-xs text-on-surface-variant">
          {p.courses.length} materias · {p.credits} créditos · aprobados {p.approvedCredits}
        </span>
        <span className="tabular text-xs">
          PAPI <b className="font-semibold">{formatAvg(p.papi)}</b>
        </span>
        <span className="tabular text-xs">
          PAPA <b className="font-semibold">{formatAvg(p.papa)}</b>
        </span>
        <ChevronDown className={cn("size-4 text-on-surface-variant transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-outline-variant/40 px-2 py-1.5">
          {p.courses.map((c, i) => (
            <div key={c.code + i} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate" data-selectable>
                {c.name}
              </span>
              <TypologyBadge typology={c.typology} short />
              <span className="tabular w-10 text-right text-xs text-on-surface-variant">{c.credits} cr</span>
              <Badge className={cn("tabular w-14 justify-center", c.passed ? "bg-primary/10 text-primary" : "bg-error/10 text-error")}>
                {c.grade != null ? formatGrade(c.grade) : c.passed ? "AP" : "RE"}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Calculators({ h }: { h: AcademicHistory }) {
  const [target, setTarget] = useState("4.0");
  const [credits, setCredits] = useState("18");
  const [papi, setPapi] = useState("4.2");
  const needed = useQuery({
    queryKey: ["calc", "papiFor", target, credits, h.papa],
    queryFn: () => api.papiFor(Number(target), Number(credits)),
    enabled: Number(credits) > 0 && Number(target) > 0,
  });
  const after = useQuery({
    queryKey: ["calc", "papaAfter", papi, credits, h.papa],
    queryFn: () => api.papaAfter(Number(papi), Number(credits)),
    enabled: Number(credits) > 0,
  });
  const max = useQuery({ queryKey: ["calc", "max", h.papa], queryFn: api.maxPapa });

  return (
    <div className="card col-span-2 flex flex-col gap-4 p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <Calculator className="size-4 text-primary" /> Calculadoras
      </h2>
      <div>
        <Label hint="Próximo semestre">Créditos a inscribir</Label>
        <Input type="number" min={1} max={30} value={credits} onChange={(e) => setCredits(e.target.value)} />
      </div>
      <CalcRow
        title="¿Qué PAPI necesito para llegar a…?"
        input={<Input type="number" step="0.1" min={0} max={5} value={target} onChange={(e) => setTarget(e.target.value)} className="w-20" />}
        result={needed.data}
        format={(p) => (p.reachable ? `Necesitas ${p.value.toFixed(2)}` : p.value > 5 ? "No alcanzable este semestre" : "Ya lo superas")}
      />
      <CalcRow
        title="Si saco un PAPI de…"
        input={<Input type="number" step="0.1" min={0} max={5} value={papi} onChange={(e) => setPapi(e.target.value)} className="w-20" />}
        result={after.data}
        format={(p) => `Mi P.A.P.A. queda en ${p.value.toFixed(2)}`}
      />
      <div className="rounded-xl bg-surface-container px-4 py-3">
        <div className="text-xs text-on-surface-variant">P.A.P.A. máximo al graduarte (todo en 5.0)</div>
        <div className="tabular mt-0.5 text-xl font-semibold">{max.data ? max.data.value.toFixed(2) : "—"}</div>
      </div>
    </div>
  );
}

function CalcRow({ title, input, result, format }: { title: string; input: React.ReactNode; result?: Projection; format: (p: Projection) => string }) {
  return (
    <div className="rounded-xl border border-outline-variant/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
        {title} {input}
      </div>
      <div className={cn("text-sm font-semibold", result && !result.reachable && "text-warning")}>{result ? format(result) : "—"}</div>
    </div>
  );
}

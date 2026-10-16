import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { CalendarCheck2, CalendarDays, ExternalLink, MapPin, Star, TrendingDown, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge, Segmented, Skeleton, SpotsBadge } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api";
import { useThemeColor } from "@/lib/colors";
import { useScheduleEditor } from "@/lib/data";
import { useUi } from "@/lib/store";
import type { Group } from "@/lib/types";
import { DAY_LONG, hhmm, normalizeText } from "@/lib/utils";
import losEstudiantes from "@/assets/losestudiantes.png";

export function GroupDetailSheet() {
  const groupDetail = useUi((s) => s.groupDetail);
  const setGroupDetail = useUi((s) => s.setGroupDetail);
  const editor = useScheduleEditor();
  const item = groupDetail ? editor.index.byCode.get(groupDetail.courseCode) : undefined;
  const group = item?.course.groups.find((g) => g.id === groupDetail?.groupId);
  const selected = editor.active?.selections.some((s) => s.courseCode === groupDetail?.courseCode && s.groupId === groupDetail?.groupId);

  return (
    <Dialog open={!!group} onOpenChange={(o) => !o && setGroupDetail(null)}>
      <DialogContent side="right">
        {item && group && (
          <>
            <DialogHeader className="border-b border-outline-variant/50">
              <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                <span className="size-2.5 rounded-full" style={{ background: item.color }} />
                {item.course.code} · {item.course.credits} créditos
              </div>
              <DialogTitle>{item.course.name}</DialogTitle>
              <DialogDescription>{group.label}</DialogDescription>
            </DialogHeader>
            <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
              <div className="flex flex-wrap gap-1.5">
                <SpotsBadge spots={group.spots} />
                {group.shift && <Badge className="bg-surface-high">{group.shift}</Badge>}
                {group.duration && <Badge className="bg-surface-high">{group.duration}</Badge>}
                {group.startsOn && group.endsOn && (
                  <Badge className="bg-surface-high">
                    <CalendarDays /> {fmtDate(group.startsOn)} – {fmtDate(group.endsOn)}
                  </Badge>
                )}
              </div>

              <section>
                <h3 className="mb-2 text-[13px] font-semibold">Horario</h3>
                {group.sessions.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">El SIA no publica horario para este grupo.</p>
                ) : (
                  <div className="flex flex-col divide-y divide-outline-variant/40 rounded-xl border border-outline-variant/60">
                    {group.sessions.map((s, i) => (
                      <div key={i} className="flex items-start gap-3 px-3 py-2.5">
                        <div className="w-20 shrink-0 text-[13px] font-medium">{DAY_LONG[s.day]}</div>
                        <div className="tabular w-24 shrink-0 text-[13px]">
                          {hhmm(s.start)}–{hhmm(s.end)}
                        </div>
                        <div className="flex min-w-0 flex-1 items-start gap-1 text-xs text-on-surface-variant">
                          {s.room && <MapPin className="mt-0.5 size-3 shrink-0" />}
                          <span data-selectable>{s.room || "Salón no informado"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-[13px] font-semibold">{group.professors.length > 1 ? "Profesores" : "Profesor"}</h3>
                {group.professors.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">No informado</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {group.professors.map((p) => (
                      <ProfessorCard key={p} name={p} />
                    ))}
                  </div>
                )}
              </section>

              {item.course.career && <SpotsHistory careerName={item.course.career.name} courseCode={item.course.code} group={group} />}
            </div>
            <div className="border-t border-outline-variant/50 p-4">
              <Button className="w-full" variant={selected ? "tonal" : "primary"} onClick={() => editor.selectGroup(item.course.code, group.id)}>
                <CalendarCheck2 /> {selected ? "Quitar del horario" : "Agregar al horario"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const fmtDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short" });

function ProfessorCard({ name }: { name: string }) {
  const q = useQuery({ queryKey: ["professor", name], queryFn: () => api.professor(name), staleTime: Infinity, retry: 0 });
  const p = q.data;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-outline-variant/60 px-3 py-2.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary-container text-secondary-on-container">
        <UserRound className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium" data-selectable>
          {name}
        </div>
        {q.isLoading ? (
          <Skeleton className="mt-1 h-3 w-40" />
        ) : p ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-on-surface-variant">
            {p.rating != null && (
              <span className="inline-flex items-center gap-1 font-medium text-on-surface">
                <Star className="size-3 fill-[rgb(var(--typ-disciplinar))] text-[rgb(var(--typ-disciplinar))]" /> {p.rating.toFixed(1)}
              </span>
            )}
            {p.gradeAverage != null && <span>Nota prom. {p.gradeAverage.toFixed(1)}</span>}
            {p.approvalRatio != null && <span>{Math.round(p.approvalRatio * (p.approvalRatio <= 1 ? 100 : 1))}% aprueba</span>}
            <span>{p.reviews} reseñas</span>
          </div>
        ) : (
          <div className="mt-0.5 text-xs text-on-surface-variant">{q.error ? errorMessage(q.error) : "Sin reseñas en LosEstudiantes"}</div>
        )}
      </div>
      {p && (
        <button onClick={() => openUrl(p.url)} className="flex shrink-0 items-center gap-1 rounded-lg p-1.5 text-on-surface-variant hover:bg-on-surface/5" title="Ver en LosEstudiantes">
          <img src={losEstudiantes} alt="LosEstudiantes" className="size-5 rounded" />
          <ExternalLink className="size-3" />
        </button>
      )}
    </div>
  );
}

interface StatsPeriod {
  period: string;
  inscriptions: Record<string, Record<string, { professor: string; spot_data: [string, number][] }>>;
  depletion_dates: Record<string, { depletion_day: string; depletion_time: string; avg_spot_depletion: number }>;
}

function matchGroup(names: string[], g: Group) {
  const id = normalizeText(`(${g.id})`);
  return names.find((n) => normalizeText(n.trim()) === normalizeText(g.label)) ?? names.find((n) => normalizeText(n).startsWith(id));
}

function SpotsHistory({ careerName, courseCode, group }: { careerName: string; courseCode: string; group: Group }) {
  const q = useQuery({
    queryKey: ["stats", careerName, courseCode],
    queryFn: () => api.inscriptionStats(careerName, courseCode) as Promise<StatsPeriod[]>,
    staleTime: Infinity,
    retry: 0,
  });
  const periods = useMemo(() => (Array.isArray(q.data) ? [...q.data].sort((a, b) => b.period.localeCompare(a.period)) : []), [q.data]);
  const [period, setPeriod] = useState<string | null>(null);
  const color = useThemeColor();
  const current = periods.find((p) => p.period === period) ?? periods[0];

  const { points, depletion } = useMemo(() => {
    if (!current) return { points: [], depletion: null };
    const days = Object.keys(current.inscriptions).sort();
    const names = [...new Set(days.flatMap((d) => Object.keys(current.inscriptions[d])))];
    const name = matchGroup(names, group);
    if (!name) return { points: [], depletion: null };
    const pts = days.flatMap((d) =>
      (current.inscriptions[d][name]?.spot_data ?? []).map(([t, s]) => ({ label: `${fmtDate(d)} ${t}`, spots: s })),
    );
    return { points: pts, depletion: current.depletion_dates?.[name] ?? null };
  }, [current, group]);

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
        <TrendingDown className="size-4 text-primary" /> Cupos en inscripciones anteriores
      </h3>
      {q.isLoading ? (
        <Skeleton className="h-36 w-full rounded-xl" />
      ) : q.error ? (
        <p className="rounded-xl bg-surface-container px-3 py-2.5 text-xs text-on-surface-variant">{errorMessage(q.error)}</p>
      ) : !current || points.length === 0 ? (
        <p className="rounded-xl bg-surface-container px-3 py-2.5 text-xs text-on-surface-variant">No hay registros de este grupo.</p>
      ) : (
        <div className="rounded-xl border border-outline-variant/60 p-3">
          {periods.length > 1 && (
            <Segmented
              className="mb-3"
              value={current.period}
              onChange={setPeriod}
              options={periods.slice(0, 4).map((p) => ({ value: p.period, label: p.period }))}
            />
          )}
          {depletion && depletion.depletion_day !== "N/A" && (
            <p className="mb-2 text-xs">
              Se agotó el <b>{fmtDate(depletion.depletion_day)}</b> a las <b>{depletion.depletion_time}</b>
              {depletion.avg_spot_depletion > 0 && <> · bajaba ~{depletion.avg_spot_depletion.toFixed(1)} cupos por registro</>}
            </p>
          )}
          <div className="h-36">
            <ResponsiveContainer>
              <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <defs>
                  <linearGradient id="spots" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color("primary")} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={color("primary")} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={color("outline-variant", 0.5)} vertical={false} />
                <XAxis dataKey="label" hide />
                <YAxis tick={{ fontSize: 10, fill: color("on-surface-variant") }} allowDecimals={false} />
                <ChartTooltip
                  contentStyle={{ background: "rgb(var(--surface-lowest))", border: "1px solid rgb(var(--outline-variant))", borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: "rgb(var(--on-surface-variant))" }}
                  formatter={(v) => [v, "Cupos"]}
                />
                <Area type="monotone" dataKey="spots" stroke={color("primary")} strokeWidth={2} fill="url(#spots)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}

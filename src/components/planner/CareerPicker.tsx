import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Star } from "lucide-react";
import { Label } from "@/components/ui/misc";
import { Select, Switch, Tooltip } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { useSetSetting, useSettings } from "@/lib/settings";
import type { CareerRef } from "@/lib/types";
import { cn } from "@/lib/utils";

export const careerKey = (c: CareerRef) => `${c.level}-${c.campus}-${c.faculty}-${c.plan}${c.electives ? "-E" : ""}`;

/** Level → campus → faculty → plan, loaded on demand from the SIA and cached locally. */
export function CareerPicker({
  value,
  onChange,
  allowElectives = true,
  className,
}: {
  value: CareerRef | null;
  onChange: (c: CareerRef | null) => void;
  allowElectives?: boolean;
  className?: string;
}) {
  const settings = useSettings();
  const setSetting = useSetSetting();
  const [level, setLevel] = useState(value?.level);
  const [campus, setCampus] = useState(value?.campus);
  const [faculty, setFaculty] = useState(value?.faculty);
  const [plan, setPlan] = useState(value?.plan);
  const [electives, setElectives] = useState(value?.electives ?? false);

  const levels = useQuery({ queryKey: ["catalog", "levels"], queryFn: () => api.levels(), staleTime: Infinity });
  const campuses = useQuery({
    queryKey: ["catalog", "campuses", level],
    queryFn: () => api.campuses(level!),
    enabled: !!level,
    staleTime: Infinity,
  });
  const faculties = useQuery({
    queryKey: ["catalog", "faculties", level, campus],
    queryFn: () => api.faculties(level!, campus!),
    enabled: !!level && !!campus,
    staleTime: Infinity,
  });
  const plans = useQuery({
    queryKey: ["catalog", "plans", level, campus, faculty],
    queryFn: () => api.plans(level!, campus!, faculty!),
    enabled: !!level && !!campus && !!faculty,
    staleTime: Infinity,
  });

  // Default to Pregrado when nothing is chosen yet.
  useEffect(() => {
    if (!level && levels.data?.length) setLevel(levels.data[0].value);
  }, [level, levels.data]);

  useEffect(() => {
    if (level && campus && faculty && plan) {
      const name = plans.data?.find((p) => p.value === plan)?.label ?? value?.name ?? "";
      onChange({ level, campus, faculty, plan, name, electives });
    } else onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, campus, faculty, plan, electives, plans.data]);

  const error = [levels, campuses, faculties, plans].find((q) => q.error)?.error;
  const current = level && campus && faculty && plan ? { level, campus, faculty, plan, electives } : null;
  const isDefault =
    !!current &&
    !!settings.defaultCareer &&
    careerKey({ ...current, name: "" }) === careerKey({ ...settings.defaultCareer, name: "" });

  return (
    <div data-tour="career-picker" className={cn("flex flex-col gap-3", className)}>
      <div>
        <Label>Nivel de estudio</Label>
        <Select
          value={level}
          loading={levels.isLoading}
          onValueChange={(v) => (setLevel(v), setCampus(undefined), setFaculty(undefined), setPlan(undefined))}
          options={levels.data ?? []}
          placeholder="Selecciona"
        />
      </div>
      <div>
        <Label>Sede</Label>
        <Select
          value={campus}
          loading={campuses.isFetching}
          disabled={!level}
          onValueChange={(v) => (setCampus(v), setFaculty(undefined), setPlan(undefined))}
          options={campuses.data ?? []}
          placeholder="Selecciona la sede"
        />
      </div>
      <div>
        <Label>Facultad</Label>
        <Select
          value={faculty}
          loading={faculties.isFetching}
          disabled={!campus}
          onValueChange={(v) => (setFaculty(v), setPlan(undefined))}
          options={faculties.data ?? []}
          placeholder="Selecciona la facultad"
        />
      </div>
      <div>
        <Label
          hint={
            current && (
              <Tooltip content={isDefault ? "Es tu carrera por defecto" : "Usar siempre esta carrera"}>
                <button
                  className={cn("inline-flex items-center gap-1 transition hover:text-on-surface", isDefault && "text-primary")}
                  onClick={() =>
                    setSetting("defaultCareer", { ...current, name: plans.data?.find((p) => p.value === plan)?.label ?? "" })
                  }
                >
                  <Star className={cn("size-3.5", isDefault && "fill-current")} /> {isDefault ? "Por defecto" : "Usar por defecto"}
                </button>
              </Tooltip>
            )
          }
        >
          Plan de estudios
        </Label>
        <Select value={plan} loading={plans.isFetching} disabled={!faculty} onValueChange={setPlan} options={plans.data ?? []} placeholder="Selecciona el plan" />
      </div>
      {allowElectives && (
        <label data-tour="electives" className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-outline-variant/60 px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">Libre elección</span>
            <span className="block text-xs text-on-surface-variant">Oferta de electivas de la sede</span>
          </span>
          <Switch checked={electives} onCheckedChange={setElectives} />
        </label>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-error/10 px-3 py-2 text-xs text-error">
          <span className="flex-1">{errorMessage(error)}</span>
          <button
            className="shrink-0"
            onClick={() => [levels, campuses, faculties, plans].forEach((q) => q.error && q.refetch())}
            aria-label="Reintentar"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

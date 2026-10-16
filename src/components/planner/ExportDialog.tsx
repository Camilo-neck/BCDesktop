import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { CalendarDays, Check, FileDown, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/misc";
import { Switch } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { useActiveSchedule } from "@/lib/data";
import { useSetSetting, useSettings } from "@/lib/settings";
import { useUi } from "@/lib/store";
import type { Term } from "@/lib/types";

export function ExportDialog() {
  const exportOpen = useUi((s) => s.exportOpen);
  const setExportOpen = useUi((s) => s.setExportOpen);
  const { active } = useActiveSchedule();
  const settings = useSettings();
  const setSetting = useSetSetting();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"ics" | "google" | "connect" | null>(null);
  const term = settings.term;
  const info = useQuery({ queryKey: ["appInfo"], queryFn: api.appInfo, staleTime: Infinity });
  const account = useQuery({ queryKey: ["google"], queryFn: api.googleStatus, enabled: exportOpen });

  const setTerm = (patch: Partial<Term>) => setSetting("term", { ...term, ...patch });
  const googleReady = !!info.data?.googleConfigured;

  const exportIcs = async () => {
    if (!active) return;
    const path = await save({ defaultPath: `${active.name}.ics`, filters: [{ name: "iCalendar", extensions: ["ics"] }] });
    if (!path) return;
    setBusy("ics");
    try {
      await api.exportIcs(active.id, term, path);
      toast.success("Calendario exportado", { description: path });
    } catch (e) {
      toast.error("No se pudo exportar", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("connect");
    try {
      const acc = await api.googleConnect();
      qc.setQueryData(["google"], acc);
      toast.success(`Conectado como ${acc.email}`);
    } catch (e) {
      toast.error("No se pudo conectar con Google", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const exportGoogle = async () => {
    if (!active) return;
    setBusy("google");
    try {
      const r = await api.googleExport(active.id, term);
      toast.success(`${r.created} clases agregadas a Google Calendar`, {
        description: r.failed ? `${r.failed} no se pudieron crear.` : `Calendario «BetterCampus · ${active.name}»`,
      });
    } catch (e) {
      toast.error("No se pudo exportar a Google", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={exportOpen} onOpenChange={setExportOpen}>
      <DialogContent className="w-[min(94vw,560px)]">
        <DialogHeader>
          <DialogTitle>Exportar «{active?.name}»</DialogTitle>
          <DialogDescription>Cada clase se crea como un evento semanal entre las fechas del semestre, con recordatorio 10 minutos antes.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-6 pb-6">
          <div className="rounded-2xl border border-outline-variant/60 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Inicio del semestre</Label>
                <Input type="date" value={term.from} onChange={(e) => setTerm({ from: e.target.value })} />
              </div>
              <div>
                <Label>Fin del semestre</Label>
                <Input type="date" value={term.until} onChange={(e) => setTerm({ until: e.target.value })} />
              </div>
            </div>
            <label className="mt-3 flex items-center justify-between gap-3 text-[13px]">
              <span>
                Usar las fechas que publica el SIA para cada grupo
                <span className="block text-xs text-on-surface-variant">Si un grupo no tiene fechas, se usan las de arriba.</span>
              </span>
              <Switch checked={term.useGroupDates} onCheckedChange={(v) => setTerm({ useGroupDates: v })} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col rounded-2xl border border-outline-variant/60 p-4">
              <FileDown className="mb-2 size-5 text-primary" />
              <div className="text-[14px] font-semibold">Archivo .ics</div>
              <p className="mb-3 mt-1 flex-1 text-xs text-on-surface-variant">Para Outlook, Apple Calendar o importar en Google sin conectar tu cuenta.</p>
              <Button variant="tonal" onClick={exportIcs} loading={busy === "ics"}>
                Guardar archivo
              </Button>
            </div>
            <div className="flex flex-col rounded-2xl border border-outline-variant/60 p-4">
              <CalendarDays className="mb-2 size-5 text-primary" />
              <div className="text-[14px] font-semibold">Google Calendar</div>
              {!googleReady ? (
                <p className="mt-1 flex-1 text-xs text-on-surface-variant">
                  Todavía no está disponible en esta versión. Mientras tanto, guarda el archivo .ics e impórtalo en Google Calendar.
                </p>
              ) : account.data ? (
                <>
                  <div className="mb-3 mt-2 flex flex-1 items-center gap-2">
                    {account.data.picture ? (
                      <img src={account.data.picture} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="grid size-7 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{account.data.email[0]?.toUpperCase()}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{account.data.name ?? account.data.email}</div>
                      <div className="truncate text-[11px] text-on-surface-variant">{account.data.email}</div>
                    </div>
                    <button
                      onClick={async () => (await api.googleDisconnect(), qc.setQueryData(["google"], null))}
                      className="rounded-md p-1 text-on-surface-variant hover:bg-on-surface/5"
                      title="Desconectar"
                      aria-label="Desconectar"
                    >
                      <LogOut className="size-3.5" />
                    </button>
                  </div>
                  <Button onClick={exportGoogle} loading={busy === "google"}>
                    <Check /> Exportar
                  </Button>
                </>
              ) : (
                <>
                  <p className="mb-3 mt-1 flex-1 text-xs text-on-surface-variant">
                    Se abrirá tu navegador para iniciar sesión. BetterCampus solo puede ver los calendarios que crea.
                  </p>
                  <Button onClick={connect} loading={busy === "connect"}>
                    Conectar con Google
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

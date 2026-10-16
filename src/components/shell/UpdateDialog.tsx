import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTourStore } from "@/components/tour/Tour";
import { api } from "@/lib/api";
import { useSettings, useSettingsLoaded } from "@/lib/settings";
import { checkForUpdates, downloadInBackground, RELEASES_URL, updateNow, useUpdater } from "@/lib/updater";

/** Wait after launch before checking, so the first screen loads without competing for the network. */
const STARTUP_DELAY_MS = 4000;

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** Checks once at startup, then asks (or, with `autoUpdate`, downloads silently). Mounted once in the shell. */
function useStartupCheck() {
  const loaded = useSettingsLoaded();
  const { autoUpdate } = useSettings();
  const auto = useRef(autoUpdate);
  auto.current = autoUpdate;
  const done = useRef(false);

  useEffect(() => {
    if (!loaded || done.current) return;
    done.current = true;
    const t = setTimeout(async () => {
      const update = await checkForUpdates(false);
      if (!update) return;
      if (auto.current) return void downloadInBackground();
      // A dialog over a running tour would hide the step: offer it from a toast instead.
      if (useTourStore.getState().id) {
        toast(`BetterCampus ${update.version} está disponible`, {
          duration: 15_000,
          action: { label: "Ver", onClick: () => useUpdater.getState().setDialogOpen(true) },
        });
      } else useUpdater.getState().setDialogOpen(true);
    }, STARTUP_DELAY_MS);
    return () => clearTimeout(t);
  }, [loaded]);
}

export function UpdateDialog() {
  useStartupCheck();
  const { phase, update, received, total, dialogOpen, setDialogOpen } = useUpdater();
  const info = useQuery({ queryKey: ["appInfo"], queryFn: api.appInfo, staleTime: Infinity });
  const busy = phase === "downloading" || phase === "installing";
  const pct = total ? Math.min(100, Math.round((received / total) * 100)) : 0;

  if (!update) return null;
  return (
    <Dialog open={dialogOpen} onOpenChange={(o) => !busy && setDialogOpen(o)}>
      <DialogContent className="w-[min(92vw,460px)]" hideClose={busy} onEscapeKeyDown={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <ArrowUpCircle className="mb-1 size-6 text-primary" />
          <DialogTitle>BetterCampus {update.version} está disponible</DialogTitle>
          <DialogDescription>
            Tienes la versión {update.currentVersion}. Se descarga en segundo plano, se instala y la app se abre de nuevo. Tus horarios y datos se
            conservan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-6 pb-5">
          <Button variant="link" size="sm" className="self-start" onClick={() => void openUrl(`${RELEASES_URL}/tag/v${update.version}`).catch(() => {})}>
            <ExternalLink /> Ver novedades
          </Button>

          {busy && (
            <div aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-on-surface/10">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: phase === "installing" ? "100%" : `${pct}%` }}
                />
              </div>
              <div className="mt-1.5 text-xs tabular-nums text-on-surface-variant">
                {phase === "installing" ? "Instalando…" : total ? `Descargando · ${mb(received)} de ${mb(total)} MB` : "Descargando…"}
              </div>
            </div>
          )}

          {info.data?.os === "windows" && <p className="text-xs text-on-surface-variant">Windows cerrará la app un momento para instalarla.</p>}
          {info.data?.os === "linux" && (
            <p className="text-xs text-on-surface-variant">Si instalaste el paquete .deb o .rpm, el sistema te pedirá tu contraseña.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => setDialogOpen(false)}>
            Más tarde
          </Button>
          <Button loading={busy} onClick={() => void updateNow()}>
            {phase === "ready" ? "Reiniciar y actualizar" : "Actualizar y reiniciar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

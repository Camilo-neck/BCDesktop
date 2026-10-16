// App updates from GitHub Releases through tauri-plugin-updater. The endpoint and the public key that
// verifies each package live in `plugins.updater` of tauri.conf.json; this module drives the flow:
// check → download → install → restart. With `autoUpdate` on, the download runs in the background and
// the install happens when the window closes.
import { create } from "zustand";
import { toast } from "sonner";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit, relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { errorMessage, isTauri } from "./api";

export const RELEASES_URL = "https://github.com/Camilo-neck/BCDesktop/releases";

/** The part of the plugin's `Update` the app uses (the dev mock implements the same). */
export type UpdateHandle = Pick<Update, "version" | "currentVersion" | "download" | "install">;

export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing";

interface UpdaterState {
  phase: UpdatePhase;
  update: UpdateHandle | null;
  /** Bytes received and expected (`total` 0 when the server does not say). */
  received: number;
  total: number;
  /** Last check that found nothing new (ms since epoch). */
  upToDateAt: number | null;
  dialogOpen: boolean;
  setDialogOpen: (o: boolean) => void;
}

export const useUpdater = create<UpdaterState>((set) => ({
  phase: "idle",
  update: null,
  received: 0,
  total: 0,
  upToDateAt: null,
  dialogOpen: false,
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
}));

const patch = (p: Partial<UpdaterState>) => useUpdater.setState(p);

const mockMode = () => import.meta.env.DEV && !isTauri() && new URLSearchParams(window.location.search).has("update");

/** Whether this build can update itself: the installed app, or the dev mock with `?update`. */
export const updatesSupported = () => (isTauri() && !import.meta.env.DEV) || mockMode();

async function fetchUpdate(): Promise<UpdateHandle | null> {
  if (mockMode()) {
    const { mockUpdate } = await import("../dev/mock");
    return mockUpdate();
  }
  return check({ timeout: 20_000 });
}

/**
 * Look for a newer release. `manual` reports the outcome with a toast (including "up to date" and errors);
 * the startup check stays silent. Returns the update when one is available.
 */
export async function checkForUpdates(manual: boolean): Promise<UpdateHandle | null> {
  const { phase, update } = useUpdater.getState();
  if (phase !== "idle") {
    if (manual && update) patch({ dialogOpen: true });
    return update;
  }
  if (!updatesSupported()) {
    if (manual) toast("Las actualizaciones solo funcionan en la app instalada.");
    return null;
  }
  patch({ phase: "checking" });
  try {
    const found = await fetchUpdate();
    if (!found) {
      patch({ phase: "idle", upToDateAt: Date.now() });
      if (manual) toast.success("Ya tienes la última versión");
      return null;
    }
    patch({ phase: "available", update: found, upToDateAt: null });
    return found;
  } catch (e) {
    patch({ phase: "idle" });
    if (manual) toast.error("No se pudo buscar actualizaciones", { description: errorMessage(e) });
    else console.warn("update check failed", e);
    return null;
  }
}

async function download(update: UpdateHandle) {
  patch({ phase: "downloading", received: 0, total: 0 });
  await update.download((e: DownloadEvent) => {
    if (e.event === "Started") patch({ total: e.data.contentLength ?? 0 });
    else if (e.event === "Progress") useUpdater.setState((s) => ({ received: s.received + e.data.chunkLength }));
  });
  patch({ phase: "ready" });
}

async function installAndRestart(update: UpdateHandle) {
  patch({ phase: "installing" });
  // On Windows the installer closes the app itself and opens it again when it finishes.
  await update.install();
  if (isTauri()) await relaunch();
  else window.location.reload();
}

/** Download (when needed), install and restart. Errors leave the update available to retry. */
export async function updateNow() {
  const { update, phase } = useUpdater.getState();
  if (!update || phase === "downloading" || phase === "installing") return;
  try {
    if (phase !== "ready") await download(update);
    await installAndRestart(update);
  } catch (e) {
    patch({ phase: "available" });
    toast.error("No se pudo actualizar", { description: errorMessage(e) });
  }
}

let installOnClose = false;

/** Automatic mode: download without asking and install when the window closes. */
export async function downloadInBackground() {
  const { update, phase } = useUpdater.getState();
  if (!update || phase !== "available") return;
  try {
    await download(update);
  } catch (e) {
    patch({ phase: "available" });
    console.warn("background update download failed", e);
    return;
  }
  if (isTauri() && !installOnClose) {
    installOnClose = true;
    await getCurrentWindow().onCloseRequested(async (e) => {
      e.preventDefault();
      patch({ phase: "installing" });
      try {
        await update.install();
      } catch (err) {
        console.warn("update install on close failed", err);
      }
      await exit(0);
    });
  }
  toast(`BetterCampus ${update.version} se instalará al cerrar la app`, {
    duration: 10_000,
    action: { label: "Reiniciar ahora", onClick: () => void updateNow() },
  });
}

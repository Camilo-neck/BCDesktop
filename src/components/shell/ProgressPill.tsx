import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2, Minimize2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/lib/store";
import type { Progress } from "@/lib/types";

const LABEL = { courses: "Consultando el SIA", plan: "Descargando prerrequisitos", google: "Exportando a Google Calendar" } as const;

/** How long the finished state stays on screen before the indicator hides. */
const FINISHED_VISIBLE_MS = 2000;
const RING_R = 20;
const RING_LENGTH = 2 * Math.PI * RING_R;

// The indicator sits above dialogs (z-50) and below the guided tour (z-[100]). A modal dialog sets
// `pointer-events: none` on <body>, so the clickable parts re-enable them, and `data-above-dialogs`
// keeps a click on them from closing the dialog.
const SURFACE = "border border-outline-variant/60 bg-surface-lowest shadow-elev3 dark:bg-surface-high";

/**
 * Floating indicator for long tasks, fed by `bc://progress` events. It is drawn on <body> so it stays visible
 * and usable over any dialog. It can be minimized to a corner badge, and it shows "Listo" for a moment when
 * the task ends before hiding.
 */
export function ProgressPill() {
  const progress = useUi((s) => s.progress);
  const setProgress = useUi((s) => s.setProgress);
  const minimized = useUi((s) => s.progressMinimized);
  const setMinimized = useUi((s) => s.setProgressMinimized);
  const finished = !!progress && progress.done >= progress.total;

  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => setProgress(null), FINISHED_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [finished, setProgress]);

  const cancel = () => {
    void api.cancel();
    setProgress(null);
  };

  return createPortal(
    <AnimatePresence>
      {progress &&
        (minimized ? (
          <Badge key="badge" progress={progress} finished={finished} onExpand={() => setMinimized(false)} />
        ) : (
          <Pill key="pill" progress={progress} finished={finished} onMinimize={() => setMinimized(true)} onCancel={cancel} />
        ))}
    </AnimatePresence>,
    document.body,
  );
}

function percent(p: Progress) {
  return p.total ? Math.round((p.done / p.total) * 100) : 100;
}

function Pill({ progress, finished, onMinimize, onCancel }: { progress: Progress; finished: boolean; onMinimize: () => void; onCancel: () => void }) {
  return (
    // Centered with a full-width row: a translate class would be overwritten by the motion transform.
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4"
    >
      <div data-above-dialogs className={`pointer-events-auto w-full max-w-[420px] overflow-hidden rounded-2xl ${SURFACE}`}>
        <div className="flex items-center gap-3 px-4 py-3">
          {finished ? <Check className="size-4 shrink-0 text-primary" strokeWidth={2.6} /> : <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-[13px] font-medium">
              <span>{finished ? "Listo" : LABEL[progress.task]}</span>
              <span className="tabular text-xs text-on-surface-variant">
                {progress.done}/{progress.total}
              </span>
            </div>
            {!finished && progress.current && <div className="truncate text-xs text-on-surface-variant">{progress.current}</div>}
          </div>
          <button onClick={onMinimize} className="rounded-lg p-1 text-on-surface-variant hover:bg-on-surface/5" aria-label="Minimizar" title="Minimizar">
            <Minimize2 className="size-4" />
          </button>
          {!finished && progress.task !== "google" && (
            <button onClick={onCancel} className="rounded-lg p-1 text-on-surface-variant hover:bg-on-surface/5" aria-label="Cancelar" title="Cancelar">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="h-1 bg-outline-variant/40">
          <motion.div className="h-full bg-primary" animate={{ width: `${percent(progress)}%` }} transition={{ ease: "easeOut" }} />
        </div>
      </div>
    </motion.div>
  );
}

function Badge({ progress, finished, onExpand }: { progress: Progress; finished: boolean; onExpand: () => void }) {
  const pct = percent(progress);
  const label = finished ? "Tarea terminada" : `${LABEL[progress.task]}: ${pct} %. Clic para ver el detalle`;
  return (
    <motion.button
      data-above-dialogs
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      onClick={onExpand}
      className={`pointer-events-auto fixed bottom-4 right-4 z-[60] grid size-12 place-items-center rounded-full ${SURFACE}`}
      aria-label={label}
      title={label}
    >
      <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 48 48" aria-hidden>
        <circle cx="24" cy="24" r={RING_R} fill="none" strokeWidth="3" className="stroke-outline-variant/50" />
        <circle
          cx="24"
          cy="24"
          r={RING_R}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-300"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - pct / 100)}
        />
      </svg>
      {finished ? <Check className="size-5 text-primary" strokeWidth={2.6} /> : <span className="tabular text-[11px] font-semibold">{pct}%</span>}
    </motion.button>
  );
}

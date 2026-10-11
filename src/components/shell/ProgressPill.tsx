import { AnimatePresence, motion } from "motion/react";
import { Loader2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/lib/store";

const LABEL = { courses: "Consultando el SIA", plan: "Descargando prerrequisitos", google: "Exportando a Google Calendar" } as const;

/** Floating indicator for long SIA tasks, fed by `bc://progress` events. */
export function ProgressPill() {
  const progress = useUi((s) => s.progress);
  const setProgress = useUi((s) => s.setProgress);
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <AnimatePresence>
      {progress && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="pointer-events-auto absolute bottom-4 left-1/2 z-40 w-[min(92%,420px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-lowest shadow-elev3 dark:bg-surface-high"
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 text-[13px] font-medium">
                <span>{LABEL[progress.task]}</span>
                <span className="tabular text-xs text-on-surface-variant">
                  {progress.done}/{progress.total}
                </span>
              </div>
              {progress.current && <div className="truncate text-xs text-on-surface-variant">{progress.current}</div>}
            </div>
            {progress.task !== "google" && (
              <button
                onClick={() => {
                  void api.cancel();
                  setProgress(null);
                }}
                className="rounded-lg p-1 text-on-surface-variant hover:bg-on-surface/5"
                aria-label="Cancelar"
                title="Cancelar"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="h-1 bg-outline-variant/40">
            <motion.div className="h-full bg-primary" animate={{ width: `${pct}%` }} transition={{ ease: "easeOut" }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

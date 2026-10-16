import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSetSetting, useSettings, useSettingsLoaded } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { TOURS, type TourId, type TourStep } from "./tours";

interface TourState {
  id: TourId | null;
  step: number;
  start: (id: TourId) => void;
  go: (step: number) => void;
  stop: () => void;
}

export const useTourStore = create<TourState>((set) => ({
  id: null,
  step: 0,
  start: (id) => set({ id, step: 0 }),
  go: (step) => set({ step }),
  stop: () => set({ id: null, step: 0 }),
}));

/** Start `id` once, the first time `ready` becomes true and the tour was never completed. */
export function useAutoTour(id: TourId, ready = true) {
  const settings = useSettings();
  const start = useTourStore((s) => s.start);
  const running = useTourStore((s) => s.id);
  const loaded = useSettingsLoaded();
  useEffect(() => {
    if (!ready || !loaded || settings.tours[id] || running) return;
    const t = setTimeout(() => start(id), 650);
    return () => clearTimeout(t);
  }, [ready, loaded, settings.tours, id, running, start]);
}

const PAD = 8;
const CARD_W = 340;

function findTarget(step: TourStep | undefined): DOMRect | null {
  if (!step?.target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width === 0 && r.height === 0 ? null : r;
}

function cardPosition(rect: DOMRect | null, placement: TourStep["placement"], cardH: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) return { left: (vw - CARD_W) / 2, top: Math.max(24, (vh - cardH) / 2) };
  const gap = 14;
  let left = rect.left;
  let top = rect.bottom + gap;
  switch (placement) {
    case "right":
      left = rect.right + gap;
      top = rect.top;
      break;
    case "left":
      left = rect.left - CARD_W - gap;
      top = rect.top;
      break;
    case "top":
      left = rect.left + rect.width / 2 - CARD_W / 2;
      top = rect.top - cardH - gap;
      break;
    default:
      left = rect.left + rect.width / 2 - CARD_W / 2;
  }
  // Flip when there is no room, then clamp into the window.
  if (placement === "left" && left < 12) left = rect.right + gap;
  if (placement === "right" && left + CARD_W > vw - 12) left = rect.left - CARD_W - gap;
  if (placement === "top" && top < 12) top = rect.bottom + gap;
  if ((placement === "bottom" || !placement) && top + cardH > vh - 12) top = rect.top - cardH - gap;
  return {
    left: Math.min(Math.max(12, left), vw - CARD_W - 12),
    top: Math.min(Math.max(12, top), vh - cardH - 12),
  };
}

export function TourHost() {
  const { id, step, go, stop } = useTourStore();
  const settings = useSettings();
  const setSetting = useSetSetting();
  const steps = id ? TOURS[id] : [];
  const current = steps[step];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardH, setCardH] = useState(180);
  const [card, setCard] = useState<HTMLDivElement | null>(null);

  const complete = useCallback(() => {
    if (id) void setSetting("tours", { ...settings.tours, [id]: true });
    stop();
  }, [id, settings.tours, setSetting, stop]);

  // A skipped tour never starts on its own again, so say where to replay it.
  const skip = useCallback(() => {
    complete();
    toast("Puedes repetir el tutorial cuando quieras en Ajustes › Tutoriales.");
  }, [complete]);

  const next = useCallback(() => (step + 1 < steps.length ? go(step + 1) : complete()), [step, steps.length, go, complete]);
  const back = useCallback(() => step > 0 && go(step - 1), [step, go]);

  // Follow the target while the layout moves (panels opening, window resize).
  useLayoutEffect(() => {
    if (!current) return;
    let raf = 0;
    const tick = () => {
      const r = findTarget(current);
      setRect((prev) =>
        prev && r && Math.abs(prev.x - r.x) < 0.5 && Math.abs(prev.y - r.y) < 0.5 && Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5
          ? prev
          : r,
      );
      raf = requestAnimationFrame(tick);
    };
    document.querySelector(`[data-tour="${current.target}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    tick();
    return () => cancelAnimationFrame(raf);
  }, [current]);

  useLayoutEffect(() => {
    if (card) setCardH(card.offsetHeight);
  }, [card, step, id]);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [id, next, back, skip]);

  if (!id || !current) return null;
  const pos = cardPosition(rect, current.placement, cardH);
  const hole = rect && { x: rect.left - PAD, y: rect.top - PAD, w: rect.width + PAD * 2, h: rect.height + PAD * 2 };

  return createPortal(
    // A modal dialog sets `pointer-events: none` on <body>, which this portal would inherit: re-enable it so the
    // tour stays usable over dialogs. `data-above-dialogs` lets dialogs ignore clicks here (see DialogContent).
    // The backdrop has no click handler: only Omitir, the close button or Esc skip a tour.
    <div data-above-dialogs className="pointer-events-auto fixed inset-0 z-[100]" aria-live="polite">
      <svg className="absolute inset-0 size-full">
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole && (
              <motion.rect
                initial={false}
                animate={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
                rx="14"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(0 0 0 / 0.55)" mask="url(#tour-mask)" />
        {hole && (
          <motion.rect
            initial={false}
            animate={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            rx="14"
            fill="none"
            style={{ stroke: "rgb(var(--primary))" }}
            strokeWidth="2"
          />
        )}
      </svg>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${id}-${step}`}
          ref={setCard}
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1, left: pos.left, top: pos.top }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          style={{ width: CARD_W, position: "absolute" }}
          className="rounded-2xl border border-outline-variant/60 bg-surface-lowest p-5 shadow-elev3 dark:bg-surface-high"
          role="dialog"
          aria-label={current.title}
        >
          <button onClick={skip} className="absolute right-3 top-3 rounded-lg p-1 text-on-surface-variant hover:bg-on-surface/5" aria-label="Cerrar recorrido">
            <X className="size-4" />
          </button>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
            Paso {step + 1} de {steps.length}
          </div>
          <h3 className="pr-6 text-[15px] font-semibold">{current.title}</h3>
          <div className="mt-1.5 text-sm leading-relaxed text-on-surface-variant">{current.body}</div>
          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : "w-1.5 bg-outline-variant")} />
              ))}
            </div>
            <div className="flex gap-1.5">
              {step > 0 ? (
                <Button variant="ghost" size="sm" onClick={back}>
                  <ArrowLeft /> Atrás
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={skip}>
                  Omitir
                </Button>
              )}
              <Button size="sm" onClick={next}>
                {step + 1 === steps.length ? "Entendido" : "Siguiente"} {step + 1 < steps.length && <ArrowRight />}
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}

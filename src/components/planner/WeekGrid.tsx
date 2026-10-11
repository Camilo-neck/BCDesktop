import { forwardRef, useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Lock } from "lucide-react";
import type { ResolvedSelection } from "@/lib/data";
import type { Block, Day } from "@/lib/types";
import { DAY_LONG, DAY_SHORT, cn, groupTag, hhmm } from "@/lib/utils";

export interface GridEvent {
  key: string;
  day: Day;
  start: number;
  end: number;
  title: string;
  subtitle: string;
  room: string;
  color: string;
  kind: "class" | "preview" | "block";
  conflict?: boolean;
  source?: ResolvedSelection;
  block?: Block;
}

export function eventsFrom(resolved: ResolvedSelection[], kind: "class" | "preview" = "class"): GridEvent[] {
  return resolved.flatMap((r) =>
    r.group.sessions.map((s, i) => ({
      key: `${kind}:${r.course.code}:${r.group.id}:${i}`,
      day: s.day,
      start: s.start,
      end: s.end,
      title: r.course.name,
      subtitle: groupTag(r.group.id),
      room: s.room,
      color: r.color,
      kind,
      source: r,
    })),
  );
}

export function blockEvents(blocks: Block[]): GridEvent[] {
  return blocks.map((b, i) => ({
    key: `block:${i}`,
    day: b.day,
    start: b.start,
    end: b.end,
    title: b.label || "Bloque personal",
    subtitle: "",
    room: "",
    color: "#727970",
    kind: "block",
    block: b,
  }));
}

/** Side-by-side columns for events that overlap on the same day. */
function layoutColumns(events: GridEvent[]) {
  const out = new Map<string, { col: number; cols: number }>();
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: GridEvent[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols: number[] = [];
    const assigned: [GridEvent, number][] = [];
    for (const e of cluster) {
      let c = cols.findIndex((end) => end <= e.start);
      if (c === -1) {
        c = cols.length;
        cols.push(e.end);
      } else cols[c] = e.end;
      assigned.push([e, c]);
    }
    for (const [e, c] of assigned) out.set(e.key, { col: c, cols: cols.length });
    cluster = [];
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  flush();
  return out;
}

function withAlpha(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

const TODAY_INDEX = (new Date().getDay() + 6) % 7;

export function WeekGrid({
  events,
  days,
  hours,
  renderPopover,
  compact,
  className,
}: {
  events: GridEvent[];
  days: Day[];
  hours: [number, number];
  renderPopover?: (e: GridEvent, trigger: ReactNode) => ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(600);
  const [now, setNow] = useState(() => new Date());
  const [h0, h1] = hours;
  const span = Math.max(1, h1 - h0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const header = compact ? 24 : 34;
  const rowH = Math.max(compact ? 14 : 34, (height - header - 8) / span);
  const y = (m: number) => ((m - h0 * 60) / 60) * rowH;

  const byDay = useMemo(() => {
    const m = new Map<Day, GridEvent[]>();
    for (const d of days) m.set(d, []);
    for (const e of events) if (e.end > h0 * 60 && e.start < h1 * 60) m.get(e.day)?.push(e);
    return m;
  }, [events, days, h0, h1]);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowDay = days.findIndex((d) => ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].indexOf(d) === TODAY_INDEX);

  return (
    <div ref={wrap} className={cn("scroll-thin relative h-full overflow-y-auto overflow-x-hidden", className)}>
      <div className="relative flex" style={{ height: header + span * rowH + 8 }}>
        {/* Hour labels */}
        <div className={cn("relative shrink-0", compact ? "w-8" : "w-14")} style={{ paddingTop: header }}>
          {Array.from({ length: span + 1 }, (_, i) => (
            <div
              key={i}
              className={cn("tabular absolute right-2 -translate-y-1/2 text-on-surface-variant", compact ? "text-[9px]" : "text-[11px]")}
              style={{ top: header + i * rowH }}
            >
              {compact ? h0 + i : `${String(h0 + i).padStart(2, "0")}:00`}
            </div>
          ))}
        </div>

        <div className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {/* Hour lines */}
          <div className="pointer-events-none absolute inset-x-0" style={{ top: header }}>
            {Array.from({ length: span + 1 }, (_, i) => (
              <div key={i} className="absolute inset-x-0 border-t border-outline-variant/50" style={{ top: i * rowH }} />
            ))}
            {!compact &&
              Array.from({ length: span }, (_, i) => (
                <div key={`h${i}`} className="absolute inset-x-0 border-t border-dashed border-outline-variant/25" style={{ top: i * rowH + rowH / 2 }} />
              ))}
          </div>

          {days.map((d, di) => {
            const list = byDay.get(d) ?? [];
            const cols = layoutColumns(list);
            const isToday = di === nowDay;
            return (
              <div key={d} className={cn("relative border-l border-outline-variant/40", di === 0 && "border-l-0")}>
                <div
                  className={cn(
                    "sticky top-0 z-20 flex items-center justify-center bg-surface/90 backdrop-blur",
                    compact ? "h-6 text-[10px]" : "h-[34px] text-[12px]",
                  )}
                  title={DAY_LONG[d]}
                >
                  <span className={cn("rounded-full px-2 py-0.5 font-medium text-on-surface-variant", isToday && "bg-primary/10 text-primary")}>
                    {compact ? DAY_SHORT[d].slice(0, 1) : DAY_SHORT[d]}
                  </span>
                </div>
                <div className="absolute inset-x-0" style={{ top: header, height: span * rowH }}>
                  {isToday && nowMin > h0 * 60 && nowMin < h1 * 60 && (
                    <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: y(nowMin) }}>
                      <span className="-ml-1 size-2 rounded-full bg-error" />
                      <span className="h-px flex-1 bg-error/70" />
                    </div>
                  )}
                  {list.map((e) => {
                    const { col, cols: n } = cols.get(e.key) ?? { col: 0, cols: 1 };
                    const top = y(Math.max(e.start, h0 * 60));
                    const h = Math.max(compact ? 6 : 18, y(Math.min(e.end, h1 * 60)) - top - 2);
                    const card = (
                      <EventCard key={e.key} event={e} compact={!!compact} height={h} style={{ top, height: h, left: `calc(${(col / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` }} />
                    );
                    return renderPopover && e.kind !== "preview" ? (
                      <div key={e.key}>{renderPopover(e, card)}</div>
                    ) : (
                      card
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type CardProps = { event: GridEvent; compact: boolean; height: number } & ComponentPropsWithoutRef<typeof motion.button>;

const EventCard = forwardRef<HTMLButtonElement, CardProps>(function EventCard({ event: e, compact, height, style, className, ...rest }, ref) {
  const isBlock = e.kind === "block";
  const isPreview = e.kind === "preview";
  const tall = height > 46;
  return (
    <motion.button
      ref={ref}
      {...rest}
      layout={!compact}
      initial={isPreview ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15 }}
      type="button"
      tabIndex={isPreview ? -1 : 0}
      className={cn(
        "group absolute overflow-hidden rounded-lg text-left transition-shadow",
        compact ? "rounded-[4px]" : "border-l-[3px] px-2 py-1 hover:shadow-elev2",
        isPreview && "pointer-events-none border border-dashed",
        isBlock && "bg-[repeating-linear-gradient(135deg,rgb(var(--outline)/0.10)_0_6px,transparent_6px_12px)]",
        e.conflict && "ring-2 ring-error ring-offset-1 ring-offset-surface",
        className,
      )}
      style={{
        ...style,
        borderColor: e.conflict ? "rgb(var(--error))" : e.color,
        background: isBlock ? undefined : withAlpha(e.color, isPreview ? 0.1 : compact ? 0.85 : 0.16),
      }}
      title={`${e.title} · ${hhmm(e.start)}–${hhmm(e.end)}${e.room ? ` · ${e.room}` : ""}`}
    >
      {!compact && (
        <>
          <div className="flex items-start gap-1">
            {e.conflict && <AlertTriangle className="mt-0.5 size-3 shrink-0 text-error" />}
            {isBlock && <Lock className="mt-0.5 size-3 shrink-0 text-on-surface-variant" />}
            <div className={cn("text-[12px] font-semibold leading-tight text-on-surface", tall ? "line-clamp-2" : "line-clamp-1")}>{e.title}</div>
          </div>
          {height > 30 && (
            <div className="tabular mt-0.5 truncate text-[10.5px] text-on-surface-variant">
              {hhmm(e.start)}–{hhmm(e.end)} {e.subtitle && `· ${e.subtitle}`}
            </div>
          )}
          {tall && e.room && <div className="mt-0.5 line-clamp-1 text-[10.5px] text-on-surface-variant/80">{e.room}</div>}
        </>
      )}
    </motion.button>
  );
});

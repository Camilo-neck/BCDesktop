import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Lock, Maximize2, Minus, Plus, Sparkle } from "lucide-react";
import type { CurriculumGraph, GraphNode } from "@/lib/types";
import { cn, TYPOLOGY } from "@/lib/utils";

const NODE_W = 208;
const NODE_H = 58;
const GAP_X = 92;
const GAP_Y = 18;
const PAD = 40;
/** Courses and arrows unrelated to the hovered or selected course fade to this, but stay readable. */
const DIM_OPACITY = 0.3;
/** Arrows when nothing is highlighted, so the cards stay in front. */
const IDLE_EDGE_OPACITY = 0.5;

const TYPO_VAR: Record<string, string> = {
  fundamental: "--typ-fundamental",
  disciplinar: "--typ-disciplinar",
  libre: "--typ-libre",
  nivelacion: "--typ-nivelacion",
  grado: "--typ-grado",
  otra: "--outline",
};

interface Positioned extends GraphNode {
  x: number;
  y: number;
}

function closure(start: string, next: Map<string, string[]>) {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const v = stack.pop()!;
    for (const n of next.get(v) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
  }
  return seen;
}

export function GraphView({
  graph,
  selected,
  onSelect,
  focus,
}: {
  graph: CurriculumGraph;
  selected: string | null;
  onSelect: (code: string | null) => void;
  /** Code to center on (search). */
  focus: string | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  const { nodes, byCode, size, preds, succs } = useMemo(() => {
    const preds = new Map<string, string[]>();
    const succs = new Map<string, string[]>();
    for (const e of graph.edges) {
      preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
      succs.set(e.from, [...(succs.get(e.from) ?? []), e.to]);
    }
    // Courses without any prerequisite relation would make one endless column:
    // pack them into a grid of their own on the left.
    const isolated = graph.nodes.filter((n) => !preds.has(n.code) && !succs.has(n.code)).sort((a, b) => a.name.localeCompare(b.name));
    const linked = graph.nodes.filter((n) => preds.has(n.code) || succs.has(n.code));
    const layers = [...new Set(linked.map((n) => n.layer))].sort((a, b) => a - b);
    const column = new Map(layers.map((l, i) => [l, i]));
    const byColumn = new Map<number, GraphNode[]>();
    for (const n of linked) byColumn.set(column.get(n.layer)!, [...(byColumn.get(column.get(n.layer)!) ?? []), n]);
    for (const list of byColumn.values()) list.sort((a, b) => a.order - b.order);
    const tallest = Math.max(1, ...[...byColumn.values()].map((l) => l.length));
    const rowsPerIsoCol = Math.max(6, tallest);
    const isoCols = Math.ceil(isolated.length / rowsPerIsoCol);
    const shift = isoCols ? isoCols * (NODE_W + 24) + GAP_X : 0;

    const positioned: Positioned[] = [];
    isolated.forEach((n, i) =>
      positioned.push({ ...n, x: PAD + Math.floor(i / rowsPerIsoCol) * (NODE_W + 24), y: PAD + (i % rowsPerIsoCol) * (NODE_H + GAP_Y) }),
    );
    for (const [col, list] of byColumn) {
      const offset = ((tallest - list.length) * (NODE_H + GAP_Y)) / 2; // center short columns
      list.forEach((n, i) => positioned.push({ ...n, x: PAD + shift + col * (NODE_W + GAP_X), y: PAD + offset + i * (NODE_H + GAP_Y) }));
    }
    const rows = Math.max(tallest, isolated.length ? Math.min(rowsPerIsoCol, isolated.length) : 0);
    return {
      nodes: positioned,
      byCode: new Map(positioned.map((n) => [n.code, n])),
      size: { w: PAD * 2 + shift + Math.max(1, layers.length) * (NODE_W + GAP_X) - GAP_X, h: PAD * 2 + rows * (NODE_H + GAP_Y) - GAP_Y },
      preds,
      succs,
    };
  }, [graph]);

  const active = hover ?? selected;
  const lit = useMemo(() => {
    if (!active) return null;
    const up = closure(active, preds);
    const down = closure(active, succs);
    return { up, down, all: new Set([active, ...up, ...down]) };
  }, [active, preds, succs]);

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const k = Math.min(1.1, Math.max(0.2, Math.min(el.clientWidth / size.w, el.clientHeight / size.h)));
    setView({ k, x: (el.clientWidth - size.w * k) / 2, y: Math.max(0, (el.clientHeight - size.h * k) / 2) });
  }, [size]);

  // Open at a readable zoom on the first semesters; "fit" shows everything.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const k = Math.min(1, Math.max(0.65, Math.min(el.clientWidth / size.w, el.clientHeight / size.h)));
    setView({ k, x: 16, y: Math.max(16, (el.clientHeight - size.h * k) / 2) });
  }, [size]);

  useEffect(() => {
    const el = wrap.current;
    const n = focus ? byCode.get(focus) : undefined;
    if (!el || !n) return;
    const k = Math.max(view.k, 0.9);
    setView({ k, x: el.clientWidth / 2 - (n.x + NODE_W / 2) * k, y: el.clientHeight / 2 - (n.y + NODE_H / 2) * k });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Wheel zooms around the cursor.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return { ...v, x: v.x - e.deltaX };
        const k = Math.min(2.2, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoom = (f: number) => {
    const el = wrap.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setView((v) => {
      const k = Math.min(2.2, Math.max(0.15, v.k * f));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };

  return (
    <div
      ref={wrap}
      data-tour="graph"
      className="relative h-full cursor-grab overflow-hidden rounded-2xl border border-outline-variant/50 bg-surface-lowest active:cursor-grabbing dark:bg-surface-low"
      style={{ backgroundImage: "radial-gradient(rgb(var(--outline-variant) / 0.6) 1px, transparent 1px)", backgroundSize: `${22 * view.k}px ${22 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && e.target === e.currentTarget) onSelect(null);
      }}
    >
      <svg className="absolute left-0 top-0 overflow-visible" width={size.w} height={size.h} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" style={{ fill: "rgb(var(--outline))" }} />
          </marker>
          <marker id="arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" style={{ fill: "rgb(var(--primary))" }} />
          </marker>
        </defs>
        <g>
          {graph.edges.map((e, i) => {
            const a = byCode.get(e.from);
            const b = byCode.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x - 2;
            const y2 = b.y + NODE_H / 2;
            const back = x2 <= x1;
            const c = Math.max(40, Math.abs(x2 - x1) / 2);
            const d = back
              ? `M${a.x + NODE_W / 2} ${a.y + NODE_H} C ${a.x + NODE_W / 2} ${a.y + NODE_H + 60}, ${b.x + NODE_W / 2} ${b.y + NODE_H + 60}, ${b.x + NODE_W / 2} ${b.y + NODE_H}`
              : `M${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
            const on = !!lit && lit.all.has(e.from) && lit.all.has(e.to) && (e.to === active || e.from === active || lit.up.has(e.to) || lit.down.has(e.from));
            const coreq = ["I", "E", "D"].includes(e.kind);
            return (
              <path
                key={i}
                d={d}
                fill="none"
                style={{ stroke: on ? "rgb(var(--primary))" : "rgb(var(--outline))" }}
                // `opacity` (not `strokeOpacity`) so the arrowhead marker fades with its line.
                opacity={lit ? (on ? 1 : DIM_OPACITY) : IDLE_EDGE_OPACITY}
                strokeWidth={on ? 2 : 1.2}
                strokeDasharray={coreq || !e.all ? "5 4" : undefined}
                markerEnd={on ? "url(#arrow-lit)" : "url(#arrow)"}
              />
            );
          })}
        </g>
        {nodes.map((n) => (
          <NodeCard
            key={n.code}
            n={n}
            dim={!!lit && !lit.all.has(n.code)}
            selected={selected === n.code}
            onEnter={() => setHover(n.code)}
            onLeave={() => setHover(null)}
            onClick={() => onSelect(n.code === selected ? null : n.code)}
          />
        ))}
      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-lowest shadow-elev1 dark:bg-surface-high" onPointerDown={(e) => e.stopPropagation()}>
        <button className="grid size-9 place-items-center hover:bg-on-surface/5" onClick={() => zoom(1.2)} aria-label="Acercar">
          <Plus className="size-4" />
        </button>
        <button className="grid size-9 place-items-center hover:bg-on-surface/5" onClick={() => zoom(1 / 1.2)} aria-label="Alejar">
          <Minus className="size-4" />
        </button>
        <button className="grid size-9 place-items-center border-t border-outline-variant/50 hover:bg-on-surface/5" onClick={fit} aria-label="Ajustar a la pantalla">
          <Maximize2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function NodeCard({ n, dim, selected, onEnter, onLeave, onClick }: { n: Positioned; dim: boolean; selected: boolean; onEnter: () => void; onLeave: () => void; onClick: () => void }) {
  const t = TYPOLOGY[n.typology];
  const color = `rgb(var(${TYPO_VAR[t.color]}))`;
  const external = n.status === "external";
  return (
    <foreignObject
      x={n.x}
      y={n.y}
      width={NODE_W}
      height={NODE_H}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      <div
        className={cn(
          "flex h-full cursor-pointer items-stretch overflow-hidden rounded-xl border bg-surface-lowest text-left shadow-elev1 transition hover:shadow-elev2 dark:bg-surface-high",
          n.status === "approved" && "border-primary/50 bg-primary/[0.08] dark:bg-primary/[0.12]",
          n.status === "available" && "border-primary ring-2 ring-primary/25",
          n.status === "locked" && "border-outline-variant/70",
          external && "border-dashed border-outline bg-transparent shadow-none dark:bg-transparent",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
        )}
        // Opacity on the card, not on the <foreignObject>: engines are less consistent with a translucent foreignObject.
        style={{ opacity: dim ? DIM_OPACITY : 1 }}
      >
        {!external && <span className="w-1.5 shrink-0" style={{ background: color }} />}
        <div className="flex min-w-0 flex-1 flex-col justify-center px-2.5">
          <div className={cn("line-clamp-2 text-[12px] font-semibold leading-tight", external && "font-medium italic text-on-surface-variant")}>{n.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-on-surface-variant">
            <span className="tabular">{n.code}</span>
            {!external && <span>· {n.credits} cr</span>}
          </div>
        </div>
        <div className="flex items-center pr-2">
          {n.status === "approved" && <Check className="size-4 text-primary" strokeWidth={2.6} />}
          {n.status === "available" && <Sparkle className="size-3.5 fill-primary text-primary" />}
          {n.status === "locked" && n.conditions.length > 0 && <Lock className="size-3 text-on-surface-variant/50" />}
        </div>
      </div>
    </foreignObject>
  );
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Course, Day, Group, Session, Typology } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const DAY_SHORT: Record<Day, string> = { MON: "Lun", TUE: "Mar", WED: "Mié", THU: "Jue", FRI: "Vie", SAT: "Sáb", SUN: "Dom" };
export const DAY_LONG: Record<Day, string> = {
  MON: "Lunes",
  TUE: "Martes",
  WED: "Miércoles",
  THU: "Jueves",
  FRI: "Viernes",
  SAT: "Sábado",
  SUN: "Domingo",
};

export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : null;
}

export function sessionLine(s: Session) {
  return `${DAY_SHORT[s.day]} ${hhmm(s.start)}–${hhmm(s.end)}`;
}

export function groupSchedule(g: Group) {
  return g.sessions.length ? g.sessions.map(sessionLine).join(" · ") : "Sin horario publicado";
}

export function professorLine(g: Group) {
  return g.professors.length ? g.professors.join(", ") : "Profesor no informado";
}

export const TYPOLOGY: Record<Typology, { label: string; short: string; color: string }> = {
  FUND_OBLIGATORIA: { label: "Fund. obligatoria", short: "FO", color: "fundamental" },
  FUND_OPTATIVA: { label: "Fund. optativa", short: "FP", color: "fundamental" },
  DISC_OBLIGATORIA: { label: "Disciplinar obligatoria", short: "DO", color: "disciplinar" },
  DISC_OPTATIVA: { label: "Disciplinar optativa", short: "DP", color: "disciplinar" },
  LIBRE_ELECCION: { label: "Libre elección", short: "LE", color: "libre" },
  NIVELACION: { label: "Nivelación", short: "NV", color: "nivelacion" },
  TRABAJO_GRADO: { label: "Trabajo de grado", short: "TG", color: "grado" },
  OTHER: { label: "Otra", short: "—", color: "otra" },
};

/** Tailwind classes per typology color (listed literally so JIT keeps them). */
export const TYPOLOGY_CLASSES: Record<string, string> = {
  fundamental: "bg-typology-fundamental/10 text-typology-fundamental",
  disciplinar: "bg-typology-disciplinar/15 text-typology-disciplinar",
  libre: "bg-typology-libre/10 text-typology-libre",
  nivelacion: "bg-typology-nivelacion/10 text-typology-nivelacion",
  grado: "bg-typology-grado/10 text-typology-grado",
  otra: "bg-outline/10 text-on-surface-variant",
};

export function overlaps(a: Session, b: Session) {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

export function groupsCollide(a: Group, b: Group) {
  return a.sessions.some((x) => b.sessions.some((y) => overlaps(x, y)));
}

/** Days since the course data was downloaded. */
export function ageInDays(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

export function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

export function courseCredits(courses: Course[], codes: Iterable<string>) {
  const set = new Set(codes);
  return courses.filter((c) => set.has(c.code)).reduce((a, c) => a + c.credits, 0);
}

/** Readable text color (black/white) for a background hex. */
export function contrastText(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#111411" : "#ffffff";
}

export const formatGrade = (g: number | null | undefined) => (g == null ? "—" : g.toFixed(1));
export const formatAvg = (g: number | null | undefined) => (g == null ? "—" : g.toFixed(2));

export const isMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
export const modKey = () => (isMac() ? "⌘" : "Ctrl");

export function normalizeText(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** "G3" for numbered groups, the raw id for named ones ("SUMA-01"). */
export const groupTag = (id: string) => (/^\d+$/.test(id) ? `G${id}` : id);

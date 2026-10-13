import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { motion } from "motion/react";
import {
  CalendarRange,
  ChevronsLeft,
  ChevronsRight,
  GraduationCap,
  House,
  Info,
  Moon,
  Search,
  Settings as SettingsIcon,
  Sun,
  Waypoints,
} from "lucide-react";
import logo from "@/assets/logo.png";
import { Tooltip } from "@/components/ui/primitives";
import { Kbd } from "@/components/ui/misc";
import { useAutoTour } from "@/components/tour/Tour";
import { useSetSetting, useSettings } from "@/lib/settings";
import { useUi } from "@/lib/store";
import { cn, modKey } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { ProgressPill } from "./ProgressPill";

const NAV = [
  { to: "/", label: "Inicio", icon: House, hotkey: "1" },
  { to: "/planner", label: "Planeador", icon: CalendarRange, hotkey: "2" },
  { to: "/progress", label: "Mi avance", icon: GraduationCap, hotkey: "3" },
  { to: "/curriculum", label: "Plan de estudios", icon: Waypoints, hotkey: "4" },
];

function readCollapsed() {
  try {
    return localStorage.getItem("bc-rail") === "collapsed";
  } catch {
    return false;
  }
}

function RailLink({ to, label, icon: Icon, collapsed, shortcut }: { to: string; label: string; icon: typeof House; collapsed: boolean; shortcut?: string }) {
  return (
    <Tooltip content={collapsed ? label : null} side="right" shortcut={shortcut}>
      <NavLink
        to={to}
        end={to === "/"}
        className={({ isActive }) =>
          cn(
            "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[13.5px] font-medium text-on-surface-variant transition-colors hover:bg-on-surface/[0.05] hover:text-on-surface",
            isActive && "text-on-surface",
            collapsed && "justify-center px-0",
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <motion.span
                layoutId="rail-active"
                className="absolute inset-0 rounded-xl bg-secondary-container"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <Icon className={cn("relative size-[18px] shrink-0", isActive && "text-primary")} strokeWidth={isActive ? 2.2 : 1.8} />
            {!collapsed && <span className="relative truncate">{label}</span>}
          </>
        )}
      </NavLink>
    </Tooltip>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const navigate = useNavigate();
  const { theme } = useSettings();
  const setSetting = useSetSetting();
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  useAutoTour("welcome");

  const isDark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    try {
      localStorage.setItem("bc-rail", collapsed ? "collapsed" : "open");
    } catch {
      /* not persisted */
    }
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const item = NAV.find((n) => n.hotkey === e.key);
      if (item) {
        e.preventDefault();
        navigate(item.to);
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === ",") {
        e.preventDefault();
        navigate("/settings");
      } else if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, setPaletteOpen]);

  return (
    <div className="flex h-full bg-surface-container/60 dark:bg-surface-lowest">
      <aside
        className={cn(
          "flex shrink-0 flex-col gap-1 px-3 pb-3 pt-4 transition-[width] duration-200 ease-out",
          collapsed ? "w-[68px]" : "w-[232px]",
        )}
      >
        <div className={cn("mb-4 flex items-center gap-2.5 px-1.5", collapsed && "justify-center px-0")}>
          <img src={logo} alt="" className="size-8 shrink-0" draggable={false} />
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">
                Better<span className="text-primary">Campus</span>
              </div>
              <div className="text-[11px] text-on-surface-variant">Escritorio</div>
            </div>
          )}
        </div>

        <button
          data-tour="palette"
          onClick={() => setPaletteOpen(true)}
          className={cn(
            "mb-3 flex h-9 items-center gap-2.5 rounded-xl border border-outline-variant/70 bg-surface-lowest px-3 text-[13px] text-on-surface-variant transition hover:border-outline dark:bg-surface-low",
            collapsed && "justify-center px-0",
          )}
        >
          <Search className="size-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Buscar…</span>
              <Kbd>{modKey()}</Kbd>
              <Kbd>K</Kbd>
            </>
          )}
        </button>

        <nav data-tour="nav" className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <RailLink key={n.to} {...n} collapsed={collapsed} shortcut={`${modKey()} ${n.hotkey}`} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-0.5">
          <div data-tour="settings">
            <RailLink to="/settings" label="Ajustes" icon={SettingsIcon} collapsed={collapsed} shortcut={`${modKey()} ,`} />
          </div>
          <RailLink to="/about" label="Acerca de" icon={Info} collapsed={collapsed} />
          <div className={cn("mt-2 flex items-center gap-1", collapsed ? "flex-col" : "px-1")}>
            <Tooltip content={isDark ? "Tema claro" : "Tema oscuro"} side="right">
              <button
                onClick={() => setSetting("theme", isDark ? "light" : "dark")}
                className="grid size-9 place-items-center rounded-xl text-on-surface-variant transition hover:bg-on-surface/[0.06] hover:text-on-surface"
                aria-label="Cambiar tema"
              >
                {isDark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
              </button>
            </Tooltip>
            {theme === "system" && !collapsed && <span className="text-[11px] text-on-surface-variant">Sistema</span>}
            <Tooltip content={collapsed ? "Expandir" : "Contraer"} side="right" shortcut={`${modKey()} B`}>
              <button
                onClick={() => setCollapsed((c) => !c)}
                className={cn(
                  "grid size-9 place-items-center rounded-xl text-on-surface-variant transition hover:bg-on-surface/[0.06] hover:text-on-surface",
                  !collapsed && "ml-auto",
                )}
                aria-label="Contraer menú"
              >
                {collapsed ? <ChevronsRight className="size-[18px]" /> : <ChevronsLeft className="size-[18px]" />}
              </button>
            </Tooltip>
          </div>
        </div>
      </aside>

      <main className="relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-outline-variant/50 bg-surface shadow-elev1 dark:bg-surface">
        {/* No page transition: any fade that starts invisible leaves the panel blank for a moment. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
        <ProgressPill />
      </main>
      <CommandPalette />
    </div>
  );
}

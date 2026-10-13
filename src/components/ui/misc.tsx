import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn, TYPOLOGY, TYPOLOGY_CLASSES } from "@/lib/utils";
import type { Typology } from "@/lib/types";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(
  ({ className, icon, ...p }, ref) => (
    <div className={cn("relative flex items-center", className)}>
      {icon && <span className="pointer-events-none absolute left-3 text-on-surface-variant [&_svg]:size-4">{icon}</span>}
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-xl border border-outline-variant bg-surface-lowest px-3 text-sm outline-none transition placeholder:text-on-surface-variant/70 hover:border-outline focus:border-primary focus:ring-4 focus:ring-primary/15 dark:bg-surface-container",
          icon && "pl-9",
        )}
        {...p}
      />
    </div>
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "scroll-thin w-full resize-none rounded-xl border border-outline-variant bg-surface-lowest p-3 text-sm outline-none transition placeholder:text-on-surface-variant/70 focus:border-primary focus:ring-4 focus:ring-primary/15 dark:bg-surface-container",
      className,
    )}
    {...p}
  />
));
Textarea.displayName = "Textarea";

export function Label({ children, hint, className }: { children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-1.5 flex items-baseline justify-between gap-2", className)}>
      <span className="text-[13px] font-medium">{children}</span>
      {hint && <span className="text-xs text-on-surface-variant">{hint}</span>}
    </div>
  );
}

export function Badge({ className, ...p }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium leading-none [&_svg]:size-3", className)}
      {...p}
    />
  );
}

export function TypologyBadge({ typology, short }: { typology: Typology; short?: boolean }) {
  const t = TYPOLOGY[typology];
  return (
    <Badge className={TYPOLOGY_CLASSES[t.color]} title={t.label}>
      {short ? t.short : t.label}
    </Badge>
  );
}

export function SpotsBadge({ spots }: { spots: number | null }) {
  if (spots == null) return <Badge className="bg-outline/10 text-on-surface-variant">Cupos N/D</Badge>;
  const tone =
    spots === 0
      ? "bg-error/10 text-error"
      : spots <= 5
        ? "bg-warning/15 text-warning"
        : "bg-primary/10 text-primary";
  return <Badge className={cn("tabular", tone)}>{spots === 0 ? "Sin cupos" : `${spots} cupos`}</Badge>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary [&_svg]:size-7">{icon}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-on-surface-variant">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-xl bg-surface-container p-1", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-on-surface-variant transition [&_svg]:size-3.5",
            value === o.value && "bg-surface-lowest text-on-surface shadow-elev1 dark:bg-surface-highest",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("card p-4", className)}>
      <div className="text-xs font-medium text-on-surface-variant">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-on-surface-variant">{hint}</div>}
    </div>
  );
}

export function Progress({ value, className, tone = "primary" }: { value: number; className?: string; tone?: "primary" | "typology" | string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-outline-variant/50", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", tone === "primary" ? "bg-primary" : tone)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

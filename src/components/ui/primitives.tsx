// Small Radix-based primitives: popover, tooltip, switch, checkbox, tabs, menu, select, slider.
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as Pop from "@radix-ui/react-popover";
import * as Tip from "@radix-ui/react-tooltip";
import * as Sw from "@radix-ui/react-switch";
import * as Cb from "@radix-ui/react-checkbox";
import * as Tb from "@radix-ui/react-tabs";
import * as Dm from "@radix-ui/react-dropdown-menu";
import * as Sel from "@radix-ui/react-select";
import * as Sl from "@radix-ui/react-slider";
import * as Ad from "@radix-ui/react-alert-dialog";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const floating =
  "z-50 rounded-xl border border-outline-variant/60 bg-surface-lowest text-on-surface shadow-elev2 outline-none dark:bg-surface-high data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97]";

// ---------------------------------------------------------------- popover
export const Popover = Pop.Root;
export const PopoverTrigger = Pop.Trigger;
export const PopoverAnchor = Pop.Anchor;
export const PopoverContent = forwardRef<ElementRef<typeof Pop.Content>, ComponentPropsWithoutRef<typeof Pop.Content>>(
  ({ className, sideOffset = 6, ...p }, ref) => (
    <Pop.Portal>
      <Pop.Content ref={ref} sideOffset={sideOffset} className={cn(floating, "w-72 p-3", className)} {...p} />
    </Pop.Portal>
  ),
);
PopoverContent.displayName = "PopoverContent";

// ---------------------------------------------------------------- tooltip
export const TooltipProvider = Tip.Provider;
export function Tooltip({ content, children, side = "top", shortcut }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; shortcut?: string }) {
  if (!content) return <>{children}</>;
  return (
    <Tip.Root>
      <Tip.Trigger asChild>{children}</Tip.Trigger>
      <Tip.Portal>
        <Tip.Content
          side={side}
          sideOffset={6}
          className="z-[60] flex max-w-xs items-center gap-2 rounded-lg bg-on-surface px-2.5 py-1.5 text-xs text-surface shadow-elev2 data-[state=closed]:animate-out data-[state=delayed-open]:animate-in data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0"
        >
          {content}
          {shortcut && <span className="rounded bg-surface/15 px-1 font-medium">{shortcut}</span>}
        </Tip.Content>
      </Tip.Portal>
    </Tip.Root>
  );
}

// ---------------------------------------------------------------- switch
export const Switch = forwardRef<ElementRef<typeof Sw.Root>, ComponentPropsWithoutRef<typeof Sw.Root>>(({ className, ...p }, ref) => (
  <Sw.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-outline/40 transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...p}
  >
    <Sw.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow-elev1 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
  </Sw.Root>
));
Switch.displayName = "Switch";

// ---------------------------------------------------------------- checkbox
export const Checkbox = forwardRef<ElementRef<typeof Cb.Root>, ComponentPropsWithoutRef<typeof Cb.Root>>(({ className, ...p }, ref) => (
  <Cb.Root
    ref={ref}
    className={cn(
      "grid size-[18px] shrink-0 place-items-center rounded-[5px] border-2 border-outline transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-on",
      className,
    )}
    {...p}
  >
    <Cb.Indicator>
      <Check className="size-3.5" strokeWidth={3} />
    </Cb.Indicator>
  </Cb.Root>
));
Checkbox.displayName = "Checkbox";

// ---------------------------------------------------------------- tabs
export const Tabs = Tb.Root;
export const TabsList = forwardRef<ElementRef<typeof Tb.List>, ComponentPropsWithoutRef<typeof Tb.List>>(({ className, ...p }, ref) => (
  <Tb.List ref={ref} className={cn("inline-flex items-center gap-1 rounded-xl bg-surface-container p-1", className)} {...p} />
));
TabsList.displayName = "TabsList";
export const TabsTrigger = forwardRef<ElementRef<typeof Tb.Trigger>, ComponentPropsWithoutRef<typeof Tb.Trigger>>(({ className, ...p }, ref) => (
  <Tb.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-on-surface-variant transition data-[state=active]:bg-surface-lowest data-[state=active]:text-on-surface data-[state=active]:shadow-elev1 dark:data-[state=active]:bg-surface-highest [&_svg]:size-4",
      className,
    )}
    {...p}
  />
));
TabsTrigger.displayName = "TabsTrigger";
export const TabsContent = Tb.Content;

// ---------------------------------------------------------------- menu
export const Menu = Dm.Root;
export const MenuTrigger = Dm.Trigger;
export const MenuContent = forwardRef<ElementRef<typeof Dm.Content>, ComponentPropsWithoutRef<typeof Dm.Content>>(
  ({ className, sideOffset = 6, ...p }, ref) => (
    <Dm.Portal>
      <Dm.Content ref={ref} sideOffset={sideOffset} className={cn(floating, "min-w-48 p-1", className)} {...p} />
    </Dm.Portal>
  ),
);
MenuContent.displayName = "MenuContent";
export const MenuItem = forwardRef<ElementRef<typeof Dm.Item>, ComponentPropsWithoutRef<typeof Dm.Item> & { danger?: boolean }>(
  ({ className, danger, ...p }, ref) => (
    <Dm.Item
      ref={ref}
      className={cn(
        "flex cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-on-surface/[0.06] data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-on-surface-variant",
        danger && "text-error [&_svg]:text-error",
        className,
      )}
      {...p}
    />
  ),
);
MenuItem.displayName = "MenuItem";
export const MenuSeparator = () => <Dm.Separator className="my-1 h-px bg-outline-variant/60" />;

// ---------------------------------------------------------------- select
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  loading,
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  loading?: boolean;
}) {
  return (
    <Sel.Root value={value} onValueChange={onValueChange} disabled={disabled || loading}>
      <Sel.Trigger
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-outline-variant bg-surface-lowest px-3 text-left text-sm transition hover:border-outline data-[placeholder]:text-on-surface-variant disabled:opacity-50 dark:bg-surface-container",
          className,
        )}
      >
        <span className="truncate">
          <Sel.Value placeholder={loading ? "Cargando…" : placeholder} />
        </span>
        <Sel.Icon>
          <ChevronDown className={cn("size-4 opacity-60", loading && "animate-pulse")} />
        </Sel.Icon>
      </Sel.Trigger>
      <Sel.Portal>
        <Sel.Content position="popper" sideOffset={6} className={cn(floating, "max-h-80 w-[var(--radix-select-trigger-width)] overflow-hidden")}>
          <Sel.Viewport className="scroll-thin max-h-80 overflow-y-auto p-1">
            {options.map((o) => (
              <Sel.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-default select-none items-center rounded-lg py-2 pl-8 pr-2 text-[13px] outline-none data-[highlighted]:bg-on-surface/[0.06] data-[state=checked]:font-medium"
              >
                <Sel.ItemIndicator className="absolute left-2.5">
                  <Check className="size-4 text-primary" />
                </Sel.ItemIndicator>
                <Sel.ItemText>{o.label}</Sel.ItemText>
              </Sel.Item>
            ))}
          </Sel.Viewport>
        </Sel.Content>
      </Sel.Portal>
    </Sel.Root>
  );
}

// ---------------------------------------------------------------- slider
export const Slider = forwardRef<ElementRef<typeof Sl.Root>, ComponentPropsWithoutRef<typeof Sl.Root>>(({ className, ...p }, ref) => (
  <Sl.Root ref={ref} className={cn("relative flex h-5 w-full touch-none select-none items-center", className)} {...p}>
    <Sl.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-outline-variant/70">
      <Sl.Range className="absolute h-full bg-primary" />
    </Sl.Track>
    {(p.value ?? p.defaultValue ?? [0]).map((_, i) => (
      <Sl.Thumb
        key={i}
        className="block size-4 rounded-full border-2 border-primary bg-surface-lowest shadow-elev1 transition hover:scale-110 focus-visible:ring-4 focus-visible:ring-primary/25"
      />
    ))}
  </Sl.Root>
));
Slider.displayName = "Slider";

// ---------------------------------------------------------------- confirm
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Ad.Root open={open} onOpenChange={onOpenChange}>
      <Ad.Portal>
        <Ad.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Ad.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-outline-variant/60 bg-surface-lowest p-6 shadow-elev3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] dark:bg-surface-low">
          <Ad.Title className="text-base font-semibold">{title}</Ad.Title>
          {description && <Ad.Description className="mt-2 text-sm text-on-surface-variant">{description}</Ad.Description>}
          <div className="mt-6 flex justify-end gap-2">
            <Ad.Cancel asChild>
              <Button variant="ghost">Cancelar</Button>
            </Ad.Cancel>
            <Ad.Action asChild>
              <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </Ad.Action>
          </div>
        </Ad.Content>
      </Ad.Portal>
    </Ad.Root>
  );
}

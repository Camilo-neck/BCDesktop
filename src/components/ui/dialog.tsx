import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const Overlay = forwardRef<ElementRef<typeof D.Overlay>, ComponentPropsWithoutRef<typeof D.Overlay>>(({ className, ...p }, ref) => (
  <D.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...p}
  />
));
Overlay.displayName = "DialogOverlay";

type ContentProps = ComponentPropsWithoutRef<typeof D.Content> & { side?: "center" | "right"; hideClose?: boolean };

export const DialogContent = forwardRef<ElementRef<typeof D.Content>, ContentProps>(
  ({ className, children, side = "center", hideClose, onInteractOutside, ...p }, ref) => (
    <D.Portal>
      <Overlay />
      <D.Content
        ref={ref}
        aria-describedby={undefined}
        // A guided tour drawn over the dialog lives outside it: using the tour must not close the dialog.
        onInteractOutside={(e) => {
          if (e.target instanceof Element && e.target.closest("[data-tour-host]")) e.preventDefault();
          else onInteractOutside?.(e);
        }}
        className={cn(
          "fixed z-50 flex flex-col border border-outline-variant/60 bg-surface-lowest shadow-elev3 outline-none dark:bg-surface-low",
          side === "center" &&
            "left-1/2 top-1/2 max-h-[88vh] w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98]",
          side === "right" &&
            "inset-y-2 right-2 w-[min(94vw,440px)] rounded-2xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-right-8 data-[state=open]:slide-in-from-right-8 data-[state=closed]:fade-out-0",
          className,
        )}
        {...p}
      >
        {children}
        {!hideClose && (
          <D.Close className="absolute right-3 top-3 rounded-lg p-1.5 text-on-surface-variant transition hover:bg-on-surface/5 hover:text-on-surface">
            <X className="size-4" />
            <span className="sr-only">Cerrar</span>
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  ),
);
DialogContent.displayName = "DialogContent";

export const DialogHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1 px-6 pb-3 pt-5 pr-12", className)} {...p} />
);
export const DialogFooter = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center justify-end gap-2 border-t border-outline-variant/50 px-6 py-3", className)} {...p} />
);
export const DialogTitle = forwardRef<ElementRef<typeof D.Title>, ComponentPropsWithoutRef<typeof D.Title>>(({ className, ...p }, ref) => (
  <D.Title ref={ref} className={cn("text-lg font-semibold tracking-tight", className)} {...p} />
));
DialogTitle.displayName = "DialogTitle";
export const DialogDescription = forwardRef<ElementRef<typeof D.Description>, ComponentPropsWithoutRef<typeof D.Description>>(
  ({ className, ...p }, ref) => <D.Description ref={ref} className={cn("text-sm text-on-surface-variant", className)} {...p} />,
);
DialogDescription.displayName = "DialogDescription";

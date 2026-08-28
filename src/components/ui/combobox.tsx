"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function Combobox<Value, Multiple extends boolean | undefined = false>(
  props: ComboboxPrimitive.Root.Props<Value, Multiple>,
) {
  return <ComboboxPrimitive.Root data-slot="combobox" {...props} />;
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "h-9 w-full rounded-lg border border-[var(--border)] bg-surface-1 px-3 text-sm text-foreground outline-none placeholder:text-[var(--text-muted)] focus-visible:border-[var(--border-accent)]",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxPopup({ className, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Popup
      data-slot="combobox-popup"
      className={cn(
        /* Sized to its own content, not to the anchor: this popup hangs off a
         32px icon button, so w-(--anchor-width) would collapse it. Capped
         against the viewport so it stays on screen on a phone. */
        "z-50 max-h-72 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxPositioner({
  sideOffset = 4,
  className,
  ...props
}: ComboboxPrimitive.Positioner.Props) {
  return (
    <ComboboxPrimitive.Positioner
      data-slot="combobox-positioner"
      className={cn("isolate z-50 outline-none", className)}
      sideOffset={sideOffset}
      {...props}
    />
  );
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "grid cursor-default grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxItemIndicator({
  className,
  ...props
}: ComboboxPrimitive.ItemIndicator.Props) {
  return (
    <ComboboxPrimitive.ItemIndicator
      data-slot="combobox-item-indicator"
      className={cn("text-primary", className)}
      {...props}
    >
      <CheckIcon className="size-4" />
    </ComboboxPrimitive.ItemIndicator>
  );
}

function ComboboxGroupLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-group-label"
      className={cn(
        "px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "px-3 py-6 text-center text-[13px] text-[var(--text-secondary)]",
        className,
      )}
      {...props}
    />
  );
}

const ComboboxGroup = ComboboxPrimitive.Group;
const ComboboxList = ComboboxPrimitive.List;
const ComboboxPortal = ComboboxPrimitive.Portal;
const ComboboxTrigger = ComboboxPrimitive.Trigger;

export {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
};

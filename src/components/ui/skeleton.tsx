import { cn } from "@/lib/utils";

/**
 * A loading placeholder. Always `aria-hidden` — the surrounding container owns
 * the announcement (`role="status"` + `aria-label`), so a page of skeletons
 * reads as one "Loading X" rather than a burst of empty nodes.
 *
 * Colour comes from `--skeleton`, not a surface token: `--surface-1` and
 * `--surface-2` are both #ffffff in light mode, so the previous `bg-muted`
 * (which resolves to --surface-1) rendered white on white inside every card.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-skeleton", className)}
      {...props}
    />
  );
}

export { Skeleton };

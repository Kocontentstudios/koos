import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Inline loading spinner. Signals an in-flight action.
 *
 * Backed by the same `Loader2Icon` the Button component uses, so every spinner
 * in the product is one shape — this previously rendered a hand-rolled SVG,
 * which meant auth screens and dashboard buttons span differently.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2Icon
      aria-hidden="true"
      className={cn("size-4 animate-spin", className)}
    />
  );
}

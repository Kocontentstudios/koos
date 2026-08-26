import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors StrategyClient's three-pane shell (history rail, chat column,
 * summary panel) so the workspace doesn't reflow when it arrives. The rails
 * are hidden below lg, exactly as the real layout hides them. */
export default function StrategyLoading() {
  return (
    <div
      className="-mx-4 -my-6 flex h-[calc(100vh-56px)] overflow-hidden md:-mx-8 md:-my-8"
      role="status"
    >
      <span className="sr-only">Loading campaigns…</span>
      <aside className="hidden w-[280px] shrink-0 flex-col gap-3 border-r border-[var(--border)] bg-surface-1 p-5 lg:flex">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-9 w-full" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col justify-end gap-4 p-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <Skeleton className="h-20 w-[85%] rounded-xl" />
          </div>
        ))}
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>

      <aside className="hidden w-[320px] shrink-0 flex-col gap-3 border-l border-[var(--border)] p-5 lg:flex">
        <Skeleton className="h-5 w-36" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </aside>
    </div>
  );
}

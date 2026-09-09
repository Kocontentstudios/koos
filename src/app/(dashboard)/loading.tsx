import { Skeleton } from "@/components/ui/skeleton";

/**
 * Fallback for every (dashboard) segment without its own loading.tsx.
 *
 * Next resolves the NEAREST loading.tsx, so a segment nested under a route
 * that has a tailored one inherits that instead of this — which is why
 * brand/create, brand/onboarding and design-request/quick re-export this file
 * explicitly rather than inheriting a sibling's shape.
 *
 * Deliberately generic — a route whose shape differs enough to reflow on
 * arrival gets its own file alongside its page.tsx.
 */
export default function DashboardGroupLoading() {
  return (
    <div className="flex flex-col gap-6" role="status">
      <span className="sr-only">Loading page…</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--border)] bg-surface-1 p-5"
          >
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

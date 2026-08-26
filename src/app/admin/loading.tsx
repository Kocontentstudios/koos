import { Skeleton } from "@/components/ui/skeleton";

/** Pending state for every admin segment — the console had none at all, and
 * its queries (unpaginated user/brand scans, six analytics aggregates) are the
 * slowest in the app. */
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-6" role="status">
      <span className="sr-only">Loading admin…</span>
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--border)] bg-surface-1 p-5"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-5">
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

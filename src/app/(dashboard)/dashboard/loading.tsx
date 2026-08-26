import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-7" role="status">
      <span className="sr-only">Loading dashboard…</span>
      {/* Welcome hero */}
      <Skeleton className="h-44 rounded-[20px] md:h-52" />

      {/* Progress: ring + checklist */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-surface-1 p-5 md:p-6">
          <Skeleton className="mb-5 h-4 w-32 rounded-md" />
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="h-[140px] w-[140px] rounded-full" />
            <Skeleton className="h-3 w-40 rounded-md" />
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-surface-1 p-5 md:p-6">
          <Skeleton className="mb-5 h-4 w-48 rounded-md" />
          <div className="flex flex-col gap-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton
                key={i}
                className="h-[60px] rounded-xl border border-[var(--border)]"
              />
            ))}
          </div>
        </div>
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={i}
            className="h-40 rounded-2xl border border-[var(--border)]"
          />
        ))}
      </div>

      {/* Activity + Pro tip */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <Skeleton className="h-56 rounded-2xl border border-[var(--border)]" />
        <Skeleton className="h-56 rounded-2xl border border-[var(--border)]" />
      </div>
    </div>
  );
}

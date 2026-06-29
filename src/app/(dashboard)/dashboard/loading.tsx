export default function DashboardLoading() {
  return (
    <div
      className="flex flex-col gap-7"
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      {/* Welcome hero */}
      <div className="h-44 animate-pulse rounded-[20px] bg-surface-2 md:h-52" />

      {/* Progress: ring + checklist */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-surface-1 p-5 md:p-6">
          <div className="mb-5 h-4 w-32 animate-pulse rounded-md bg-surface-2" />
          <div className="flex flex-col items-center gap-4">
            <div className="h-[140px] w-[140px] animate-pulse rounded-full bg-surface-2" />
            <div className="h-3 w-40 animate-pulse rounded-md bg-surface-2" />
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-surface-1 p-5 md:p-6">
          <div className="mb-5 h-4 w-48 animate-pulse rounded-md bg-surface-2" />
          <div className="flex flex-col gap-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-[60px] animate-pulse rounded-xl border border-[var(--border)] bg-surface-2"
              />
            ))}
          </div>
        </div>
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-2xl border border-[var(--border)] bg-surface-2"
          />
        ))}
      </div>

      {/* Activity + Pro tip */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="h-56 animate-pulse rounded-2xl border border-[var(--border)] bg-surface-2" />
        <div className="h-56 animate-pulse rounded-2xl border border-[var(--border)] bg-surface-2" />
      </div>
    </div>
  );
}

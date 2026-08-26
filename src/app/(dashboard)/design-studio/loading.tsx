import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors design-studio-client: prompt panel, then the generations grid.
 * This route presigns up to 24 R2 URLs before first paint. */
export default function DesignStudioLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-[960px] flex-col gap-8"
      role="status"
    >
      <span className="sr-only">Loading design studio…</span>
      <section className="flex flex-col gap-4 rounded-xl border border-[var(--border)] p-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-24 w-full" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
          <Skeleton className="h-9 w-36" />
        </div>
      </section>

      <section>
        <Skeleton className="mb-3 h-5 w-40" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-xl" />
          ))}
        </div>
      </section>
    </div>
  );
}

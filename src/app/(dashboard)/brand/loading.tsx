import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the brand profile: header, detail sections, then recent generations. */
export default function BrandLoading() {
  return (
    <div className="flex flex-col gap-6" role="status">
      <span className="sr-only">Loading brand profile…</span>
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      {[0, 1].map((section) => (
        <div
          key={section}
          className="rounded-xl border border-[var(--border)] bg-surface-1 p-5"
        >
          <Skeleton className="h-3 w-32" />
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-4 w-40" />
            ))}
          </div>
        </div>
      ))}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="aspect-square w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

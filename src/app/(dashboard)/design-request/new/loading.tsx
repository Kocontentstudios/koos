import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the request form: heading, then stacked field groups. This route
 * can await up to six sequential queries when resuming a draft. */
export default function NewDesignRequestLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" role="status">
      <span className="sr-only">Loading design request form…</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="flex flex-col gap-5 rounded-xl border border-[var(--border)] bg-surface-1 p-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
        <Skeleton className="h-28 w-full" />
      </div>

      <div className="flex justify-end gap-2">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-40" />
      </div>
    </div>
  );
}

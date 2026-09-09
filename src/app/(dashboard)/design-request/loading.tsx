import { Skeleton } from "@/components/ui/skeleton";

export default function DesignRequestLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" role="status">
      <span className="sr-only">Loading design tickets…</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-52 rounded-md" />
        <Skeleton className="h-4 w-64 rounded-md" />
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

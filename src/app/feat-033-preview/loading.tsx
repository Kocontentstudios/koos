import { Skeleton } from "@/components/ui/skeleton";

/** TEMPORARY: deleted with the FEAT-033 preview harness before merge. */
export default function Feat033PreviewLoading() {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-6"
    >
      <span className="sr-only">Loading the FEAT-033 preview…</span>
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-72 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

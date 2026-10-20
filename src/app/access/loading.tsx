import { Skeleton } from "@/components/ui/skeleton";

export default function AccessLoading() {
  return (
    <div
      className="px-5 pt-7 pb-6 sm:px-8 sm:pt-9 xl:px-16 xl:pt-10"
      role="status"
    >
      <span className="sr-only">Loading…</span>
      <div className="mx-auto flex max-w-[1640px] flex-col gap-6">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-11 w-full max-w-2xl" />
        <Skeleton className="h-6 w-full max-w-3xl" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    </div>
  );
}

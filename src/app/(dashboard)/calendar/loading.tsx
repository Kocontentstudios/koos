import { Skeleton } from "@/components/ui/skeleton";

export default function CalendarLoading() {
  return (
    <div className="flex flex-col gap-6" role="status">
      <span className="sr-only">Loading calendar…</span>
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-48 rounded-md" />
        <Skeleton className="h-8 w-44 rounded-md" />
      </div>
      <Skeleton className="h-[60vh] rounded-xl ring-1 ring-foreground/10" />
    </div>
  );
}

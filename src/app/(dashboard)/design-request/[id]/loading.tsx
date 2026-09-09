import { Skeleton } from "@/components/ui/skeleton";

export default function TicketDetailLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" role="status">
      <span className="sr-only">Loading ticket…</span>
      <Skeleton className="h-4 w-40 rounded-md" />
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36 rounded-md" />
          <Skeleton className="h-4 w-48 rounded-md" />
        </div>
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <Skeleton className="h-48 rounded-xl ring-1 ring-foreground/10" />
      <Skeleton className="h-32 rounded-xl ring-1 ring-foreground/10" />
    </div>
  );
}

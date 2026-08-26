import { Skeleton } from "@/components/ui/skeleton";

/**
 * Root fallback. A segment's loading.tsx renders INSIDE its own layout, so it
 * cannot cover that layout's own awaits — (dashboard)/layout.tsx resolves the
 * workspace and memberships before anything below it renders. Without this
 * file a cold load or refresh painted a bare background until those finished.
 *
 * Also the only fallback for the auth, marketing and invite routes.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-screen flex-col gap-6 p-6" role="status">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-48" />
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

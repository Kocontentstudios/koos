"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Admin had no error boundary, so a thrown query escaped to global-error and
 * replaced the whole document. Mirrors (dashboard)/error.tsx. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--status-error-bg)] text-[var(--status-error-fg)]">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="mb-2 font-display text-2xl font-bold text-foreground">
        Something went wrong
      </h1>
      <p className="mb-6 max-w-md text-[15px] text-[var(--text-secondary)]">
        We hit an unexpected error loading this admin page. You can try again,
        or head back to the console.
      </p>
      <Button variant="default" size="lg" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}

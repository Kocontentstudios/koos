import { Compass } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(19,139,200,0.2)] text-primary-text">
        <Compass className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="mb-2 font-display text-2xl font-bold text-foreground">
        Page not found
      </h1>
      <p className="mb-6 max-w-md text-[15px] text-[var(--text-secondary)]">
        The page you are looking for does not exist or may have moved.
      </p>
      <Link href="/dashboard">
        <Button variant="default" size="lg">
          Back to dashboard
        </Button>
      </Link>
    </div>
  );
}

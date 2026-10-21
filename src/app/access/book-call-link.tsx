"use client";

import { ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";
import { captureEvent } from "@/lib/analytics/posthog-client";
import { BOOK_CALL_URL } from "@/lib/auth/workspace-approval";
import { cn } from "@/lib/utils";

/* access_gate_viewed → access_book_call_clicked → workspace_access_changed
   (server, on approval) is the funnel that says whether the gate converts.
   White on --primary is 3.78:1, which passes AA only as large text, so the
   label stays bold and at least 19px at every width. */
export function BookCallLink({ workspaceId }: { workspaceId: string }) {
  useEffect(() => {
    captureEvent("access_gate_viewed", { workspaceId });
  }, [workspaceId]);

  return (
    <a
      href={BOOK_CALL_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => captureEvent("access_book_call_clicked", { workspaceId })}
      className={cn(
        buttonVariants({ size: "lg" }),
        "h-14 gap-3 rounded-[12px] px-8 text-[19px] font-bold sm:h-16 xl:text-[22px] [&_svg:not([class*='size-'])]:size-6",
      )}
    >
      Book a call
      <ArrowRight aria-hidden="true" />
      <span className="sr-only">(opens cal.com in a new tab)</span>
    </a>
  );
}

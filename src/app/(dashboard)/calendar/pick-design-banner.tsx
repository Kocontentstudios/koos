"use client";

import { Palette, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PickGuidance } from "./pick-guidance";

const SEND_TO_TEAM = (
  <span className="font-semibold text-foreground">Send to design team</span>
);

function Message({ guidance }: { guidance: PickGuidance }) {
  if (guidance === "pick") {
    return (
      <>
        Pick a content item to request a design for, then choose {SEND_TO_TEAM}.
      </>
    );
  }
  if (guidance === "openDay") {
    return (
      <>Open a day to pick one of its posts, then choose {SEND_TO_TEAM}.</>
    );
  }
  /* Never point at an empty list. The view toggle is the one control present in
     every view — agenda hides the date arrows — so that is what we name. */
  return (
    <>
      Nothing here to request a design for. Try another view, or{" "}
      <Link
        href="/design-request/new"
        className="font-semibold text-primary underline underline-offset-2"
      >
        describe the design yourself
      </Link>
      .
    </>
  );
}

interface PickDesignBannerProps {
  /** What the current view can honestly ask the user to do. */
  guidance: PickGuidance;
}

/** Shown when the user arrived from the Design Tickets chooser (?pick=design)
 *  so the calendar explains what to do instead of being a dead drop. */
export function PickDesignBanner({ guidance }: PickDesignBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border-accent)] bg-[rgba(19,139,200,0.08)] px-4 py-3">
      <Palette aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
      <p className="text-[13px] text-[var(--text-secondary)]">
        <Message guidance={guidance} />
      </p>
      <Button
        variant="icon"
        size="icon-sm"
        aria-label="Dismiss"
        className="ml-auto shrink-0"
        onClick={() => setDismissed(true)}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

"use client";

import { Wand2 } from "lucide-react";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { DesignEntry } from "./design-analytics";
import { DesignDirectionsDialog } from "./directions/design-directions-dialog";
import type { TicketContext } from "./send-to-team";
import { useDesignGeneration } from "./use-design-generation";

export interface GenerateDesignButtonProps {
  brandId: string;
  briefId?: string | null;
  calendarItemId?: string | null;
  freeform?: string | null;
  aspectRatio?: string | null;
  /** Which entry point this is, for the dialog's copy and analytics. Inferred
   *  from the ids when absent. */
  entry?: DesignEntry;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  ticketContext?: TicketContext;
}

function entryFor(
  calendarItemId: string | null | undefined,
  briefId: string | null | undefined,
): DesignEntry {
  if (calendarItemId) return "calendar";
  if (briefId) return "brief";
  return "studio";
}

/** The single launcher every entry point uses. Callers pass ids only: the
 * server resolves brief/calendar/brand context so nothing is retyped. The
 * click opens the image choice; nothing is generated or billed until the
 * user has picked the imagery, so no entry point can skip that choice. */
export function GenerateDesignButton({
  brandId,
  briefId,
  calendarItemId,
  freeform,
  aspectRatio,
  entry,
  label = "Generate Design",
  variant = "default",
  size,
  className,
  ticketContext,
}: GenerateDesignButtonProps) {
  const [open, setOpen] = useState(false);
  const design = useDesignGeneration();

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        loading={design.pending}
        loadingText="Generating…"
        className={className}
      >
        <Wand2 aria-hidden="true" className="size-4" />
        {label}
      </Button>
      <DesignDirectionsDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) design.reset();
        }}
        entry={entry ?? entryFor(calendarItemId, briefId)}
        args={{ brandId, briefId, calendarItemId, freeform, aspectRatio }}
        design={design}
        ticketContext={ticketContext}
      />
    </>
  );
}

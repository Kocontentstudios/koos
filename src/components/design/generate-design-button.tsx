"use client";

import { Wand2 } from "lucide-react";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { DesignPreviewModal } from "./design-preview-modal";
import { useDesignGeneration } from "./use-design-generation";

export interface GenerateDesignButtonProps {
  brandId: string;
  briefId?: string | null;
  calendarItemId?: string | null;
  freeform?: string | null;
  aspectRatio?: string | null;
  label?: string;
  variant?: ButtonProps["variant"];
  className?: string;
  ticketContext?: React.ComponentProps<
    typeof DesignPreviewModal
  >["ticketContext"];
}

/** The single launcher every entry point uses. Callers pass ids only — the
 * server resolves brief/calendar/brand context so nothing is retyped. */
export function GenerateDesignButton({
  brandId,
  briefId,
  calendarItemId,
  freeform,
  aspectRatio,
  label = "Generate Design",
  variant = "default",
  className,
  ticketContext,
}: GenerateDesignButtonProps) {
  const [open, setOpen] = useState(false);
  const design = useDesignGeneration();

  const args = { brandId, briefId, calendarItemId, freeform, aspectRatio };

  async function start() {
    setOpen(true);
    await design.generate(args);
  }

  return (
    <>
      <Button
        variant={variant}
        onClick={start}
        disabled={design.pending}
        className={className}
      >
        <Wand2 className="size-4" />
        {design.pending ? "Generating…" : label}
      </Button>
      <DesignPreviewModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) design.reset();
        }}
        brandId={brandId}
        generations={design.generations}
        pending={design.pending}
        progressLabel={design.progressLabel}
        error={design.error}
        onRegenerate={() => design.generate(args)}
        ticketContext={ticketContext}
      />
    </>
  );
}

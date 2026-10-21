"use client";

import { Wand2 } from "lucide-react";
import { useState } from "react";
import { useDesignGeneration } from "@/components/design/use-design-generation";
import { Button, type ButtonProps } from "@/components/ui/button";
import { DesignDirectionsDialog } from "./design-directions-dialog";
import type { DirectionsEntry } from "./directions-flow-view";

export interface GenerateDirectionsButtonProps {
  brandId: string;
  entry: DirectionsEntry;
  briefId?: string | null;
  calendarItemId?: string | null;
  freeform?: string | null;
  aspectRatio?: string | null;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

/** Opens the image choice first: the image decides both directions, so it is
 *  asked for before anything is generated or billed. */
export function GenerateDirectionsButton({
  brandId,
  entry,
  briefId,
  calendarItemId,
  freeform,
  aspectRatio,
  label = "Generate design",
  variant = "default",
  size,
  className,
}: GenerateDirectionsButtonProps) {
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
        entry={entry}
        args={{ brandId, briefId, calendarItemId, freeform, aspectRatio }}
        design={design}
      />
    </>
  );
}

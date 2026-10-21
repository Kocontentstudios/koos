"use client";

import { ImageUp, type LucideIcon, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { DESIGN_IMAGE_HINT } from "./flow-logic";
import { PointerOnly } from "./input-modality";

/** Same tint as the Design Tickets chooser: --surface-* resolve to the sheet's
 *  own colour in light mode, so a surface hover would dissolve the card. */
const HOVER_TINT = "hover:bg-[var(--hover)]";

function ChoiceCard({
  icon: Icon,
  title,
  description,
  hint,
  onClick,
  dropActive = false,
  dropHandlers,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  hint?: React.ReactNode;
  onClick: () => void;
  dropActive?: boolean;
  dropHandlers?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...dropHandlers}
      /* Inline, not a border utility: globals.css sets `* { border-color }`
         unlayered, which beats every border-* utility class. */
      style={dropActive ? { borderColor: "var(--primary)" } : undefined}
      className={cn(
        "group flex h-full flex-col items-start gap-3 rounded-xl border bg-surface-1 p-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]",
        HOVER_TINT,
        dropActive && "bg-[var(--accent-glow)]",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(19,139,200,0.15)] text-primary">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-[14px] font-semibold text-foreground">
          {title}
        </span>
        <span className="text-[12px] leading-snug text-[var(--text-secondary)]">
          {description}
        </span>
      </span>
      {hint ? (
        <span className="mt-auto text-[11px] text-[var(--text-muted)]">
          {hint}
        </span>
      ) : null}
    </button>
  );
}

export interface ImageChoiceProps {
  onUseOwnImage: () => void;
  onLetKoCreate: () => void;
  /** A file dropped on the upload card skips the empty drop zone entirely. */
  onFileDropped: (file: File) => void;
}

export function ImageChoice({
  onUseOwnImage,
  onLetKoCreate,
  onFileDropped,
}: ImageChoiceProps) {
  const [dropActive, setDropActive] = useState(false);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ChoiceCard
        icon={ImageUp}
        title="Use a specific image"
        description="A product shot, photo or visual you already have. KO designs around it and never redraws it."
        hint={
          <>
            {DESIGN_IMAGE_HINT}.
            <PointerOnly> You can also drop it here.</PointerOnly>
          </>
        }
        onClick={onUseOwnImage}
        dropActive={dropActive}
        dropHandlers={{
          onDragOver: (e) => {
            e.preventDefault();
            setDropActive(true);
          },
          onDragLeave: () => setDropActive(false),
          onDrop: (e) => {
            e.preventDefault();
            setDropActive(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onFileDropped(file);
          },
        }}
      />
      <ChoiceCard
        icon={Sparkles}
        title="Let KO create the imagery"
        description="KO creates imagery from the brief and your Brand Brain, then builds both designs around it."
        hint="No image needed"
        onClick={onLetKoCreate}
      />
    </div>
  );
}

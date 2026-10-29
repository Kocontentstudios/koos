"use client";

import { ImageUp, type LucideIcon, Sparkles, Type } from "lucide-react";
import { useState } from "react";
import { DESIGN_IMAGE_SUMMARY } from "@/lib/uploads/design-image-limits";
import { cn } from "@/lib/utils";
import { offeredSources } from "./flow-logic";
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
        "group flex h-full flex-col items-start gap-3 rounded-xl border bg-surface-1 p-4 text-left transition-colors duration-150 focus-visible:focus-outline",
        HOVER_TINT,
        dropActive && "bg-[var(--accent-glow)]",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(19,139,200,0.15)] text-primary-text">
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
        <span
          className={cn(
            "mt-auto text-[11px]",
            dropActive
              ? "text-[var(--text-secondary)]"
              : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]",
          )}
        >
          {hint}
        </span>
      ) : null}
    </button>
  );
}

export interface ImageChoiceProps {
  /** FEATURE_KO_IMAGERY, from the server. Off, the second card is "Design
   *  without an image" and no KO-imagery card is rendered at all. */
  koImagery: boolean;
  onUseOwnImage: () => void;
  onLetKoCreate: () => void;
  onNoImage: () => void;
  /** A file dropped on the upload card skips the empty drop zone entirely. */
  onFileDropped: (file: File) => void;
}

export function ImageChoice({
  koImagery,
  onUseOwnImage,
  onLetKoCreate,
  onNoImage,
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
            {DESIGN_IMAGE_SUMMARY}.
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
      {offeredSources(koImagery).includes("ko") ? (
        <ChoiceCard
          icon={Sparkles}
          title="Let KO create the imagery"
          description="KO creates imagery from the brief and your Brand Brain, then builds both designs around it."
          hint="No image needed"
          onClick={onLetKoCreate}
        />
      ) : (
        <ChoiceCard
          icon={Type}
          title="Design without an image"
          description="Your words lead. KO lays out both designs in your brand's type and colours, with no photo."
          hint="No image needed"
          onClick={onNoImage}
        />
      )}
    </div>
  );
}

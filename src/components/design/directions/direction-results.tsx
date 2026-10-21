"use client";

import { ImageIcon, LayoutTemplate, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { captureEvent } from "@/lib/analytics/posthog-client";
import { generationFileName } from "@/lib/design/download-name";
import { jpegFileName, pngToJpeg, saveBlob } from "@/lib/design/png-to-jpeg";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { DirectionCard, FailedDirectionCard } from "./direction-card";
import type { ImageSource } from "./flow-logic";

/** A slot is a rendered direction, or null where one was expected and failed. */
export type DirectionSlot = SerializedGeneration | null;

export interface DirectionResultsProps {
  slots: DirectionSlot[];
  source: ImageSource | null;
  imageName: string | null;
  regeneratingSlot: number | null;
  regenerateError: { slot: number; message: string } | null;
  onRegenerate: (slot: number) => void;
  onChooseImagery: () => void;
}

async function downloadJpeg(generation: SerializedGeneration): Promise<void> {
  /* Through the authorised download route, not the card's URL: that route
     always lands on the bucket's signed endpoint, whose CORS rules allow the
     app origin to read the bytes back. */
  const res = await fetch(`/api/design/generations/${generation.id}/download`);
  if (!res.ok) throw new Error("download failed");
  const png = await res.blob();
  const size =
    generation.width && generation.height
      ? { width: generation.width, height: generation.height }
      : null;
  const jpeg = await pngToJpeg(png, size);
  saveBlob(jpeg, jpegFileName(generationFileName(generation)));
}

function SourcePill({
  source,
  imageName,
}: {
  source: ImageSource;
  imageName: string | null;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--status-progress-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--status-progress-fg)]">
      {source === "upload" ? (
        <ImageIcon aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <Sparkles aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span className="truncate">
        {source === "upload"
          ? `Built around ${imageName ?? "your image"}`
          : "KO-created imagery"}
      </span>
    </span>
  );
}

function EmptyResults({ onChooseImagery }: { onChooseImagery: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center"
      style={{ borderColor: "var(--border-control)" }}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-[rgba(19,139,200,0.15)] text-primary">
        <LayoutTemplate aria-hidden="true" className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-[16px] font-bold text-foreground">
          No designs yet
        </h3>
        <p className="max-w-[360px] text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Nothing came back from this run. Pick the imagery again and KO will
          make two fresh directions.
        </p>
      </div>
      <Button type="button" onClick={onChooseImagery}>
        Choose imagery
      </Button>
    </div>
  );
}

export function DirectionResults({
  slots,
  source,
  imageName,
  regeneratingSlot,
  regenerateError,
  onRegenerate,
  onChooseImagery,
}: DirectionResultsProps) {
  /* Keyed to the design, not one shared flag: converting one card must not
     make the other claim to be working too. */
  const [convertingId, setConvertingId] = useState<string | null>(null);

  if (slots.length === 0) {
    return <EmptyResults onChooseImagery={onChooseImagery} />;
  }

  const rendered = slots.filter((s): s is SerializedGeneration => s !== null);
  const firstSize =
    rendered[0]?.width && rendered[0]?.height
      ? { width: rendered[0].width, height: rendered[0].height }
      : null;
  const failed = slots.length - rendered.length;

  async function handleJpeg(generation: SerializedGeneration) {
    setConvertingId(generation.id);
    try {
      await downloadJpeg(generation);
      captureEvent("design_downloaded", { format: "jpg" });
    } catch {
      toast.error("The JPG couldn't be made. Download the PNG instead.");
    } finally {
      setConvertingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {source || failed > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {source ? <SourcePill source={source} imageName={imageName} /> : null}
          {failed > 0 ? (
            <p
              role="status"
              className="text-[13px] text-[var(--status-pending-fg)]"
            >
              {rendered.length} of {slots.length} directions came back.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {slots.map((slot, index) => {
          const regenerate = {
            regenerating: regeneratingSlot === index,
            regenerateBlocked:
              regeneratingSlot !== null && regeneratingSlot !== index,
            regenerateError:
              regenerateError?.slot === index ? regenerateError.message : null,
            onRegenerate: () => onRegenerate(index),
          };
          return slot ? (
            <DirectionCard
              key={slot.id}
              generation={slot}
              index={index}
              convertingJpg={convertingId === slot.id}
              onDownloadJpg={() => handleJpeg(slot)}
              {...regenerate}
            />
          ) : (
            <FailedDirectionCard
              key={`failed-${index}`}
              index={index}
              size={firstSize}
              {...regenerate}
            />
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { DesignCard } from "@/components/design/design-card";
import { DesignPreviewModal } from "@/components/design/design-preview-modal";
import { useDesignGeneration } from "@/components/design/use-design-generation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORTED_ASPECT_RATIOS } from "@/lib/ai/image/types";
import type { ContextOption } from "@/lib/design/context-search";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { cn } from "@/lib/utils";
import { ContextPicker, toAttachmentRefs } from "./context-picker";

const RATIO_LABELS: Record<string, string> = {
  "1:1": "Square",
  "4:5": "Portrait",
  "9:16": "Story",
  "16:9": "Landscape",
};

interface DesignStudioClientProps {
  brandId: string | null;
  brandName: string | null;
  initialGenerations: SerializedGeneration[];
}

export function DesignStudioClient({
  brandId,
  brandName,
  initialGenerations,
}: DesignStudioClientProps) {
  const router = useRouter();
  const promptId = useId();
  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState<ContextOption[]>([]);
  const [aspectRatio, setAspectRatio] = useState<string>("4:5");
  const [previewOpen, setPreviewOpen] = useState(false);
  /* A card from the history opens the SAME modal with just that design, so
     saving always happens behind a preview of what is being saved. Kept
     separate from the generation run: there is nothing to regenerate here. */
  const [viewing, setViewing] = useState<SerializedGeneration | null>(null);
  /* Recorded when a run starts, not inferred from state at close: a second
     generation that fails clears the first one's results, so reading
     `generations` on the way out would skip the refresh and leave the designs
     that DID succeed missing from the grid. */
  const [ranThisSession, setRanThisSession] = useState(false);
  const design = useDesignGeneration();

  const history = design.generations.length
    ? [...design.generations, ...initialGenerations]
    : initialGenerations;

  async function handleGenerate() {
    if (!brandId) return;
    setViewing(null);
    setRanThisSession(true);
    setPreviewOpen(true);
    await design.generate({
      brandId,
      freeform: prompt.trim() || null,
      attachments: toAttachmentRefs(context),
      aspectRatio,
    });
  }

  if (!brandId) {
    return (
      <div className="mx-auto w-full max-w-[720px] rounded-xl border border-[var(--border)] p-8 text-center">
        <h2 className="font-display text-[20px] font-bold text-foreground">
          Add a brand first
        </h2>
        <p className="mt-2 text-[15px] text-[var(--text-secondary)]">
          Design Studio uses your brand colours, logo and tone to generate
          on-brand designs.
        </p>
        <Link href="/brand/create" className="mt-4 inline-block">
          <Button>Create a brand</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8">
      <section className="flex flex-col gap-4 rounded-xl border border-[var(--border)] p-5">
        <div>
          <label
            htmlFor={promptId}
            className="mb-1 block text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
          >
            What do you need?
          </label>
          <Textarea
            id={promptId}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={`e.g. A launch announcement for ${brandName ?? "your brand"}`}
          />
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            Leave blank to generate from your brand profile alone.
          </p>
        </div>

        {/* Attached context saves retyping a brief or calendar post the user
            has already written elsewhere in KOOS. */}
        {brandId && (
          <ContextPicker
            brandId={brandId}
            selected={context}
            onChange={setContext}
            disabled={design.pending}
          />
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex gap-2">
            {SUPPORTED_ASPECT_RATIOS.map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => setAspectRatio(ratio)}
                aria-pressed={aspectRatio === ratio}
                className={cn(
                  "rounded-lg border px-3 py-2 text-[13px] transition-colors",
                  aspectRatio === ratio
                    ? "border-[var(--border-accent)] text-foreground"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-accent)]",
                )}
              >
                {RATIO_LABELS[ratio] ?? ratio}
              </button>
            ))}
          </div>
          <Button
            onClick={handleGenerate}
            loading={design.pending}
            loadingText="Generating…"
          >
            <Wand2 className="size-4" />
            Generate Design
          </Button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-[18px] font-bold text-foreground">
          Your designs
        </h2>
        {history.length === 0 ? (
          <p className="text-[14px] text-[var(--text-muted)]">
            Nothing yet. Generate your first design above, or start one from a
            chat brief or a calendar item.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {history.map((generation) => (
              <DesignCard
                key={generation.id}
                generation={generation}
                onOpen={(picked) => {
                  setViewing(picked);
                  setPreviewOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </section>

      <DesignPreviewModal
        open={previewOpen}
        onOpenChange={(next) => {
          setPreviewOpen(next);
          if (!next) {
            /* reset() clears the run's generations, and the grid is now the
               only route back to a preview — without a refresh the design just
               made is missing from it until a reload. Only after a run,
               though: refetching 24 rows and re-signing their URLs to close a
               preview that changed nothing is pure cost. */
            /* Only once the run has finished: closing mid-generation would
               refetch before the job has written anything, and the design
               would still be missing from the grid. */
            const hadRun = ranThisSession && !design.pending;
            setViewing(null);
            setRanThisSession(false);
            design.reset();
            if (hadRun) router.refresh();
          }
        }}
        brandId={brandId}
        generations={viewing ? [viewing] : design.generations}
        pending={viewing ? false : design.pending}
        progressLabel={viewing ? null : design.progressLabel}
        error={viewing ? null : design.error}
        onRegenerate={viewing ? undefined : handleGenerate}
      />
    </div>
  );
}

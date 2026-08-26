"use client";

import { Wand2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";
import { DesignPreviewModal } from "@/components/design/design-preview-modal";
import { useDesignGeneration } from "@/components/design/use-design-generation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORTED_ASPECT_RATIOS } from "@/lib/ai/image/types";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { cn } from "@/lib/utils";

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
  const promptId = useId();
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<string>("4:5");
  const [previewOpen, setPreviewOpen] = useState(false);
  const design = useDesignGeneration();

  const history = design.generations.length
    ? [...design.generations, ...initialGenerations]
    : initialGenerations;

  async function handleGenerate() {
    if (!brandId) return;
    setPreviewOpen(true);
    await design.generate({
      brandId,
      freeform: prompt.trim() || null,
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
            {history.map((generation) =>
              generation.url ? (
                <a
                  key={generation.id}
                  href={generation.url}
                  download={`design-${generation.id.slice(0, 8)}.png`}
                  className="rounded-lg border border-[var(--border)] transition-colors hover:border-[var(--border-accent)]"
                >
                  <Image
                    src={generation.url}
                    alt={generation.headline ?? "Generated design"}
                    width={generation.width ?? 1080}
                    height={generation.height ?? 1080}
                    className="w-full rounded-lg"
                    unoptimized
                  />
                </a>
              ) : null,
            )}
          </div>
        )}
      </section>

      <DesignPreviewModal
        open={previewOpen}
        onOpenChange={(next) => {
          setPreviewOpen(next);
          if (!next) design.reset();
        }}
        brandId={brandId}
        generations={design.generations}
        pending={design.pending}
        progressLabel={design.progressLabel}
        error={design.error}
        onRegenerate={handleGenerate}
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { DesignCard } from "@/components/design/design-card";
import { DesignPreviewModal } from "@/components/design/design-preview-modal";
import type { SerializedGeneration } from "@/lib/design/serialize";

/**
 * A client island inside the (server-rendered) brand page: the grid has to own
 * the preview modal, because a card is now a button that opens it rather than
 * a link that used to try — and fail — to download the file directly.
 */
export function GeneratedDesigns({
  brandId,
  generations,
}: {
  brandId: string;
  generations: SerializedGeneration[];
}) {
  const [viewing, setViewing] = useState<SerializedGeneration | null>(null);

  if (generations.length === 0) return null;
  return (
    <div className="mt-6 rounded-xl border border-[var(--border)] p-6 sm:p-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[18px] font-bold text-foreground">
          Generated Designs
        </h2>
        <Link
          href="/design-studio"
          className="text-[13px] text-[var(--text-muted)] transition-colors hover:text-foreground"
        >
          View all in Design Studio
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {generations.map((generation) => (
          <DesignCard
            key={generation.id}
            generation={generation}
            onOpen={setViewing}
          />
        ))}
      </div>

      <DesignPreviewModal
        open={viewing !== null}
        onOpenChange={(next) => {
          if (!next) setViewing(null);
        }}
        brandId={brandId}
        generations={viewing ? [viewing] : []}
        pending={false}
        progressLabel={null}
        error={null}
      />
    </div>
  );
}

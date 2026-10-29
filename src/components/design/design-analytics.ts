import { captureEvent } from "@/lib/analytics/posthog-client";
import type { SerializedGeneration } from "@/lib/design/serialize";
import type { DesignImageChoice } from "./use-design-generation";

/** Where the image choice was opened from. Documented in docs/analytics.md. */
export type DesignEntry = "calendar" | "brief" | "studio";

export function trackImageChoice(
  source: DesignImageChoice["source"],
  entry: DesignEntry,
): void {
  captureEvent("design_image_choice", { source, entry });
}

/* image_source is null for a legacy row, which keeps those downloads out of
   the FEAT-033 funnel's upload-vs-KO split without dropping them. */
export function trackDesignDownload(
  generation: SerializedGeneration,
  format: "png" | "jpg",
): void {
  captureEvent("design_downloaded", {
    format,
    image_source: generation.imageSource,
  });
}

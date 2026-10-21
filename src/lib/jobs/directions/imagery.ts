import { createHash, randomUUID } from "node:crypto";
import type { ImageAdapter } from "@/lib/ai/image/types";
import { buildBackgroundPlatePrompt } from "@/lib/ai/prompts/design-spec";
import type { DocumentAsset } from "@/lib/design/document/rasterize";
import type { AssetRef } from "@/lib/design/document/schema";
import type { LoadedLogo } from "@/lib/design/render/logo";
import type { DesignSpec } from "@/lib/design/spec";
import { detectImageType } from "@/lib/images/detect";
import { STORAGE_PREFIXES, uploadObject } from "@/lib/storage";

/** An image a document draws: the key it names and the bytes behind it. */
export interface PlacedAsset {
  ref: AssetRef;
  asset: DocumentAsset;
}

const DRAWABLE = {
  png: { ext: "png", contentType: "image/png" },
  jpeg: { ext: "jpg", contentType: "image/jpeg" },
} as const;

/**
 * Paints one background plate and stores it, so the document references it
 * by key and no later edit pays for it again (spec, "Generation" 2).
 *
 * Null on any failure, and the direction is drawn on a flat brand colour as
 * the composite route does: a design without a plate beats no design. That
 * includes a plate satori cannot draw (WEBP), which would otherwise fail the
 * render deep inside with "u2 is not iterable", and a plate that could not
 * be stored, which a document must not reference.
 */
export async function paintPlate({
  adapter,
  spec,
  brandId,
}: {
  adapter: ImageAdapter;
  spec: DesignSpec;
  brandId: string;
}): Promise<PlacedAsset | null> {
  try {
    const plate = await adapter.generate({
      prompt: buildBackgroundPlatePrompt(spec),
      aspectRatio: spec.aspectRatio,
    });
    const type = detectImageType(plate.bytes);
    if (type !== "png" && type !== "jpeg") {
      console.error(
        `plate from ${adapter.id} came back as ${type ?? plate.contentType}; rendering flat`,
      );
      return null;
    }
    const { ext, contentType } = DRAWABLE[type];
    /* Named for what the bytes are. The plate models this project uses
       return PNG; a JPEG stored under .png would be served with the wrong
       type to the editor that reads it back. */
    const key = `${STORAGE_PREFIXES.generated}/${brandId}/plates/${randomUUID()}.${ext}`;
    await uploadObject({ key, body: plate.bytes, contentType });
    return { ref: { key }, asset: { bytes: plate.bytes, contentType } };
  } catch (err) {
    console.error("design plate generation failed, rendering flat", err);
    return null;
  }
}

/**
 * Stores the mark exactly as the renderer draws it.
 *
 * The loader trims transparent padding and rasterises SVG, so the brand's
 * file under logos/ is not the bytes on the design. A document that named
 * the original would draw a smaller, padded or unrenderable mark the moment
 * the editor read it back. Keyed by content hash, so the same mark is one
 * object however many designs use it.
 */
export async function storeDrawnMark(
  brandId: string,
  logo: LoadedLogo,
): Promise<PlacedAsset | null> {
  const type = detectImageType(logo.bytes);
  if (type !== "png" && type !== "jpeg") return null;
  const { ext, contentType } = DRAWABLE[type];
  const hash = createHash("sha256").update(logo.bytes).digest("hex");
  const key = `${STORAGE_PREFIXES.generated}/${brandId}/marks/${hash.slice(0, 32)}.${ext}`;
  try {
    await uploadObject({ key, body: logo.bytes, contentType });
  } catch (err) {
    console.error("drawn logo could not be stored", err);
    return null;
  }
  return { ref: { key }, asset: { bytes: logo.bytes, contentType } };
}

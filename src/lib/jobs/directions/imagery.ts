import { createHash, randomUUID } from "node:crypto";
import type { ImageAdapter } from "@/lib/ai/image/types";
import { buildBackgroundPlatePrompt } from "@/lib/ai/prompts/design-spec";
import type { DocumentAsset } from "@/lib/design/document/rasterize";
import type { AssetRef } from "@/lib/design/document/schema";
import { checkPlateShowsProduct } from "@/lib/design/quality/plate-check";
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

/** The product the brief names and what it looks like, from the direction. */
export interface PlateProduct {
  name: string;
  look: string;
}

/** What the plate check concluded, recorded per plate. */
export type PlateCheck =
  /** The first plate shows the product. */
  | "passed"
  /** The first did not; the one retry did. */
  | "passed-on-retry"
  /** Neither did, so the direction is drawn flat rather than over the wrong
   *  product. */
  | "failed"
  /** The checker could not answer; the plate is used, unverified. */
  | "unchecked"
  /** The brief names no product, so there is nothing to check for. */
  | "not-applicable";

export interface CheckedPlate {
  image: { bytes: Uint8Array; contentType: string } | null;
  check: PlateCheck;
  /** Plate-model calls made: 1, or 2 when the first plate was rejected. */
  imageCalls: number;
  /** What the checker saw on each rejected plate. */
  seen: string[];
}

/**
 * The plate prompt with the product named first. Image models weigh the
 * start of a prompt most, and round 1's scene-first prompts ("a sunlit
 * bakery counter with a pastry") came back as whatever pastry the model knew
 * best. The first attempt names the product and leaves the direction's own
 * scene to set it apart from its sibling: leading both with the same long
 * description painted the same plate twice. A retry, after the check said
 * the product was missing, leads with the full description and names what
 * was painted instead.
 */
export function platePrompt(
  spec: DesignSpec,
  product: PlateProduct | null,
  rejected?: string,
): string {
  const scene = buildBackgroundPlatePrompt(spec);
  if (!product) return scene;
  if (!rejected) {
    return `A ${product.name}, clearly recognisable, as the subject. ${scene}`;
  }
  return `${product.look || product.name}. The ${product.name} is the clear subject, whole and unmistakable; the last attempt showed ${rejected} instead, which is wrong. ${scene}`;
}

function drawable(
  plate: { bytes: Uint8Array; contentType: string },
  adapterId: string,
): { bytes: Uint8Array; contentType: string } | null {
  const type = detectImageType(plate.bytes);
  if (type !== "png" && type !== "jpeg") {
    console.error(
      `plate from ${adapterId} came back as ${type ?? plate.contentType}; rendering flat`,
    );
    return null;
  }
  return { bytes: plate.bytes, contentType: DRAWABLE[type].contentType };
}

/**
 * Paints one plate and, when the brief names a product, checks it shows that
 * product (quality/plate-check.ts). A rejected plate is painted once more
 * with the product insisted on and what was wrong named; if that one is
 * rejected too the direction is drawn flat. A design on a brand colour is
 * honest; the wrong product under the product's name is not.
 *
 * Null image on any plate-model failure, as the composite route does: a
 * design without a plate beats no design. That includes a plate satori
 * cannot draw (WEBP), which would otherwise fail the render deep inside with
 * "u2 is not iterable".
 */
export async function paintCheckedPlate({
  adapter,
  spec,
  product,
}: {
  adapter: ImageAdapter;
  spec: DesignSpec;
  product: PlateProduct | null;
}): Promise<CheckedPlate> {
  let imageCalls = 0;
  const paint = async (prompt: string) => {
    imageCalls += 1;
    try {
      const plate = await adapter.generate({
        prompt,
        aspectRatio: spec.aspectRatio,
      });
      return drawable(plate, adapter.id);
    } catch (err) {
      console.error("design plate generation failed, rendering flat", err);
      return null;
    }
  };

  const first = await paint(platePrompt(spec, product));
  if (!first) return { image: null, check: "unchecked", imageCalls, seen: [] };
  if (!product) {
    return { image: first, check: "not-applicable", imageCalls, seen: [] };
  }
  const verdict = await checkPlateShowsProduct({
    bytes: first.bytes,
    product: product.name,
    look: product.look,
  });
  if (!verdict)
    return { image: first, check: "unchecked", imageCalls, seen: [] };
  if (verdict.shows)
    return { image: first, check: "passed", imageCalls, seen: [] };

  const seen = [verdict.seen];
  const second = await paint(
    platePrompt(spec, product, verdict.seen || "something else"),
  );
  if (!second) return { image: null, check: "failed", imageCalls, seen };
  const again = await checkPlateShowsProduct({
    bytes: second.bytes,
    product: product.name,
    look: product.look,
  });
  if (!again) return { image: second, check: "unchecked", imageCalls, seen };
  if (again.shows) {
    return { image: second, check: "passed-on-retry", imageCalls, seen };
  }
  seen.push(again.seen);
  console.error("plate did not show the product twice; rendering flat", {
    product: product.name,
    seen,
  });
  return { image: null, check: "failed", imageCalls, seen };
}

/**
 * A checked plate, stored so the document references it by key and no later
 * edit pays for it again (spec, "Generation" 2). A plate that could not be
 * stored is not referenced: the direction is drawn flat.
 */
export async function paintPlate({
  adapter,
  spec,
  product,
  brandId,
}: {
  adapter: ImageAdapter;
  spec: DesignSpec;
  product: PlateProduct | null;
  brandId: string;
}): Promise<Omit<CheckedPlate, "image"> & { placed: PlacedAsset | null }> {
  const { image, ...outcome } = await paintCheckedPlate({
    adapter,
    spec,
    product,
  });
  if (!image) return { ...outcome, placed: null };
  /* Named for what the bytes are. The plate models this project uses
     return PNG; a JPEG stored under .png would be served with the wrong
     type to the editor that reads it back. */
  const ext = image.contentType === "image/jpeg" ? "jpg" : "png";
  const key = `${STORAGE_PREFIXES.generated}/${brandId}/plates/${randomUUID()}.${ext}`;
  try {
    await uploadObject({
      key,
      body: image.bytes,
      contentType: image.contentType,
    });
  } catch (err) {
    console.error("design plate could not be stored, rendering flat", err);
    return { ...outcome, placed: null };
  }
  return { ...outcome, placed: { ref: { key }, asset: image } };
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

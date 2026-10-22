import { createHash, randomUUID } from "node:crypto";
import type { ImageAdapter } from "@/lib/ai/image/types";
import { buildBackgroundPlatePrompt } from "@/lib/ai/prompts/design-spec";
import type { DocumentAsset } from "@/lib/design/document/rasterize";
import type { AssetRef } from "@/lib/design/document/schema";
import {
  checkPlateShowsProduct,
  type PlateVerdict,
} from "@/lib/design/quality/plate-check";
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
  /** The first plate shows the product (or, with none named, its subject)
   *  and carries no lettering. */
  | "passed"
  /** The first did not; the one retry did. */
  | "passed-on-retry"
  /** Neither showed the product, so the direction is drawn flat rather than
   *  over the wrong product. */
  | "failed"
  /** Both showed the product with made-up writing painted on it, so the
   *  direction is drawn flat rather than with fake brand names on it. */
  | "failed-lettering"
  /** The checker could not answer, or the model named a product the brief
   *  never mentions so there was nothing to check it against; the plate is
   *  used, unverified. */
  | "unchecked";

export interface CheckedPlate {
  image: { bytes: Uint8Array; contentType: string } | null;
  check: PlateCheck;
  /** Plate-model calls made: 1, or 2 when the first plate was rejected. */
  imageCalls: number;
  /** What the checker saw on each rejected plate. */
  seen: string[];
  /** The check's look at the delivered plate: where the subject is and what
   *  is in it. Null when there is no plate or no answer. */
  look: PlateVerdict | null;
}

/**
 * The plate prompt with the product named first. Image models weigh the
 * start of a prompt most, and round 1's scene-first prompts ("a sunlit
 * bakery counter with a pastry") came back as whatever pastry the model knew
 * best. The first attempt names the product and leaves the direction's own
 * scene to set it apart from its sibling: leading both with the same long
 * description painted the same plate twice. A retry, after the check said
 * the product was missing or lettered, leads with the full description and
 * names what was wrong.
 */
export function platePrompt(
  spec: DesignSpec,
  product: PlateProduct | null,
  rejected?: { seen?: string; lettering?: boolean },
  setting?: string | null,
): string {
  const scene = buildBackgroundPlatePrompt(spec);
  /* Round 2 painted a Lagos bakery's pastry on a European street and wrote
     "MIOCZEBC PRALEF" on a zobo bottle. */
  const place = setting
    ? `Set in ${setting}: its own streets, interiors, people and light`
    : null;
  const plain =
    "Any packaging, bottle, box or bag is plain and unbranded, with no label text, printed words, letters or logos";
  const tail = [scene, place, plain].filter(Boolean).join(". ");
  if (!product) {
    return rejected?.lettering
      ? `Nothing in the image carries any writing; the last attempt painted lettering, which is wrong. ${tail}`
      : tail;
  }
  if (!rejected) {
    return `A ${product.name}, clearly recognisable, as the subject. ${tail}`;
  }
  const wrong = rejected.lettering
    ? "the last attempt painted lettering on it, which is wrong: no writing anywhere"
    : `the last attempt showed ${rejected.seen || "something else"} instead, which is wrong`;
  return `${product.look || product.name}. The ${product.name} is the clear subject, whole and unmistakable; ${wrong}. ${tail}`;
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

function rejection(verdict: PlateVerdict, product: PlateProduct | null) {
  if (product && !verdict.shows) return { seen: verdict.seen };
  if (verdict.lettering) return { lettering: true };
  return null;
}

/**
 * Paints one plate and looks at it (quality/plate-check.ts): does it show
 * the product the brief names, where is it, and is there writing on it. A
 * rejected plate is painted once more with what was wrong named; if that
 * one is rejected too the direction is drawn flat. A design on a brand
 * colour is honest; the wrong product, or the right one wearing a made-up
 * brand name, is not.
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
  productUnchecked = false,
  setting = null,
}: {
  adapter: ImageAdapter;
  spec: DesignSpec;
  product: PlateProduct | null;
  /** The model named a product the brief does not: the plate is still
   *  looked at, but cannot be checked for it. */
  productUnchecked?: boolean;
  /** Where the brand is, for the scene (brandSetting). */
  setting?: string | null;
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
  const look = (bytes: Uint8Array) =>
    checkPlateShowsProduct({
      bytes,
      product: product?.name ?? "",
      look: product?.look ?? "",
    });
  const passed = productUnchecked ? "unchecked" : "passed";

  const first = await paint(platePrompt(spec, product, undefined, setting));
  if (!first) {
    return {
      image: null,
      check: "unchecked",
      imageCalls,
      seen: [],
      look: null,
    };
  }
  const verdict = await look(first.bytes);
  if (!verdict) {
    return {
      image: first,
      check: "unchecked",
      imageCalls,
      seen: [],
      look: null,
    };
  }
  const firstRejection = rejection(verdict, product);
  if (!firstRejection) {
    return { image: first, check: passed, imageCalls, seen: [], look: verdict };
  }

  const seen = [
    verdict.lettering ? `${verdict.seen} (lettered)` : verdict.seen,
  ];
  const second = await paint(
    platePrompt(spec, product, firstRejection, setting),
  );
  const failedAs = firstRejection.lettering ? "failed-lettering" : "failed";
  if (!second)
    return { image: null, check: failedAs, imageCalls, seen, look: null };
  const again = await look(second.bytes);
  if (!again) {
    return { image: second, check: "unchecked", imageCalls, seen, look: null };
  }
  const secondRejection = rejection(again, product);
  if (!secondRejection) {
    return {
      image: second,
      check: productUnchecked ? "unchecked" : "passed-on-retry",
      imageCalls,
      seen,
      look: again,
    };
  }
  seen.push(again.lettering ? `${again.seen} (lettered)` : again.seen);
  console.error("plate rejected twice; rendering flat", {
    product: product?.name ?? null,
    seen,
  });
  return {
    image: null,
    check: secondRejection.lettering ? "failed-lettering" : "failed",
    imageCalls,
    seen,
    look: null,
  };
}

/**
 * A checked plate, stored so the document references it by key and no later
 * edit pays for it again (spec, "Generation" 2). A plate that could not be
 * stored is not referenced: the direction is drawn flat.
 */
export async function paintPlate({
  brandId,
  ...painting
}: Parameters<typeof paintCheckedPlate>[0] & {
  brandId: string;
}): Promise<Omit<CheckedPlate, "image"> & { placed: PlacedAsset | null }> {
  const { image, ...outcome } = await paintCheckedPlate(painting);
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

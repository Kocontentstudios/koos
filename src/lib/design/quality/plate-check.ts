import { z } from "zod";
import { askVision, imageMediaType } from "./vision";

/**
 * Does a painted plate show the product the brief named?
 *
 * Round 1's KO plates showed a round tart, a round cake and bread rolls for
 * a strawberry mille-feuille, and the design said "mille-feuille" over them.
 * A plate model draws the nearest thing it knows; nothing downstream looked.
 * This looks, once per plate, through the same vision path as the judge.
 */

export const PLATE_CHECK_TIMEOUT_MS = 20_000;
const PLATE_CHECK_MAX_OUTPUT_TOKENS = 300;
/** Long edge sent to the model. A product is recognisable far below the
 *  plate's own size, and a smaller image is a faster, cheaper answer that
 *  stays well inside the provider's per-image limit. */
const CHECK_EDGE = 768;

const verdictSchema = z.object({
  mainSubject: z
    .string()
    .describe(
      "What the image actually shows as its main subject, in a few plain words.",
    ),
  showsProduct: z
    .boolean()
    .describe(
      "True only if the named product is clearly visible and recognisable as that product.",
    ),
});

export interface PlateVerdict {
  shows: boolean;
  /** What the checker saw instead, in its words: fed back into the retry. */
  seen: string;
}

const SYSTEM = `You check product photographs for a design studio before a client sees them. The question is identity: is the thing in the picture the named product? A different item of the same kind (a tart for a mille-feuille, a cake for a pastry, a cushion for a throw, bread for a croissant) is NOT the product. Presentation is NOT the question: the angle, crop, plating, number of pieces, background and lighting do not matter, and a description of how it might look is only a hint to recognise it. Judge only what is visible.`;

async function smaller(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(bytes, { failOn: "none" })
      .resize(CHECK_EDGE, CHECK_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { bytes: new Uint8Array(out), mediaType: "image/jpeg" };
  } catch {
    const mediaType = imageMediaType(bytes);
    return mediaType ? { bytes, mediaType } : null;
  }
}

/** Null when there is no answer (no readable image, a refusal, a timeout):
 *  the caller keeps the plate and records it as unchecked. */
export async function checkPlateShowsProduct({
  bytes,
  product,
  look,
  timeoutMs = PLATE_CHECK_TIMEOUT_MS,
}: {
  bytes: Uint8Array;
  product: string;
  look: string;
  timeoutMs?: number;
}): Promise<PlateVerdict | null> {
  const image = await smaller(bytes);
  if (!image) return null;
  try {
    const answer = await askVision({
      schema: verdictSchema,
      system: SYSTEM,
      text: [
        `The product: ${product}.`,
        look ? `A hint for recognising it: ${look}.` : null,
        "Is the main subject of this image that product, recognisably? Answer true if it is, however it is shot or plated. Say what the main subject actually is.",
      ]
        .filter(Boolean)
        .join("\n"),
      image,
      maxOutputTokens: PLATE_CHECK_MAX_OUTPUT_TOKENS,
      timeoutMs,
      label: "plate check",
    });
    if (typeof answer?.showsProduct !== "boolean") return null;
    return {
      shows: answer.showsProduct,
      seen: typeof answer.mainSubject === "string" ? answer.mainSubject : "",
    };
  } catch (err) {
    console.error("plate check unavailable", err);
    return null;
  }
}

import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import { normalizeHex } from "@/lib/validation/hex";

/** Plain required strings — Bedrock counts optional and nullable properties as
 *  union-typed params and caps them, the same wall extraction.ts documents. */
const paletteSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  accents: z.array(z.string()).max(3),
});

export interface ExtractedPalette {
  primary: string | null;
  secondary: string | null;
  accents: string[];
}

const EMPTY: ExtractedPalette = { primary: null, secondary: null, accents: [] };

/**
 * Reads a brand's colours off its logo.
 *
 * There is no image-processing library available to application code — sharp
 * is present only as a transitive dependency of Next and is not resolvable —
 * so this asks a vision model rather than sampling pixels. It is the first
 * multimodal call in the codebase.
 *
 * Every value is passed through normalizeHex, so a model that answers "warm
 * terracotta" instead of a hex contributes nothing rather than poisoning the
 * brand profile. Returns empty on any failure: extraction is an offer, and the
 * user can always type the hexes themselves.
 */
export async function extractLogoColors(image: {
  bytes: Uint8Array;
  contentType: string;
}): Promise<ExtractedPalette> {
  try {
    const { object } = await generateObject({
      model: getModel("brand"),
      schema: paletteSchema,
      maxOutputTokens: 500,
      system:
        "You identify the brand colours used in a logo. Answer only with six-digit " +
        "hex codes like #3A2A1F. Give the dominant colour as primary and the next " +
        "most prominent as secondary. Ignore transparency and any white or black " +
        "that is only background or outline, unless the logo is genuinely " +
        "monochrome. If you cannot tell, return an empty string for that field " +
        "rather than guessing.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What are this logo's brand colours?" },
            { type: "image", image: image.bytes, mediaType: image.contentType },
          ],
        },
      ],
    });

    return {
      primary: normalizeHex(object.primary),
      secondary: normalizeHex(object.secondary),
      accents: object.accents
        .map((a) => normalizeHex(a))
        .filter((a): a is string => a !== null),
    };
  } catch (err) {
    // Includes providers that reject image parts at all — an openai-compatible
    // endpoint pointed at a text-only model will land here, and must degrade
    // to manual entry rather than blocking the step.
    console.error("logo colour extraction failed", err);
    return EMPTY;
  }
}

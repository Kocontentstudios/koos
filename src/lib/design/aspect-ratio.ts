import type { AspectRatio } from "@/lib/ai/image/types";

/** "1080x1350" → "4:5". Falls back to square when unparseable, since every
 * downstream renderer needs a concrete ratio. */
export function aspectRatioFromDimensions(
  dimensions: string | null | undefined,
): AspectRatio {
  const match = dimensions?.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
  if (!match) return "1:1";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "1:1";
  const ratio = width / height;
  const candidates: [AspectRatio, number][] = [
    ["1:1", 1],
    ["4:5", 4 / 5],
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
  ];
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio)
      ? candidate
      : best,
  )[0];
}

import type { brands } from "@/lib/db/schema";

export interface ImagePromptInput {
  brand:
    | Partial<typeof brands.$inferSelect>
    | {
        name?: string;
        tone?: string | null;
        primaryColor?: string | null;
        secondaryColor?: string | null;
        brandStyle?: string | null;
        offer?: string | null;
      };
  userPrompt: string;
  style?: string;
}

export function buildImagePrompt({
  brand,
  userPrompt,
  style,
}: ImagePromptInput): string {
  const contextLines: string[] = [];

  if (brand.name?.trim()) {
    contextLines.push(`Brand: ${brand.name.trim()}`);
  }

  if (brand.tone?.trim()) {
    contextLines.push(`Tone: ${brand.tone.trim()}`);
  }

  if (brand.brandStyle?.trim()) {
    contextLines.push(`Visual style: ${brand.brandStyle.trim()}`);
  }

  if (brand.primaryColor?.trim()) {
    contextLines.push(`Primary color: ${brand.primaryColor.trim()}`);
  }

  if (brand.secondaryColor?.trim()) {
    contextLines.push(`Secondary color: ${brand.secondaryColor.trim()}`);
  }

  if (brand.offer?.trim()) {
    contextLines.push(`Offer: ${brand.offer.trim()}`);
  }

  const contextBlock =
    contextLines.length > 0
      ? `\n\nBrand context:\n${contextLines.join("\n")}`
      : "";
  const styleBlock = style ? `\n\nStyle guidance: ${style}` : "";

  return `${userPrompt}${contextBlock}${styleBlock}`;
}

/**
 * Single adjectives, not the compound `toneOptions` the manual form uses.
 *
 * Whatever is picked here becomes the `tone` column, and toneBadges splits
 * that back into one badge per adjective for the snapshot card — so offering
 * adjectives in the first place keeps both ends speaking the same language.
 */
export const VOICE_TONE_CHIPS = [
  "Bold",
  "Punchy",
  "Playful",
  "Friendly",
  "Warm",
  "Authoritative",
  "Sophisticated",
  "Modern",
  "Minimal",
  "Premium",
] as const;

/** Filler and cliché a brand usually wants ruled out. */
export const WORDS_TO_AVOID_CHIPS = [
  "Synergy",
  "Cheap",
  "Guaranteed",
  "Revolutionary",
  "Disruptive",
  "World-class",
  "Cutting-edge",
  "Game-changer",
  "Leverage",
  "Best-in-class",
] as const;

export type ChipPrompt = "tone" | "avoid";

/** toneBadges renders at most this many before it stops, so selecting more
 *  than this would silently lose the tail on the snapshot card. */
export const MAX_CHIP_SELECTION = 6;

/* Deliberately narrow. This runs against arbitrary model prose, and a false
   positive puts irrelevant chips under an unrelated question, which reads as
   a bug. Both patterns demand the specific subject, not just a keyword. */
const AVOID_SUBJECT = "(?:words?|phrases?|terms?|language|jargon)";
const AVOID_VERB =
  "(?:avoid|never (?:use|say)|steer clear|stay away|don'?t (?:use|say))";
/* Either order: "words to avoid" and "avoid any words like" both count, and
   so does "language you want to steer clear of". */
const AVOID_PATTERN = new RegExp(
  `\\b${AVOID_SUBJECT}\\b[^.?!]{0,40}\\b${AVOID_VERB}\\b|\\b${AVOID_VERB}\\b[^.?!]{0,25}\\b${AVOID_SUBJECT}\\b`,
  "i",
);

const TONE_PATTERN =
  /\b(?:tone|voice|personality)\b[^.?!]{0,60}\?|\bhow (?:should|would|do you want) (?:it|the brand|your brand)[^.?!]{0,40}\b(?:sound|feel|come across)\b/i;

/**
 * Which chip set, if any, belongs under this assistant message.
 *
 * Returns null for anything that isn't clearly one of the two questions —
 * showing no chips is always safe, showing the wrong ones is not.
 */
export function detectChipPrompt(text: string): ChipPrompt | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  // Checked first: "what words should we avoid in your voice?" is an avoid
  // question that also mentions voice.
  if (AVOID_PATTERN.test(trimmed)) return "avoid";
  if (TONE_PATTERN.test(trimmed)) return "tone";
  return null;
}

/**
 * The synthetic user turn a selection produces.
 *
 * Comma-separated because that is what toneBadges splits on and what the
 * extractor reads back out of the transcript. Phrased as the user speaking,
 * since that is exactly what it stands in for.
 */
export function formatChipSelection(
  kind: ChipPrompt,
  selected: string[],
): string {
  const cleaned = selected.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  const list = cleaned.join(", ");
  return kind === "tone"
    ? `Our brand voice is: ${list}.`
    : `Words and phrases to avoid: ${list}.`;
}

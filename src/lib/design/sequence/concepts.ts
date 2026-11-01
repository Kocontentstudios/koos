/**
 * Phrases that say one thing in different words. A reader hears "120
 * students learn for free" and "At no cost to families" as one point, but
 * the two share no content word, so every word-overlap check
 * (textsOverlap, echoesHook, previewedFrames) reads them through this
 * first. Each phrase is replaced by its concept's one word, which then
 * counts like any shared word.
 */

/* The concept's word is one no copy uses, so a shared word "free" in
   "free of sulphates" or "sugar-free" (without, not without paying) is
   never read as the price. */
const CONCEPTS: readonly { word: string; phrases: RegExp }[] = [
  {
    word: "nocost",
    phrases:
      /\b(?:free\s+of\s+charge|(?:at\s+|for\s+)?(?:no|zero)[\s-]+(?:cost|charge|fees?|payment)s?|costs?\s+nothing|pays?\s+nothing|paying\s+nothing|without\s+(?:paying|charge|a\s+fee|cost)|(?:fully\s+)?sponsored|no\s+(?:enrol(?:l)?ment|registration|sign[\s-]?up)\s+fees?|gratis)\b|(?<![\p{L}-])free\b(?!\s+(?:of|from)\b|-)/giu,
  },
];

/** `text` with every phrase of a concept written as the concept's word. */
export function withConcepts(text: string): string {
  return CONCEPTS.reduce(
    (out, { word, phrases }) => out.replace(phrases, word),
    text,
  );
}

/** The concepts `text` states, by their word. */
export function conceptsIn(text: string): Set<string> {
  const said = withConcepts(text).toLowerCase();
  return new Set(
    CONCEPTS.filter(({ word }) => new RegExp(`\\b${word}\\b`).test(said)).map(
      ({ word }) => word,
    ),
  );
}

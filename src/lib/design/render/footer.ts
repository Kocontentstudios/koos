import type { LogoCorner } from "@/lib/design/logo-placement";

/**
 * The footer band — module 05 of the AI Design Training System.
 *
 * The manual catalogues twelve footer systems. The renderer had none, so
 * contact details, dates and venues — what most real flyers actually carry —
 * had nowhere to live that was drawn. The benchmark caught the art director
 * writing "[VENUE NAME], Lagos" into a field the renderer discarded.
 *
 * Three styles, not twelve. A curved-shoulder band and an angled split panel
 * are satori geometry work; shipping the two that carry information (a solid
 * bar, plain text) plus "none" means the information reaches the design now,
 * and the rest is a visual upgrade rather than a missing capability.
 */

export interface FooterSpec {
  footerStyle: "bar" | "text" | "none";
  footerLines: string[];
  /** The call to action, so a footer that repeats it can drop the repeat.
   *  Optional only for callers that place the logo before the copy exists;
   *  every renderer passes the whole spec. */
  cta?: string;
}

/** Three lines is the cap: a fourth turns a footer into a paragraph, which is
 *  module 05's "crowded" failure. */
export const MAX_FOOTER_LINES = 3;

export function footerLinesFor(spec: FooterSpec): string[] {
  const cta = wordsOf(spec.cta ?? "");
  return (spec.footerLines ?? [])
    .map((line) => withoutCta(line.trim(), cta))
    .filter(Boolean)
    .slice(0, MAX_FOOTER_LINES);
}

/* A separator between footer items, kept with the spaces around it so the
   line can be rebuilt exactly. */
const SEPARATOR = /(\s+[·|•–—]\s+)/;
const CONNECTOR = /^(?:at|on|via|by|from|to|for|in)\s+/i;

function wordsOf(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function hasRun(haystack: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

/**
 * The footer line with every item that repeats the call to action removed.
 *
 * The brief writer often puts the action in the footer as well ("Order now ·
 * 0803 555 0142" under an "Order now" button), and the design then says it
 * twice (U3 live critique). An item that is the CTA, part of it, or contains
 * it goes. An item that leads with the CTA keeps what follows ("Order on
 * WhatsApp: 0803..." keeps the number). A one-word overlap is not a repeat
 * unless it is the whole of both: a "Shop" button must not delete "Shop 12,
 * Admiralty Mall".
 */
function withoutCta(line: string, cta: string[]): string {
  if (cta.length === 0) return line;
  const parts = line.split(SEPARATOR);
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const item = itemWithoutCta(parts[i], cta);
    if (!item) continue;
    if (kept.length > 0) kept.push(parts[i - 1]);
    kept.push(item);
  }
  return kept.join("").trim();
}

function itemWithoutCta(item: string, cta: string[]): string {
  const words = wordsOf(item);
  if (words.length === cta.length && hasRun(words, cta)) return "";
  if (cta.length >= 2 && hasRun(words, cta)) {
    /* wordsOf leaves only letters and digits, so the words need no
       escaping. */
    const lead = new RegExp(
      `^[^\\p{L}\\p{N}]*${cta.join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])[\\s:,–—-]*`,
      "iu",
    );
    const normalized = item.normalize("NFKC");
    const match = normalized.match(lead);
    if (!match) return "";
    const rest = normalized
      .slice(match[0].length)
      .replace(CONNECTOR, "")
      .trim();
    return wordsOf(rest).length > 0 ? rest : "";
  }
  if (words.length >= 2 && hasRun(cta, words)) return "";
  return item;
}

export function hasFooter(spec: FooterSpec): boolean {
  return spec.footerStyle !== "none" && footerLinesFor(spec).length > 0;
}

/**
 * How much vertical room the band takes.
 *
 * Capped at a fifth of the canvas: the footer is utility information and must
 * never take so much room that the message it supports loses its own.
 */
export function footerBandHeight(
  spec: FooterSpec,
  canvas: { width: number; height: number },
): number {
  if (!hasFooter(spec)) return 0;

  const lines = footerLinesFor(spec).length;
  /* A bar carries its own ground, so it needs padding above and below the
     type; plain text sits on the design and needs only the type's room. */
  const perLine = canvas.height * (spec.footerStyle === "bar" ? 0.042 : 0.032);
  const padding = canvas.height * (spec.footerStyle === "bar" ? 0.035 : 0.012);

  return Math.min(lines * perLine + padding, canvas.height * 0.2);
}

/**
 * Corners the band covers.
 *
 * A logo placed in a bottom corner lands on the contact details. The
 * compositor measures legibility after the fact but cannot move the mark, so
 * the corner has to be ruled out before placement.
 */
export function cornersBlockedByFooter(spec: FooterSpec): LogoCorner[] {
  return hasFooter(spec) ? ["bottom-left", "bottom-right"] : [];
}

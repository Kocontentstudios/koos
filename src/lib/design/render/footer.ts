import {
  type CopyToken,
  runsOf,
  tokensOf,
  withoutEdgeMarks,
} from "@/lib/design/copy-tokens";
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
  /** The copy above the footer, so a footer item that repeats part of it
   *  word for word (the day, the time) can be dropped. */
  headline?: string;
  subheadline?: string;
}

/** Three lines is the cap: a fourth turns a footer into a paragraph, which is
 *  module 05's "crowded" failure. */
export const MAX_FOOTER_LINES = 3;

export function footerLinesFor(spec: FooterSpec): string[] {
  const cta = itemTokensOf(spec.cta ?? "");
  const above = [spec.headline ?? "", spec.subheadline ?? ""].map(tokensOf);
  return (spec.footerLines ?? [])
    .filter((line) => !repeatsCopyAbove(line, above))
    .map((line) => footerLine(line.trim(), cta))
    .filter(Boolean)
    .slice(0, MAX_FOOTER_LINES);
}

/* Separators between footer items, kept so the line can be rebuilt exactly:
   middle dots, bullets and pipes with or without spaces, dashes and slashes
   with spaces, and commas. A comma splits "crumbandco.ng, Order now, 0803..."
   into items; "Shop 12, Admiralty Mall" splits too, harmlessly, because an
   item is only ever removed whole. */
const SEPARATOR = /(\s*[·•|]\s*|\s+[–—/-]\s+|,\s+)/;

/** An item read as the literal verifier reads copy (copy-tokens.ts): case
 *  aside, times written one way ("7 am", "7:00am" and "7am" are one
 *  token), and the punctuation at its edges off. */
function itemTokensOf(text: string): CopyToken[] {
  return withoutEdgeMarks(tokensOf(text));
}

function startsWith(tokens: CopyToken[], run: CopyToken[]): boolean {
  return runsOf(tokens, run)[0] === 0;
}

/** Starts a line that lost its first item with a capital, unless it starts
 *  with an address ("hello@...", "crumbandco.ng") or a name written in mixed
 *  case ("iOS", "eBay") that must keep its case. */
function capitalized(line: string): string {
  const first = line.split(/\s+/)[0] ?? "";
  if (/[@./:]/.test(first) || /\p{Lu}/u.test(first)) return line;
  if (!/^\p{Ll}/u.test(line)) return line;
  return line.charAt(0).toLocaleUpperCase() + line.slice(1);
}

/**
 * The footer line without the items that repeat the call to action. A line
 * the headline or subheadline already says word for word is dropped whole
 * before this (repeatsCopyAbove).
 *
 * The brief writer often puts the action in the footer as well ("Order now ·
 * 0803 555 0142" under an "Order now" button), and restates the subheadline's
 * day and time, so the design says it twice. Per item:
 *  - the CTA alone goes;
 *  - an item led by the CTA is kept whole ("Order on WhatsApp: 0803 555
 *    0142", "Order by 8pm for next-day pickup"): cutting it rewrites it;
 *  - an item that carries the CTA elsewhere goes only when it carries no
 *    fact: "Call 0803 555 0142 to book a table" keeps the number, so it is
 *    kept whole;
 * Against the copy above, nothing short of a whole line is ever dropped:
 * "Free delivery in Lekki" under "Now baking in Lekki" is an offer,
 * "Mon–Sat 7am–6pm" under "Open 7am–6pm" a condition, "Not 20% off on
 * cakes" an exclusion, and "Ikoyi" in "Lekki · Ikoyi · Victoria Island"
 * under "Ikoyi pop-up" one of a list. A repeat costs a line; a deleted
 * offer costs the client a sale.
 * Tokens are compared whole, so "ORDER-NOW.ng" is a domain, not the CTA, and
 * a one-word CTA never removes part of a longer item ("Shop" keeps "Shop 12").
 */
/** The whole line appears word for word in the headline or subheadline,
 *  its punctuation included: "Ages 8+" is not in "Fun for all ages · 8+
 *  flavours" (round-9 and round-10 code critic, J4 and F2), while "Saturday
 *  · 7pm" is in "this Saturday, 7pm", one break mark standing for any. */
function repeatsCopyAbove(line: string, above: CopyToken[][]): boolean {
  const tokens = itemTokensOf(line);
  return (
    tokens.length > 0 &&
    above.some((copy) => runsOf(copy, tokens, { breaksAlike: true }).length > 0)
  );
}

function footerLine(line: string, cta: CopyToken[]): string {
  const parts = line.split(SEPARATOR);
  const kept: string[] = [];
  let lost = false;
  for (let i = 0; i < parts.length; i += 2) {
    const item = keptItem(parts[i], cta);
    if (item !== parts[i].trim()) lost = true;
    if (!item) continue;
    if (kept.length > 0) kept.push(parts[i - 1]);
    kept.push(item);
  }
  const rebuilt = kept.join("").trim();
  return lost ? capitalized(rebuilt) : rebuilt;
}

function keptItem(raw: string, cta: CopyToken[]): string {
  const item = raw.trim();
  const tokens = itemTokensOf(item);
  if (tokens.length === 0) return "";
  if (cta.length > 0) {
    if (tokens.length === cta.length && startsWith(tokens, cta)) {
      return "";
    }
    const at = cta.length >= 2 ? (runsOf(tokens, cta)[0] ?? -1) : -1;
    /* An item led by the call to action is kept whole: cutting the CTA
       off "Order by 8pm for next-day pickup" drew "Next-day pickup" and
       lost the deadline (round-7 live run). Code drops a repeat whole; it
       never rewrites one (Oluwaseyi's ruling, round 7). */
    if (at === 0) return item;
    /* Only an item saying nothing the button does not is dropped here: an
       item that carries the button's words among its own ("Free
       consultation when you book now" under "Book now") may hold a brief
       fact, and that drop is the job's, under the literal verifier
       (round-7 code critic, K18). */
    if (tokens.length >= 2 && runsOf(cta, tokens).length > 0) return "";
  }

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

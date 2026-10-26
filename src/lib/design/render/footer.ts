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
  const cta = tokensOf(spec.cta ?? "");
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
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}@#₦$€£%]+|[^\p{L}\p{N}%]+$/gu;

/** A token compared as a whole: lower case, edge punctuation off, times
 *  written one way ("7 am", "7:00am" and "7am" are the same fact). */
function normalToken(token: string): string {
  return token
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(EDGE_PUNCTUATION, "")
    .replace(/^(\d{1,2}):00(am|pm)$/, "$1$2");
}

function tokensOf(text: string): string[] {
  return text
    .normalize("NFKC")
    .replace(/(\d)\s+(am|pm)\b/gi, "$1$2")
    .split(/\s+/)
    .map(normalToken)
    .filter(Boolean);
}

function indexOfRun(haystack: string[], needle: string[]): number {
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((word, j) => haystack[i + j] === word)) return i;
  }
  return -1;
}

/* What a reader cannot get anywhere else: a number (phone, price, time,
   date, street number), an address on the web or in mail, or a proper noun
   past the first word (a place, an event). An item carrying one of these is
   information, and information is never deleted to avoid repeating the
   CTA. */
const CALENDAR =
  /^(?:mon|tue|wed|thu|fri|sat|sun)(?:day|s|sday|nesday|rsday|urday)?$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:uary|ruary|ch|il|e|y|ust|tember|ober|ember)?$/i;

function isFact(raw: string, index: number): boolean {
  const token = raw.replace(EDGE_PUNCTUATION, "");
  if (/\p{N}/u.test(token)) return true;
  if (CALENDAR.test(token)) return true;
  if (/[@/]/.test(token) || /\p{L}\.\p{L}/u.test(token)) return true;
  return index > 0 && /^\p{Lu}/u.test(token);
}

function factsOf(item: string): string[] {
  return item
    .normalize("NFKC")
    .replace(/(\d)\s+(am|pm)\b/gi, "$1$2")
    .split(/\s+/)
    .filter((raw, index) => raw && isFact(raw, index))
    .map(normalToken)
    .filter(Boolean);
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
/** The whole line appears word for word in the headline or subheadline. */
function repeatsCopyAbove(line: string, above: string[][]): boolean {
  const tokens = tokensOf(line.replace(new RegExp(SEPARATOR, "g"), " "));
  return (
    tokens.length > 0 && above.some((copy) => indexOfRun(copy, tokens) >= 0)
  );
}

function footerLine(line: string, cta: string[]): string {
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

function keptItem(raw: string, cta: string[]): string {
  const item = raw.trim();
  const tokens = tokensOf(item);
  if (tokens.length === 0) return "";
  const facts = factsOf(item);

  if (cta.length > 0) {
    if (tokens.length === cta.length && indexOfRun(tokens, cta) === 0) {
      return "";
    }
    const at = cta.length >= 2 ? indexOfRun(tokens, cta) : -1;
    /* An item led by the call to action is kept whole: cutting the CTA
       off "Order by 8pm for next-day pickup" drew "Next-day pickup" and
       lost the deadline (round-7 live run). Code drops a repeat whole; it
       never rewrites one (Oluwaseyi's ruling, round 7). */
    if (at === 0) return item;
    if (at > 0 && facts.length === 0) return "";
    if (tokens.length >= 2 && indexOfRun(cta, tokens) >= 0) return "";
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

/**
 * What text the renderer can draw correctly, decided before it is drawn.
 *
 * Satori has no shaping engine, no bidi algorithm and no mark positioning.
 * Rendered through it (checked by eye, 2026-10-22):
 *  - Arabic throws inside its font parser (an unsupported GSUB lookup), and
 *    could not join its letters if it did not.
 *  - Hebrew is drawn left to right, so every word reads backwards.
 *  - Devanagari shows bare viramas instead of conjuncts; Thai stacks a tone
 *    mark onto its vowel sign (น้ำ, ปั้น); Khmer draws as empty boxes.
 *  - A combining accent with no precomposed letter (Yoruba ẹ́, ọ̀) lands
 *    beside or before its letter.
 * Wrong letters on a flyer are worse than no flyer, so that copy is refused
 * with a fault the user can act on, never drawn and never thrown from
 * inside the renderer.
 *
 * Every grapheme cluster must also be one satori draws as a single unit:
 * one code point, or an emoji sequence it draws as one 1em picture. A
 * cluster is the unit a line can never break inside, and satori loops
 * forever when one is wider than the line it has to break, which a cluster
 * of several glyphs can be: six conjoining Hangul jamo, or a letter carrying
 * five tag characters, each drawn as its own glyph (render.tsx
 * minBreakableWidth holds the line wider than any such unit).
 */

/** Marks one cluster may carry after NFC. Every letter Vietnamese, Greek
 *  (polytonic too) or any other supported language writes is then a single
 *  code point with no mark left: ẫ and ệ stack two marks only in NFD. What
 *  remains are emoji components, at most two (1️⃣ is 1, U+FE0F, U+20E3).
 *  Zalgo text carries 10 to 30. */
export const MAX_MARKS_PER_CLUSTER = 2;

/** People in the longest emoji ZWJ sequence Unicode recommends (a family of
 *  four). A longer chain is one cluster drawn as many separate pictures. */
export const MAX_EMOJI_IN_SEQUENCE = 4;

/** Each distinct emoji is a picture next/og fetches while it renders, all
 *  of them at once, so a document with hundreds stalls on the network (288
 *  did not draw in 20s from a cold worker). Counted per run and per
 *  document; two dozen is more than any caption uses. */
export const MAX_EMOJI_PER_TEXT = 24;
export const MAX_EMOJI_PER_DOCUMENT = 24;

export const TEXT_SCRIPT_UNSUPPORTED = "TEXT_SCRIPT_UNSUPPORTED" as const;
export const TEXT_CLUSTER_TOO_COMPLEX = "TEXT_CLUSTER_TOO_COMPLEX" as const;
export const TEXT_CONTROL_CHARACTER = "TEXT_CONTROL_CHARACTER" as const;
export const TEXT_TOO_MANY_EMOJI = "TEXT_TOO_MANY_EMOJI" as const;
export const TEXT_ACCENT_UNSUPPORTED = "TEXT_ACCENT_UNSUPPORTED" as const;

export type TextFaultCode =
  | typeof TEXT_SCRIPT_UNSUPPORTED
  | typeof TEXT_CLUSTER_TOO_COMPLEX
  | typeof TEXT_CONTROL_CHARACTER
  | typeof TEXT_TOO_MANY_EMOJI
  | typeof TEXT_ACCENT_UNSUPPORTED;

export interface TextFault {
  code: TextFaultCode;
  /** Written for the person who typed the copy. */
  message: string;
}

/* Scripts drawn correctly, and drawn the same in the editor: letters
   without contextual shaping, laid out left to right, in a face the editor
   loads too (the brand faces, Noto Sans JP, the emoji face; spec,
   "Editor parity"). Common and Inherited cover digits, punctuation, emoji
   and the combining marks Latin, Greek and Cyrillic use. Armenian and
   Georgian draw in satori but from fallback faces a browser does not pick,
   so the editor drew them 45px wider than the box. */
const SUPPORTED_SCRIPTS = [
  "Latin",
  "Greek",
  "Cyrillic",
  "Han",
  "Hiragana",
  "Katakana",
  "Hangul",
  "Bopomofo",
  "Common",
  "Inherited",
] as const;

const SUPPORTED = new RegExp(
  `^[${SUPPORTED_SCRIPTS.map((script) => `\\p{Script=${script}}`).join("")}]$`,
  "u",
);

/* Named for the message, most likely first. Anything else unsupported is
   reported without a name. */
const NAMED_SCRIPTS = [
  "Arabic",
  "Armenian",
  "Georgian",
  "Hebrew",
  "Devanagari",
  "Bengali",
  "Gurmukhi",
  "Gujarati",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Sinhala",
  "Thai",
  "Lao",
  "Khmer",
  "Myanmar",
  "Tibetan",
  "Ethiopic",
  "Syriac",
  "Thaana",
] as const;

/* Direction overrides and isolates reorder text in a browser and do nothing
   in satori, so the editor and the PNG would disagree; C0 and C1 controls
   other than line breaks and tabs have no glyph. */
/* Polytonic Greek (the Greek Extended block). The browser draws it from a
   different fallback face than satori, 17-36px wider in 14 of 20 layouts;
   monotonic Greek, which modern copy uses, is drawn the same in both. */
const GREEK_EXTENDED = /[\u1F00-\u1FFF]/u;

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/u;

const MARK = /\p{M}/gu;
/* The keycap and the emoji presentation selector are drawn as part of the
   emoji they follow; normalizeText has removed every other selector. */
const EMOJI_MARK = /^[\u{FE0F}\u{20E3}]$/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const REGIONAL = /\p{Regional_Indicator}/u;
const KEYCAP_BASE = /^[0-9#*]$/;
const EMOJI = /^\p{Emoji}$/u;
const TAG = /[\u{E0020}-\u{E007F}]/u;
const TAGS = /[\u{E0020}-\u{E007F}]/gu;
const ZWJ = "\u200D";
/* After NFC every modern syllable is one code point; jamo that did not
   compose are archaic or malformed and draw as separate letters. */
const JAMO = /^[\u1100-\u11FF\uA960-\uA97F\uD7B0-\uD7FF]+$/u;
/* Text-presentation, standardised-variant and ideographic-variation
   selectors. Satori draws none of them (each becomes a blank glyph beside
   its letter), and a browser draws the base letter much the same without
   them, so they are removed rather than refused. */
const DROPPED_SELECTORS = /[\u{FE00}-\u{FE0E}\u{E0100}-\u{E01EF}]/gu;

const EMOJI_ELEMENT = String.raw`\p{Extended_Pictographic}(?:\u{FE0F}|[\u{1F3FB}-\u{1F3FF}])?`;
const ZWJ_SEQUENCE = new RegExp(
  `^${EMOJI_ELEMENT}(?:\\u{200D}${EMOJI_ELEMENT}){0,${MAX_EMOJI_IN_SEQUENCE - 1}}$`,
  "u",
);
/* Tag sequences are flags of a subdivision; the only ones Unicode
   recommends, and so the only ones an emoji set draws, are England,
   Scotland and Wales. */
const SUBDIVISION_FLAG =
  /^\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}$/u;
const KEYCAP = /^[0-9#*]\u{FE0F}?\u{20E3}$/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;
/* A text-default emoji (©, ↔, ❤) asking for its picture. */
const PRESENTED = /^\p{Emoji}\u{FE0F}$/u;

let graphemes: Intl.Segmenter | null = null;

function clustersOf(text: string): string[] {
  graphemes ??= new Intl.Segmenter("en", { granularity: "grapheme" });
  return Array.from(graphemes.segment(text), ({ segment }) => segment);
}

/** Satori draws a cluster as one 1em picture only in these shapes; any
 *  other cluster of several code points is drawn glyph by glyph. */
export function isEmojiCluster(cluster: string): boolean {
  if (Array.from(cluster).length === 1) {
    return PICTOGRAPH.test(cluster) || REGIONAL.test(cluster);
  }
  return (
    ZWJ_SEQUENCE.test(cluster) ||
    KEYCAP.test(cluster) ||
    FLAG.test(cluster) ||
    SUBDIVISION_FLAG.test(cluster) ||
    PRESENTED.test(cluster)
  );
}

/* Invisible joiners that join nothing a browser or satori would draw as
   one picture: a tag run that names no flag, a joiner between letters, an
   emoji selector after a letter. A browser draws nothing for them, and
   satori draws each as a blank glyph that widens an unbreakable cluster,
   so they are removed. */
function withoutStrayJoiners(cluster: string): string {
  let out = cluster;
  if (TAG.test(out) && !SUBDIVISION_FLAG.test(out)) out = out.replace(TAGS, "");
  const points = Array.from(out);
  out = points
    .filter((point, i) => {
      if (point !== "\u{FE0F}") return true;
      const before = points[i - 1];
      if (!before || !EMOJI.test(before)) return false;
      return !KEYCAP_BASE.test(before) || points[i + 1] === "\u{20E3}";
    })
    .join("");
  if (out.includes(ZWJ) && !ZWJ_SEQUENCE.test(out)) {
    out = out.replaceAll(ZWJ, "");
  }
  return out;
}

/** The copy as it is stored and drawn: NFC, with selectors and joiners
 *  that draw nothing removed. Idempotent. */
export function normalizeText(text: string): string {
  const composed = text.normalize("NFC").replace(DROPPED_SELECTORS, "");
  return clustersOf(composed).map(withoutStrayJoiners).join("");
}

function scriptName(char: string): string | null {
  return (
    NAMED_SCRIPTS.find((script) =>
      new RegExp(`\\p{Script=${script}}`, "u").test(char),
    ) ?? null
  );
}

/** Distinct emoji pictures the copy makes next/og fetch. */
export function emojiIn(text: string): Set<string> {
  return new Set(clustersOf(text).filter(isEmojiCluster));
}

const CLUSTER_TOO_COMPLEX: TextFault = {
  code: "TEXT_CLUSTER_TOO_COMPLEX",
  message:
    "the copy stacks too many accents or symbols on one character to draw; simplify it and try again",
};

function clusterFault(cluster: string): TextFault | null {
  if (Array.from(cluster).length === 1 || cluster === "\r\n") return null;
  if (isEmojiCluster(cluster)) return null;
  const marks = cluster.match(MARK) ?? [];
  if (marks.length > MAX_MARKS_PER_CLUSTER) return CLUSTER_TOO_COMPLEX;
  if (marks.some((mark) => !EMOJI_MARK.test(mark))) {
    return {
      code: TEXT_ACCENT_UNSUPPORTED,
      message: `"${cluster}" combines accents that have no single-letter form (as in Yoruba ẹ́ or ọ̀), which designs can't place correctly yet; use the letter without the extra accent`,
    };
  }
  if (JAMO.test(cluster)) {
    return {
      code: TEXT_CLUSTER_TOO_COMPLEX,
      message: `"${cluster}" is Hangul jamo that do not form a modern syllable, which designs can't draw; type the syllable itself`,
    };
  }
  return CLUSTER_TOO_COMPLEX;
}

/** Why `text` cannot be drawn correctly, or null when it can. Expects
 *  normalised text (normalizeText). */
export function textFault(text: string): TextFault | null {
  if (CONTROL.test(text)) {
    return {
      code: TEXT_CONTROL_CHARACTER,
      message:
        "the copy contains an invisible control character (such as a direction override); remove it and try again",
    };
  }
  if (GREEK_EXTENDED.test(text)) {
    return {
      code: TEXT_SCRIPT_UNSUPPORTED,
      message:
        "polytonic Greek accents can't be drawn correctly in designs yet; write the copy in monotonic Greek",
    };
  }
  for (const char of text) {
    if (SUPPORTED.test(char)) continue;
    const name = scriptName(char);
    return {
      code: TEXT_SCRIPT_UNSUPPORTED,
      message: `${name ? `${name} script` : "this script"} can't be drawn correctly in designs yet; write the copy in a Latin, Greek, Cyrillic, Chinese, Japanese or Korean script`,
    };
  }
  let emoji = 0;
  for (const cluster of clustersOf(text)) {
    if (isEmojiCluster(cluster)) emoji += 1;
    if (emoji > MAX_EMOJI_PER_TEXT) return tooManyEmoji("one line of text");
    const fault = clusterFault(cluster);
    if (fault) return fault;
  }
  return null;
}

function tooManyEmoji(where: string): TextFault {
  return {
    code: TEXT_TOO_MANY_EMOJI,
    message: `the copy has more than ${where === "one line of text" ? MAX_EMOJI_PER_TEXT : MAX_EMOJI_PER_DOCUMENT} emoji in ${where}; use fewer`,
  };
}

/** The per-document emoji cap, over every run of copy together. */
export function documentEmojiFault(texts: string[]): TextFault | null {
  const distinct = new Set(texts.flatMap((text) => [...emojiIn(text)]));
  return distinct.size > MAX_EMOJI_PER_DOCUMENT
    ? tooManyEmoji("one design")
    : null;
}

/** A spec or document whose copy cannot be drawn, raised by documentFromSpec
 *  when a caller skipped specTextFault. Typed so the job reports the message,
 *  which is written for the user, instead of a renderer stack. */
export class DocumentTextFault extends Error {
  readonly code: TextFaultCode;
  constructor(
    fault: TextFault,
    /** Which field holds the copy: headline, subheadline, cta, footer. */
    readonly field: string,
  ) {
    super(fault.message);
    this.name = "DocumentTextFault";
    this.code = fault.code;
  }
}

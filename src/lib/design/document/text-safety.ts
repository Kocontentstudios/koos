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
 * Text is also normalised (NFC) and every grapheme cluster is bounded. A
 * cluster is the unit a line can never break inside, and satori loops
 * forever when one is wider than the line it has to break: twelve stacked
 * combining marks drawn from fallback faces were enough.
 */

/** Marks one cluster may carry after NFC. Every letter Vietnamese, Greek
 *  (polytonic too) or any other supported language writes is then a single
 *  code point with no mark left: ẫ and ệ stack two marks only in NFD. What
 *  remains are emoji components, at most two (1️⃣ is 1, U+FE0F, U+20E3).
 *  Zalgo text carries 10 to 30. */
export const MAX_MARKS_PER_CLUSTER = 2;

/** The longest emoji sequence Unicode recommends (a kiss with two skin
 *  tones, 10 code points) with room to spare. A ZWJ chain longer than this
 *  is one cluster drawn as many separate pictures, wider than any line. */
export const MAX_CODE_POINTS_PER_CLUSTER = 12;

/** Each distinct emoji is a picture next/og fetches while it renders, so a
 *  run of hundreds is hundreds of requests. Two dozen is more than any
 *  caption uses. */
export const MAX_EMOJI_PER_TEXT = 24;

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

/* Scripts drawn correctly: letters without contextual shaping, laid out left
   to right. Common and Inherited cover digits, punctuation, emoji and the
   combining marks Latin, Greek and Cyrillic use. */
const SUPPORTED_SCRIPTS = [
  "Latin",
  "Greek",
  "Cyrillic",
  "Armenian",
  "Georgian",
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
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/u;

const MARK = /\p{M}/gu;
/* Variation selectors (emoji presentation, Han variants) and the keycap are
   drawn as part of the emoji or glyph they follow. */
const EMOJI_OR_VARIANT_MARK =
  /^[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{20E3}]$/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

let graphemes: Intl.Segmenter | null = null;

export function normalizeText(text: string): string {
  return text.normalize("NFC");
}

function scriptName(char: string): string | null {
  return (
    NAMED_SCRIPTS.find((script) =>
      new RegExp(`\\p{Script=${script}}`, "u").test(char),
    ) ?? null
  );
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
  for (const char of text) {
    if (SUPPORTED.test(char)) continue;
    const name = scriptName(char);
    return {
      code: TEXT_SCRIPT_UNSUPPORTED,
      message: `${name ? `${name} script` : "this script"} can't be drawn correctly in designs yet; write the copy in a Latin, Greek, Cyrillic, Chinese, Japanese or Korean script`,
    };
  }
  graphemes ??= new Intl.Segmenter("en", { granularity: "grapheme" });
  let emoji = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (PICTOGRAPH.test(segment)) emoji += 1;
    if (emoji > MAX_EMOJI_PER_TEXT) {
      return {
        code: TEXT_TOO_MANY_EMOJI,
        message: `the copy has more than ${MAX_EMOJI_PER_TEXT} emoji in one line of text; use fewer`,
      };
    }
    if (segment.length <= 1) continue;
    const marks = segment.match(MARK) ?? [];
    const codePoints = Array.from(segment).length;
    if (
      marks.length > MAX_MARKS_PER_CLUSTER ||
      codePoints > MAX_CODE_POINTS_PER_CLUSTER
    ) {
      return {
        code: TEXT_CLUSTER_TOO_COMPLEX,
        message:
          "the copy stacks too many accents or symbols on one character to draw; simplify it and try again",
      };
    }
    if (marks.some((mark) => !EMOJI_OR_VARIANT_MARK.test(mark))) {
      return {
        code: TEXT_ACCENT_UNSUPPORTED,
        message: `"${segment}" combines accents that have no single-letter form (as in Yoruba ẹ́ or ọ̀), which designs can't place correctly yet; use the letter without the extra accent`,
      };
    }
  }
  return null;
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

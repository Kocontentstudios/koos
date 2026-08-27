/**
 * Turn an assistant reply into something a speech synthesiser should say.
 *
 * SpeechSynthesisUtterance reads whatever it is handed, so raw markdown comes
 * out as "asterisk asterisk", and emoji are announced by their CLDR name
 * ("grinning face with smiling eyes") mid-sentence. Both were reported as the
 * AI "phonetically reading out emojis".
 *
 * Deliberately not a markdown parser: this only has to produce speakable
 * prose, and pulling a parser in to throw away the tree would cost more than
 * it returns.
 */

const RULES: [RegExp, string][] = [
  // Fenced code: unspeakable, and reading it aloud is never what was wanted.
  [/```[\s\S]*?```/g, " "],
  [/`([^`]+)`/g, "$1"],
  // Images before links: the ![alt](url) form must not leave a stray "!".
  [/!\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/\[([^\]]+)\]\([^)]*\)/g, "$1"],
  // Bare autolinks and URLs — a spoken URL is noise.
  [/<https?:\/\/[^>]+>/g, " "],
  [/https?:\/\/\S+/g, " "],
  [/^\s{0,3}#{1,6}\s+/gm, ""],
  [/^\s{0,3}>\s?/gm, ""],
  // Horizontal rules, before list markers so "---" is not read as a bullet.
  [/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, " "],
  [/^\s*[-*+]\s+/gm, ""],
  [/^\s*\d+[.)]\s+/gm, ""],
  [/(\*\*\*|___)(\S(?:[\s\S]*?\S)?)\1/g, "$2"],
  [/(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/g, "$2"],
  [/(\*|_)(\S(?:[\s\S]*?\S)?)\1/g, "$2"],
  [/~~(\S(?:[\s\S]*?\S)?)~~/g, "$1"],
  // Table pipes would otherwise be read as "vertical line".
  [/\|/g, " "],
  // Emoji, their skin-tone/gender modifiers, and the ZWJ that joins sequences.
  [/\p{Extended_Pictographic}/gu, " "],
  [/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu, " "],
  [/[\u{1F1E6}-\u{1F1FF}]/gu, " "],
];

export function speechText(input: string): string {
  let out = input ?? "";
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  // Collapse the gaps the substitutions left, but keep paragraph breaks: they
  // are the pauses that stop a long reply sounding like one run-on sentence.
  return out
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s*\n\s*\n\s*/g, "\n")
    .replace(/[^\S\n]*\n[^\S\n]*/g, "\n")
    .trim();
}

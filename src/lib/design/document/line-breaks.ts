/**
 * Text as both engines receive it, so they break lines in the same places.
 *
 * Satori's line breaker follows the older Unicode rule that never breaks
 * next to a quotation mark (UAX #14 LB19), so «CROISSANTS» „PAIN“ is one
 * unbreakable run to it. Chromium follows the newer rules and breaks at
 * those spaces. The same copy then wrapped into different line counts and
 * overflowed by 11px in the editor. Binding those spaces
 * with a no-break space gives Chromium satori's answer.
 */

const QUOTE = `"'«»‘’‚‛“”„‟‹›`;
const SPACE_BY_QUOTE = new RegExp(` (?=[${QUOTE}])|(?<=[${QUOTE}]) `, "g");

export function breakableText(text: string): string {
  return text.replace(SPACE_BY_QUOTE, " ");
}

/** Whitespace a line may break at: every space except the no-break ones. */
export const BREAKABLE_SPACE = /[^\S   ]+/;

import type { TextElement } from "./schema";

/**
 * Text fitting for the layer document.
 *
 * Satori neither shrinks text to fit nor clips what overflows, so a size that
 * is too big is drawn straight over whatever sits below it (KOOS-BUG-023).
 * render/copy-fit.ts guards that with a per-character width estimate, and
 * being an estimate it has to be pessimistic: every headline gives up a step
 * of size to cover the guess.
 *
 * Here the guess is gone. The search below asks a TextMeasurer how tall a run
 * of text really is at a given size and width, and the production measurer
 * (measure.ts) answers by laying the run out through satori itself, with the
 * same style object the renderer draws. Measurement and render cannot
 * disagree because they are the same layout engine on the same input.
 *
 * Everything in this file is pure given a measurer: integer sizes, a binary
 * search, and no clock or randomness, so the same copy gets the same size
 * every time.
 */

export type TextLook = Pick<
  TextElement,
  | "font"
  | "fontSize"
  | "fontWeight"
  | "lineHeight"
  | "letterSpacing"
  | "align"
  | "italic"
>;

export interface TextMeasurer {
  /** Laid-out height of the run when it wraps at `width`. */
  height(text: string, look: TextLook, width: number): Promise<number>;
  /** Width of the run set on one line. */
  lineWidth(text: string, look: TextLook): Promise<number>;
  /** Width of the widest single word, which decides whether any word has to
   *  break mid-word at a given box width. */
  widestWord(text: string, look: TextLook): Promise<number>;
}

/** Pixel height of one line, as the layout engine rounds it. */
export function lineBox(look: Pick<TextLook, "fontSize" | "lineHeight">) {
  return Math.max(1, Math.round(look.fontSize * look.lineHeight));
}

export function lineCount(
  height: number,
  look: Pick<TextLook, "fontSize" | "lineHeight">,
): number {
  return Math.max(1, Math.round(height / lineBox(look)));
}

/**
 * How far glyphs may reach outside their line box.
 *
 * At a tight display line height an accented capital or a descender pokes
 * past the box the layout engine reports: measured on the bundled display
 * face at 1.05, 0.05em above and 0.04em below. A text element is sized to its
 * laid-out height plus this on each side, so the ink, not just the layout
 * box, stays inside the element.
 */
export function glyphOverhang(
  look: Pick<TextLook, "fontSize" | "lineHeight">,
): number {
  const share = Math.max(0.03, (1.3 - look.lineHeight) / 2 + 0.03);
  return Math.ceil(look.fontSize * share);
}

/**
 * The largest integer in [min, max] for which `fits` holds, assuming fit is
 * monotonic (bigger never fits where smaller did not). Null when even `min`
 * fails. Costs at most ceil(log2(max - min + 1)) + 2 probes.
 */
export async function largestFitting(
  min: number,
  max: number,
  fits: (size: number) => Promise<boolean>,
): Promise<number | null> {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  if (high < low) return null;
  if (await fits(high)) return high;
  if (!(await fits(low))) return null;
  let ok = low;
  let bad = high;
  while (bad - ok > 1) {
    const mid = Math.floor((ok + bad) / 2);
    if (await fits(mid)) ok = mid;
    else bad = mid;
  }
  return ok;
}

/** Below this no copy is worth setting; the brief writer has to shorten it. */
const MIN_LEGIBLE_PX = 10;

export interface FittedText {
  fontSize: number;
  /** Laid-out height at that size and width. */
  height: number;
  lines: number;
  /** False when nothing in range met every constraint and the run was set at
   *  the minimum anyway. The caller decides what to give up. */
  fits: boolean;
  /** True when the widest word is wider than the box at the chosen size,
   *  which only happens when nothing in range fits. */
  wordOverflows: boolean;
}

export interface FitRequest {
  text: string;
  /** The look at a given size; only fontSize varies during the search. */
  look: (fontSize: number) => TextLook;
  width: number;
  maxHeight: number;
  minSize: number;
  maxSize: number;
  /** Lines above which a bigger size is judged worse than a smaller one. A
   *  headline set one word per line is big and unreadable. */
  maxLines?: number;
}

/**
 * The largest size at which the run fits its box, preferring, in order:
 *
 *  1. no more than maxLines lines;
 *  2. any line count;
 *  3. below minSize, down to half of it, when a single word is wider than
 *     the box even at the minimum (a long compound or a URL);
 *  4. the minimum size, reported as not fitting.
 *
 * Every tier requires the widest word to fit the width. Words never break
 * (render.tsx explains why), so a word wider than its box would run off the
 * side of it, and satori does not clip.
 */
export async function fitText(
  measurer: TextMeasurer,
  request: FitRequest,
): Promise<FittedText> {
  const { text, look, width, maxHeight, minSize, maxSize } = request;
  const maxLines = request.maxLines ?? Number.POSITIVE_INFINITY;

  const heightAt = (size: number) => measurer.height(text, look(size), width);
  const wordFits = async (size: number) =>
    (await measurer.widestWord(text, look(size))) <= width;

  /* The word check runs first: it is one probe whatever the text, and a
     size whose widest word overflows is out whatever its height. */
  const fitsBox = async (size: number) =>
    (await wordFits(size)) && (await heightAt(size)) <= maxHeight;
  const tiers = [
    async (size: number) =>
      (await fitsBox(size)) &&
      lineCount(await heightAt(size), look(size)) <= maxLines,
    fitsBox,
  ];
  for (const fits of tiers) {
    const size = await largestFitting(minSize, maxSize, fits);
    if (size !== null) return describe(size, true);
  }

  /* Below the minimum only for a word that cannot fit at it. A run that is
     merely too long stays at the minimum and is reported, so a caller holding
     the minimum for a reason (a headline kept larger than its subheadline)
     sees the misfit instead of a quietly smaller size. */
  if (!(await wordFits(minSize))) {
    const floor = Math.max(MIN_LEGIBLE_PX, minSize / 2);
    const size = await largestFitting(floor, minSize, fitsBox);
    if (size !== null) return describe(size, true);
    return describe(Math.ceil(floor), false);
  }
  return describe(Math.ceil(minSize), false);

  async function describe(size: number, fits: boolean): Promise<FittedText> {
    const height = await heightAt(size);
    return {
      fontSize: size,
      height,
      lines: lineCount(height, look(size)),
      fits,
      wordOverflows: !(await wordFits(size)),
    };
  }
}

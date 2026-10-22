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
 * (measure.tsx) answers by laying the run out through satori itself, with the
 * same style object the renderer draws. Measurement and render cannot
 * disagree because they are the same layout engine on the same input.
 *
 * The browser editor is a different engine on the same input. Its shaping
 * puts a word a pixel or two away from where satori does, so every run is
 * measured a little narrower than the box it is drawn in (wrapWidth): a line
 * that satori just fits still fits in Chromium instead of wrapping and
 * running out of the bottom of its box.
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
  /** Width of the widest run that cannot break (unbreakableRuns), which
   *  decides whether any word has to break mid-word at a given box width. */
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

/** Room left on every line for the browser to shape a word wider than satori
 *  did: 2% of the box, measured against Chromium (browser-parity.smoke). */
export function wrapSlack(width: number): number {
  return Math.max(2, Math.ceil(width * 0.02));
}

/** The width a run is measured at when it will be drawn in a `width` box. */
export function wrapWidth(width: number): number {
  return Math.max(1, Math.floor(width) - wrapSlack(width));
}

/* Scripts whose words are not separated by spaces. A line may break between
   their words, so a run of them is not one unbreakable word. */
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

let segmenter: Intl.Segmenter | null = null;

/**
 * The pieces of `text` a line can never break inside.
 *
 * Spaces separate them in most scripts. Japanese, Chinese and Thai have no
 * spaces, and treating a whole sentence of them as one "word" sent CJK copy
 * to the legibility floor (B7). Those are split at dictionary word
 * boundaries, with punctuation kept on the word before it, as a line breaker
 * would. Coarser than the renderer's own break rules on purpose: a piece
 * judged wider than it can be costs a size step, never an overflow.
 */
export function unbreakableRuns(text: string): string[] {
  const runs: string[] = [];
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    if (!UNSPACED_SCRIPT.test(token)) {
      runs.push(token);
      continue;
    }
    segmenter ??= new Intl.Segmenter("ja", { granularity: "word" });
    let current = "";
    for (const { segment, isWordLike } of segmenter.segment(token)) {
      if (isWordLike && current) {
        runs.push(current);
        current = "";
      }
      current += segment;
    }
    if (current) runs.push(current);
  }
  return runs;
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

/** The first entry of a descending list for which `fits` holds, by binary
 *  search over the indices. */
async function firstFitting(
  sizes: number[],
  fits: (size: number) => Promise<boolean>,
): Promise<number | null> {
  const index = await largestFitting(0, sizes.length - 1, async (i) =>
    fits(sizes[sizes.length - 1 - i]),
  );
  return index === null ? null : sizes[sizes.length - 1 - index];
}

export interface FittedText {
  fontSize: number;
  /** Laid-out height at that size, wrapping at wrapWidth(width). */
  height: number;
  lines: number;
  /** False when nothing at or above the floor met every constraint and the
   *  run was set anyway. The caller reports it; it is never silent. */
  fits: boolean;
  /** True when a run had to break mid-word: it is wider than the box even at
   *  the legibility floor. Only ever true together with a reported fault. */
  breaksWords: boolean;
}

export interface FitRequest {
  text: string;
  /** The look at a given size; only fontSize varies during the search. */
  look: (fontSize: number) => TextLook;
  width: number;
  maxHeight: number;
  /** Sizes the run may take, largest first. A headline passes the shared
   *  HEADLINE_STEPS ladder; other roles pass every integer in a range. */
  sizes: number[];
  /** The smallest size the copy is still readable at. Below the smallest
   *  entry of `sizes`, a run is shrunk toward this, never past it. */
  floor: number;
  /** Lines above which a bigger size is judged worse than a smaller one. A
   *  headline set one word per line is big and unreadable. */
  maxLines?: number;
}

/** Every integer from `max` down to `min`. */
export function sizeRange(min: number, max: number): number[] {
  const sizes: number[] = [];
  for (let size = Math.floor(max); size >= Math.ceil(min); size -= 1) {
    sizes.push(size);
  }
  return sizes.length > 0 ? sizes : [Math.max(1, Math.round(max))];
}

/**
 * The largest size at which the run fits its box, preferring, in order:
 *
 *  1. a size from `sizes` with no more than maxLines lines;
 *  2. a size from `sizes` at any line count;
 *  3. below `sizes`, down to the floor, when a single word is wider than the
 *     box at the smallest size (a long compound or a URL);
 *  4. the floor with the word broken across lines, reported;
 *  5. the smallest size, reported as not fitting.
 *
 * Tiers 1-3 require the widest word to fit, so in normal copy no word ever
 * breaks. Tier 4 exists because a 70-character word cannot fit any box at a
 * readable size: drawing it whole ran 600px off the canvas (B10) and
 * shrinking it until it fit set 4px type (B9). Breaking it keeps the type
 * readable and the ink inside its box, and the fault tells the user to
 * shorten it.
 */
export async function fitText(
  measurer: TextMeasurer,
  request: FitRequest,
): Promise<FittedText> {
  const { text, look, maxHeight } = request;
  const width = wrapWidth(request.width);
  const maxLines = request.maxLines ?? Number.POSITIVE_INFINITY;
  /* A caller that filtered every size away (a hierarchy floor above the
     whole ladder) gets the floor alone, which the tiers below then judge. */
  const sizes =
    request.sizes.length > 0 ? request.sizes : [Math.ceil(request.floor)];
  const smallest = sizes[sizes.length - 1];
  const floor = Math.min(smallest, Math.ceil(request.floor));

  const heightAt = (size: number) => measurer.height(text, look(size), width);
  const wordFits = async (size: number) =>
    (await measurer.widestWord(text, look(size))) <= width;
  /* The word check runs first: it is one probe whatever the text, and a
     size whose widest word overflows is out whatever its height. */
  const fitsBox = async (size: number) =>
    (await wordFits(size)) && (await heightAt(size)) <= maxHeight;
  const fitsLines = async (size: number) =>
    (await fitsBox(size)) &&
    lineCount(await heightAt(size), look(size)) <= maxLines;

  for (const fits of [fitsLines, fitsBox]) {
    const size = await firstFitting(sizes, fits);
    if (size !== null) return describe(size, true);
  }

  /* Below the smallest size only for a word that cannot fit at it. A run that
     is merely too long stays at the smallest size and is reported, so a
     caller holding that size for a reason (a headline kept larger than its
     subheadline) sees the misfit instead of a quietly smaller size. */
  if (!(await wordFits(smallest))) {
    const size = await largestFitting(floor, smallest - 1, fitsBox);
    if (size !== null) return describe(size, true);
    return describe(floor, (await heightAt(floor)) <= maxHeight);
  }
  return describe(smallest, false);

  async function describe(size: number, fits: boolean): Promise<FittedText> {
    const height = await heightAt(size);
    return {
      fontSize: size,
      height,
      lines: lineCount(height, look(size)),
      fits,
      breaksWords: !(await wordFits(size)),
    };
  }
}

/**
 * The width to draw a fitted run at: as narrow as it can be without adding a
 * line, plus the wrap slack, within `width`.
 *
 * This is how lines are balanced. A headline that fills its first line and
 * leaves one word on the second reads as a mistake; narrowing the box until
 * the line count would change spreads the words evenly. CSS text-wrap:
 * balance does the same, but satori and Chromium implement it differently
 * and broke lines in different places (B5), so it is done here, once, with
 * the same greedy wrap both engines agree on.
 *
 * The run keeps exactly the height it was fitted at. Should the extra slack
 * let satori pull a word back onto an earlier line, the width is pulled in
 * until it does not, so the PNG never draws fewer lines than its box holds.
 */
export async function balancedWidth(
  measurer: TextMeasurer,
  text: string,
  look: TextLook,
  width: number,
  fitted: Pick<FittedText, "height" | "breaksWords">,
): Promise<number> {
  const box = Math.floor(width);
  if (fitted.breaksWords) return box;
  const sameLines = async (w: number) =>
    (await measurer.height(text, look, w)) <= fitted.height;
  const widest = Math.ceil(await measurer.widestWord(text, look));
  const ceiling = wrapWidth(box);
  /* The narrowest width that still sets the run in its fitted lines. */
  const narrowest =
    ceiling -
    ((await largestFitting(0, ceiling - widest, async (cut) =>
      sameLines(ceiling - cut),
    )) ?? 0);
  const drawn = Math.min(box, narrowest + wrapSlack(box));
  if ((await measurer.height(text, look, drawn)) >= fitted.height) {
    return drawn;
  }
  /* Every width from `narrowest` up keeps the run within its lines, so the
     only question left is where it starts losing one. */
  const keepsLines = await largestFitting(
    narrowest,
    drawn - 1,
    async (w) => (await measurer.height(text, look, w)) >= fitted.height,
  );
  return keepsLines ?? narrowest;
}

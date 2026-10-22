import {
  balancedWidth,
  type FittedText,
  fitText,
  lineBox,
  sizeRange,
  type TextLook,
  wrapSlack,
  wrapWidth,
} from "../fit";
import { buttonPaddingX, buttonPaddingY } from "../render";
import type { ButtonElement, DesignElement, TextRole } from "../schema";
import {
  base,
  COPY_SHRUNK,
  COPY_TOO_LONG,
  COPY_WORD_BROKEN,
  type Context,
  overlaps,
  px,
  type Rect,
  rect,
  shapeElement,
  textElement,
} from "./context";
import {
  HEADLINE,
  type HeadlineLimits,
  HIERARCHY,
  headlineSizes,
  LEGIBLE_FLOOR,
  looks,
  roleSizes,
} from "./looks";

/**
 * Headline, subheadline and call to action, fitted to a zone and stacked.
 *
 * The subheadline and button are sized first at their natural sizes, and the
 * headline takes whatever height is left: it is the element a designer
 * scales to the space.
 */

export interface CopyColors {
  headline: string;
  body: string;
  ctaFill: string;
  ctaLabel: string;
  accent: string;
}

export interface StackOptions {
  zone: Rect;
  align: "left" | "center";
  vAlign: "start" | "center" | "end";
  colors: CopyColors;
  rule?: "above" | "below";
  quoteMark?: boolean;
  /** Overrides the layout's headline limits. */
  headline?: HeadlineLimits;
}

/** One thing in the stack, measured but not yet placed. */
interface Item {
  height: number;
  gapAfter: number;
  place(x: number, y: number): Promise<DesignElement>;
}

export interface Stack {
  zone: Rect;
  items: Item[];
  top: number;
  bottom: number;
  headline: FittedText;
  /** False when the copy does not fit its zone even at the smallest sizes. */
  fits: boolean;
  faults: string[];
}

function floorPx(ctx: Context): number {
  return Math.round(ctx.ref * LEGIBLE_FLOOR);
}

/**
 * A fitted run as a stack item. Placing it narrows the box to the balanced
 * width (fit.ts balancedWidth) and keeps it where `align` says, so a centred
 * headline stays centred in its zone.
 */
function textItem(
  ctx: Context,
  spec: {
    id: string;
    name: string;
    role: TextRole;
    text: string;
    look: TextLook;
    color: string;
    width: number;
    fitted: Pick<FittedText, "height" | "breaksWords">;
    align: "left" | "center";
    /** Height the item occupies in the stack, when not the fitted height. */
    height?: number;
    balance?: boolean;
  },
): Item {
  return {
    height: spec.height ?? spec.fitted.height,
    gapAfter: 0,
    async place(x, y) {
      const width =
        spec.balance === false
          ? spec.width
          : await balancedWidth(
              ctx.measurer,
              spec.text,
              spec.look,
              spec.width,
              spec.fitted,
            );
      const left = spec.align === "center" ? x + (spec.width - width) / 2 : x;
      return textElement(
        spec.id,
        spec.name,
        spec.role,
        spec.text,
        spec.look,
        spec.color,
        {
          x: px(left),
          y,
          width,
          height: spec.height ?? spec.fitted.height,
        },
      );
    },
  };
}

/**
 * The call to action as a pill that hugs its label.
 *
 * One line at the largest size that fits the zone when it can. A label too
 * long for one line wraps inside a full-width button; a single word too long
 * for that shrinks toward the floor and, past it, breaks, with a fault (the
 * round-1 button had no such path and ran 187px out of its zone, B10).
 */
async function ctaItem(
  ctx: Context,
  label: string,
  zoneWidth: number,
  colors: CopyColors,
  align: "left" | "center",
): Promise<{ item: Item; faults: string[] }> {
  const { measurer, ref } = ctx;
  const sizes = roleSizes(ref, "cta");
  const largest = sizes[0];

  let oneLine: number | null = null;
  for (const size of sizes) {
    const width = await measurer.lineWidth(label, looks.cta(size));
    if (width + wrapSlack(width) + buttonPaddingX(size) * 2 <= zoneWidth) {
      oneLine = size;
      break;
    }
  }

  let fontSize: number;
  let width: number;
  let labelHeight: number;
  const faults: string[] = [];
  if (oneLine !== null) {
    fontSize = oneLine;
    const labelWidth = await measurer.lineWidth(label, looks.cta(fontSize));
    width = labelWidth + wrapSlack(labelWidth) + buttonPaddingX(fontSize) * 2;
    labelHeight = lineBox(looks.cta(fontSize));
  } else {
    /* The padding grows with the type, so the label is fitted to the room
       left beside the largest size's padding: at any smaller size the real
       room is wider and the label can only take fewer lines. */
    const fitted = await fitText(measurer, {
      text: label,
      look: looks.cta,
      width: zoneWidth - buttonPaddingX(largest) * 2,
      maxHeight: lineBox(looks.cta(largest)) * 3,
      sizes,
      floor: floorPx(ctx),
    });
    fontSize = fitted.fontSize;
    width = zoneWidth;
    labelHeight = fitted.height;
    if (fitted.breaksWords) faults.push(COPY_WORD_BROKEN);
    if (fontSize < sizes[sizes.length - 1]) faults.push(COPY_SHRUNK);
  }
  const height = labelHeight + buttonPaddingY(fontSize) * 2;

  return {
    faults,
    item: {
      height,
      gapAfter: 0,
      async place(x, y) {
        const left = align === "center" ? x + (zoneWidth - width) / 2 : x;
        const button: ButtonElement = {
          ...base("cta", "Call to action", { x: left, y, width, height }),
          type: "button",
          label,
          fill: colors.ctaFill,
          color: colors.ctaLabel,
          radius: px(height / 2),
          fontSize,
          fontWeight: 600,
        };
        return button;
      },
    },
  };
}

export async function copyStack(
  ctx: Context,
  options: StackOptions,
): Promise<Stack> {
  const { spec, ref, measurer } = ctx;
  const { zone, align, colors } = options;
  const limits = options.headline ?? HEADLINE[spec.layout];
  const textAlign = align === "center" ? "center" : "left";
  const gapAfterHeadline = px(ref * 0.03);
  const gapBeforeCta = px(ref * 0.05);
  const floor = floorPx(ctx);
  const faults: string[] = [];

  const rule =
    options.rule !== undefined
      ? {
          width: px(ref * 0.09),
          height: Math.max(4, px(ref * 0.008)),
          gap: px(ref * 0.035),
        }
      : null;

  let quote: Item | null = null;
  let quoteGap = 0;
  if (options.quoteMark) {
    const look = looks.quote(px(ref * 0.15), textAlign);
    const height = await measurer.height("“", look, wrapWidth(zone.width));
    quote = textItem(ctx, {
      id: "quote-mark",
      name: "Quote mark",
      role: "body",
      text: "“",
      look,
      color: colors.accent,
      width: zone.width,
      fitted: { height, breaksWords: false },
      align,
      /* The glyph's ink sits in the top half of its line box; the bottom
         half is reclaimed so the mark hangs over the headline instead of
         floating above it. */
      height: px(height * 0.55),
      balance: false,
    });
    quoteGap = px(ref * 0.01);
  }

  const subSizes = roleSizes(ref, "subheadline");
  const fitSubheadline = async (sizes: number[]) =>
    spec.subheadline
      ? fitText(measurer, {
          text: spec.subheadline,
          look: (size) => looks.body(size, textAlign),
          width: zone.width,
          maxHeight: zone.height * 0.4,
          sizes,
          floor,
          maxLines: 5,
        })
      : null;

  const ladder = headlineSizes(ref, limits);
  const fitHeadline = (reserved: number, sizes: number[]) =>
    fitText(measurer, {
      text: spec.headline,
      look: (size) => looks.headline(size, textAlign),
      width: zone.width,
      maxHeight: zone.height - reserved,
      sizes,
      floor,
      maxLines: limits.maxLines,
    });

  const cta = spec.cta
    ? await ctaItem(ctx, spec.cta, zone.width, colors, align)
    : null;
  if (cta) faults.push(...cta.faults);

  const reservedFor = (sub: FittedText | null) =>
    (rule ? rule.height + rule.gap : 0) +
    (quote ? quote.height + quoteGap : 0) +
    (sub ? sub.height + gapAfterHeadline : 0) +
    (cta ? cta.item.height + gapBeforeCta : 0);

  /* Hierarchy before size: a headline smaller than 1.3x its subheadline
     reads from the wrong line first, which is what the flex banner did with
     long copy. When the room cannot hold both, the subheadline steps down
     first; only when it is at its minimum does the hierarchy give way,
     because copy that fits beats copy in the right order that overflows. */
  const subMax = subSizes[0];
  const subMin = subSizes[subSizes.length - 1];
  const subCaps = Array.from(
    new Set([subMax, px((subMax + subMin) / 2), subMin]),
  );
  let sub: FittedText | null = null;
  let headline: FittedText | null = null;
  for (const cap of subCaps) {
    sub = await fitSubheadline(subSizes.filter((size) => size <= cap));
    headline = await fitHeadline(
      reservedFor(sub),
      ladder.filter(
        (size) => size >= Math.ceil((sub?.fontSize ?? 0) * HIERARCHY),
      ),
    );
    if (headline.fits) break;
  }
  if (!headline?.fits) headline = await fitHeadline(reservedFor(sub), ladder);

  /* Past the type scale, toward the legibility floor: copy that does not
     fit the layout at its smallest step is set smaller rather than run over
     the logo or the footer, and the user is told (COPY_SHRUNK). Round 1
     stopped at the scale and let the stack spill out of its zone. */
  if (!headline.fits) {
    const relaxed = sizeRange(floor, subMin);
    const below = sizeRange(floor, ladder[ladder.length - 1] - 1);
    const all = [...ladder, ...below];
    for (const cap of relaxed) {
      sub = await fitSubheadline(relaxed.filter((size) => size <= cap));
      headline = await fitHeadline(
        reservedFor(sub),
        all.filter(
          (size) => size >= Math.ceil((sub?.fontSize ?? 0) * HIERARCHY),
        ),
      );
      if (headline.fits) break;
    }
    if (!headline.fits) headline = await fitHeadline(reservedFor(sub), all);
  }
  if (!headline) throw new Error("No headline was fitted");
  if (headline.breaksWords || sub?.breaksWords) faults.push(COPY_WORD_BROKEN);
  if (
    headline.fontSize < ladder[ladder.length - 1] ||
    (sub && sub.fontSize < subMin)
  ) {
    faults.push(COPY_SHRUNK);
  }

  const items: Item[] = [];
  if (quote) {
    quote.gapAfter = quoteGap;
    items.push(quote);
  }
  const ruleItem: Item | null = rule
    ? {
        height: rule.height,
        gapAfter: 0,
        place: async (x, y) =>
          shapeElement(
            "accent-rule",
            "Accent rule",
            {
              x: align === "center" ? x + (zone.width - rule.width) / 2 : x,
              y,
              width: rule.width,
              height: rule.height,
            },
            colors.accent,
            { radius: px(rule.height / 2) },
          ),
      }
    : null;
  if (ruleItem && rule && options.rule === "above") {
    ruleItem.gapAfter = rule.gap;
    items.push(ruleItem);
  }
  items.push(
    textItem(ctx, {
      id: "headline",
      name: "Headline",
      role: "headline",
      text: spec.headline,
      look: looks.headline(headline.fontSize, textAlign),
      color: colors.headline,
      width: zone.width,
      fitted: headline,
      align,
    }),
  );
  if (ruleItem && rule && options.rule === "below") {
    items[items.length - 1].gapAfter = rule.gap;
    items.push(ruleItem);
  }
  if (sub && spec.subheadline) {
    const last = items[items.length - 1];
    last.gapAfter = Math.max(last.gapAfter, gapAfterHeadline);
    items.push(
      textItem(ctx, {
        id: "subheadline",
        name: "Subheadline",
        role: "subheadline",
        text: spec.subheadline,
        look: looks.body(sub.fontSize, textAlign),
        color: colors.body,
        width: zone.width,
        fitted: sub,
        align,
      }),
    );
  }
  if (cta) {
    items[items.length - 1].gapAfter = gapBeforeCta;
    items.push(cta.item);
  }

  const total = items.reduce(
    (sum, item, index) =>
      sum + item.height + (index < items.length - 1 ? item.gapAfter : 0),
    0,
  );
  const fits = headline.fits && total <= zone.height;
  if (!fits) faults.push(COPY_TOO_LONG);
  /* Copy that overruns its zone even at the floor runs down, over the gap
     above the footer, never up into the logo's corner. */
  const top = !fits
    ? zone.y
    : options.vAlign === "start"
      ? zone.y
      : options.vAlign === "end"
        ? zone.y + zone.height - total
        : zone.y + (zone.height - total) / 2;

  return {
    zone,
    items,
    top: px(top),
    bottom: px(top + total),
    headline,
    fits,
    faults: Array.from(new Set(faults)),
  };
}

/** The stack's elements, top to bottom, `shift` pixels lower than measured. */
export async function placeStack(
  stack: Stack,
  shift = 0,
): Promise<DesignElement[]> {
  let y = stack.top + shift;
  const elements: DesignElement[] = [];
  for (const item of stack.items) {
    elements.push(await item.place(stack.zone.x, y));
    y += item.height + item.gapAfter;
  }
  return elements;
}

/**
 * The zones copy may use once the logo has its corner.
 *
 * Centred layouts give up the same amount on both sides so the copy stays
 * centred under a corner mark, and try both directions: on a landscape
 * canvas clearing the mark vertically can leave a sliver, while clearing it
 * horizontally costs little.
 */
export interface ZoneCandidate {
  zone: Rect;
  /** Multiplies the headline size when choosing between zones. */
  preference: number;
}

export function zonesAvoidingLogo(
  ctx: Context,
  zone: Rect,
  symmetric: boolean,
): ZoneCandidate[] {
  const box = ctx.logoBox;
  const gap = px(ctx.ref * 0.03);
  if (!box || !overlaps(box, zone, gap)) return [{ zone, preference: 1 }];

  const logoOnTop = box.y + box.height / 2 < ctx.height / 2;
  const logoOnLeft = box.x + box.width / 2 < ctx.width / 2;
  const vertical = logoOnTop
    ? box.y + box.height + gap - zone.y
    : zone.y + zone.height - (box.y - gap);
  const horizontal = logoOnLeft
    ? box.x + box.width + gap - zone.x
    : zone.x + zone.width - (box.x - gap);

  const oneSided = (preference: number): ZoneCandidate[] => [
    {
      preference,
      zone: rect(
        zone.x,
        logoOnTop ? zone.y + vertical : zone.y,
        zone.width,
        zone.height - vertical,
      ),
    },
    {
      preference,
      zone: rect(
        logoOnLeft ? zone.x + horizontal : zone.x,
        zone.y,
        zone.width - horizontal,
        zone.height,
      ),
    },
  ];
  /* A centred layout prefers to stay centred, but not at any price: on a
     square card the mirrored reserve can leave the headline a third of the
     size the one-sided zone allows, and then the one-sided zone wins. */
  const candidates: ZoneCandidate[] = symmetric
    ? [
        {
          preference: 1,
          zone: rect(
            zone.x,
            zone.y + vertical,
            zone.width,
            zone.height - vertical * 2,
          ),
        },
        {
          preference: 1,
          zone: rect(
            zone.x + horizontal,
            zone.y,
            zone.width - horizontal * 2,
            zone.height,
          ),
        },
        ...oneSided(0.8),
      ]
    : oneSided(1);
  const usable = candidates.filter(
    ({ zone: candidate }) =>
      candidate.width > ctx.ref * 0.3 && candidate.height > ctx.ref * 0.2,
  );
  /* A mark so large that no zone beside it is usable: share the full zone
     with it rather than have nowhere to put the copy. */
  return usable.length > 0 ? usable : [{ zone, preference: 1 }];
}

/** The stack with the biggest headline among the cleanest zones (fewest and
 *  mildest faults). Its faults become the document's: the stacks not chosen
 *  are never drawn. */
export async function bestStack(
  ctx: Context,
  zones: ZoneCandidate[],
  build: (zone: Rect) => Promise<Stack>,
): Promise<Stack> {
  const stack = await candidateStack(zones, build);
  commitFaults(ctx, stack);
  return stack;
}

const SEVERITY = [COPY_TOO_LONG, COPY_WORD_BROKEN, COPY_SHRUNK];

/** How clean a stack is: higher is better, SEVERITY.length when it has no
 *  fault at all. */
export function stackQuality(stack: Stack): number {
  const worst = SEVERITY.findIndex((fault) => stack.faults.includes(fault));
  return worst === -1 ? SEVERITY.length : worst;
}

export function commitFaults(ctx: Context, stack: Stack): void {
  for (const fault of stack.faults) ctx.faults.add(fault);
}

/** bestStack without committing the faults, for a caller that may still
 *  try a roomier zone. */
export async function candidateStack(
  zones: ZoneCandidate[],
  build: (zone: Rect) => Promise<Stack>,
): Promise<Stack> {
  let best: { stack: Stack; score: number } | null = null;
  for (const { zone, preference } of zones) {
    const stack = await build(zone);
    const score = stack.headline.fontSize * preference;
    const quality = stackQuality(stack);
    const bestQuality = best ? stackQuality(best.stack) : -1;
    const better =
      quality > bestQuality ||
      (quality === bestQuality && best !== null && score > best.score);
    if (better) best = { stack, score };
  }
  if (!best) throw new Error("No zone to place copy in");
  return best.stack;
}

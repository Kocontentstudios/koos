import { contrastRatio, mixToward } from "@/lib/design/palette";
import type { DesignElement } from "../schema";
import { SUBJECT_COVERED, SUBJECT_CROPPED } from "../subject";
import {
  type Built,
  type Context,
  logoElement,
  overlaps,
  px,
  type Rect,
  rect,
  shapeElement,
} from "./context";
import {
  boundsOf,
  type CopyColors,
  candidateStack,
  commitFaults,
  copyStack,
  placeStack,
  type Stack,
  zonesAvoidingLogo,
} from "./copy-stack";
import { type Footer, footer } from "./footer";
import { hexToRgb, type Rgb } from "./ground";
import {
  accentOn,
  framedImage,
  isCutout,
  minSubjectHeight,
  subjectGap,
} from "./image";
import { HEADLINE_OVER_FOOTER, HIERARCHY, SIZES } from "./looks";
import { copyBlocks, gradedVeil, scrimElement, veiledFaces } from "./scrim";
import { CUTOUT_SHARES, copyBottom, flatColors, footerColorOn } from "./shared";

/**
 * A card holding the copy: quote-card and stat-highlight.
 *
 * The image, when there is one, lives inside the card and is clipped to its
 * rounded corners; the canvas around the card is a flat ground. A card laid
 * over a full-bleed image let a cut-out's plate stick out past the
 * card's border with its ragged alpha edge, and the card covered the very
 * subject it was chosen for. A cut-out sits whole in the
 * top of the card with the copy below it; a photograph fills the card with
 * the copy anchored low over a veil measured for it. Without an image the
 * card hugs its copy on a ground it can be seen against.
 */

function cardGround(ctx: Context, variant: "quote" | "stat"): string {
  const { palette } = ctx;
  if (variant === "stat") return palette.background;
  /* A quote card needs a ground the card can stand out from. The accent is
     the brand's own second colour; when it is too close to the card a tint of
     the foreground does the job instead. */
  return contrastRatio(palette.accent, palette.background) >= 1.3
    ? palette.accent
    : mixToward(palette.background, palette.foreground, 0.14);
}

interface CardFrame {
  variant: "quote" | "stat";
  ground: string;
  pad: number;
  radius: number;
  /** Everything the card may cover: inside the margins, above the footer. */
  region: Rect;
  foot: Footer | null;
}

export async function card(
  ctx: Context,
  variant: "quote" | "stat",
): Promise<Built> {
  const { width, margin, ref } = ctx;
  const ground = cardGround(ctx, variant);
  const foot = await footer(ctx, {
    band: { x: margin, width: width - margin * 2 },
    align: "center",
    color: footerColorOn(ctx, ground),
  });
  const frame: CardFrame = {
    variant,
    ground,
    pad: px(ref * 0.07),
    radius: px(ref * 0.04),
    region: rect(
      margin,
      margin,
      width - margin * 2,
      copyBottom(ctx, foot) - margin,
    ),
    foot,
  };
  if (!ctx.image) return flatCard(ctx, frame);
  if (isCutout(ctx)) return subjectAboveCopy(ctx, frame);
  if (!ctx.subject) return photoCard(ctx, frame, "end");
  /* A photograph with a known subject: the copy low over it, then high,
     then the subject in the top of the card above the copy; the first that
     keeps the copy off the subject and the subject whole and large. */
  const placed =
    (await photoCard(ctx, frame, "end", true)) ??
    (await photoCard(ctx, frame, "start", true)) ??
    (await subjectAboveCopy(ctx, frame, true));
  if (placed) return placed;
  ctx.subjectFaults.add(SUBJECT_COVERED);
  return photoCard(ctx, frame, "end");
}

function flatCardColors(ctx: Context, variant: "quote" | "stat"): CopyColors {
  return cardColors(
    ctx,
    variant,
    [hexToRgb(ctx.palette.background)],
    ctx.palette.foreground,
  );
}

/** A stat is the number: set in the accent when the accent reads on the
 *  card, which display-size type only needs 3:1 for. */
function cardColors(
  ctx: Context,
  variant: "quote" | "stat",
  face: Rgb[],
  text: string,
): CopyColors {
  const accent = accentOn(ctx, face, text);
  return {
    ...flatColors(ctx),
    headline: variant === "stat" ? accent : text,
    body: text,
    accent,
  };
}

async function flatCard(ctx: Context, frame: CardFrame): Promise<Built> {
  const stack = await stackOnCard(
    ctx,
    frame,
    frame.region,
    flatCardColors(ctx, frame.variant),
    "center",
  );
  commitFaults(ctx, stack);
  /* The logo's corner is inside the card region (logoBoxIn insets it for
     the card layouts). A card hugging the copy left the mark outside it,
     floating over a bare corner of the ground. */
  const holdsLogo = ctx.logoBox !== null && overlaps(ctx.logoBox, frame.region);
  return finish(ctx, frame, [
    cardShape(
      ctx,
      frame,
      holdsLogo ? frame.region : cardAround(stack, frame.pad),
    ),
    ...(await placeStack(stack)),
  ]);
}

/**
 * The subject whole in the top of the card, the copy in the lower part.
 *
 * The copy gets the least room it fits in cleanly, trying the larger
 * subject shares first, but never so much that the subject falls below its
 * minimum size: copy that has to shrink for that is reported as a copy
 * fault. The copy is never laid over the subject, which is what earlier
 * cards did when the copy did not fit, turning a cream card grey and the
 * product into an 18% thumbnail. With `strict`, null
 * unless the subject is placed clean.
 */
async function subjectAboveCopy(
  ctx: Context,
  frame: CardFrame,
  strict: true,
): Promise<Built | null>;
async function subjectAboveCopy(ctx: Context, frame: CardFrame): Promise<Built>;
async function subjectAboveCopy(
  ctx: Context,
  frame: CardFrame,
  strict = false,
): Promise<Built | null> {
  const { region, pad } = frame;
  const gap = subjectGap(ctx);
  const topFor = (subjectHeight: number) =>
    region.y + pad + Math.ceil(subjectHeight) + gap * 2;
  const leastTop = topFor(minSubjectHeight(ctx));
  /* Larger subject shares first, then the subject at its minimum, then
     smaller still, but only while the headline would otherwise lose the
     hierarchy: one set to keep the subject at its minimum read smaller
     than the footer (21px against 28px). The subject gives way first then,
     and says so (framedImage marks a subject under its minimum as not
     clean); copy merely too long for the layout shrinks as it always has. */
  const floor = headlineFloor(ctx, frame);
  const tops = Array.from(
    new Set([
      ...CUTOUT_SHARES.map((share) =>
        Math.max(px(ctx.height * share), leastTop),
      ),
      leastTop,
      ...UNDERSIZED_SUBJECT.map((share) =>
        topFor(minSubjectHeight(ctx) * share),
      ),
    ]),
  );
  /* The first that sets the copy cleanly; else the largest subject whose
     headline keeps the hierarchy; else the largest headline. */
  let stack: Stack | null = null;
  let leading: Stack | null = null;
  let largest: Stack | null = null;
  for (const lowerTop of tops) {
    const lower = rect(
      region.x,
      lowerTop,
      region.width,
      region.y + region.height - lowerTop,
    );
    const candidate = await stackOnCard(
      ctx,
      frame,
      lower,
      flatCardColors(ctx, frame.variant),
      "end",
    );
    if (candidate.faults.length === 0) {
      stack = candidate;
      break;
    }
    if (candidate.headline.fontSize >= floor) leading ??= candidate;
    if (leading && lowerTop <= leastTop) break;
    if (!largest || candidate.headline.fontSize > largest.headline.fontSize) {
      largest = candidate;
    }
  }
  stack ??= leading ?? largest;
  if (!stack) throw new Error("No subject share was tried");
  const copy = await placeStack(stack);
  const subjectBottom =
    Math.min(stack.top, boundsOf(copy)?.y ?? stack.top) - px(ctx.ref * 0.03);
  const framed = framedImage(
    ctx,
    rect(region.x, region.y, region.width, subjectBottom - region.y),
    {
      insets: { top: pad, bottom: 0, sides: pad },
      keepOut: copyKeepOut(copy),
      inset: true,
    },
  );
  if (!framed || (strict && !framed.clean)) return null;
  if (!framed.clean) ctx.subjectFaults.add(SUBJECT_CROPPED);
  commitFaults(ctx, stack);
  const elements: DesignElement[] = [
    cardShape(ctx, frame, region),
    /* A cut-out's frame may be a room beside the logo, not the card's top,
       and the card already rounds the corners its transparent margin
       shows; a photograph is clipped to them. */
    { ...framed.element, radius: isCutout(ctx) ? 0 : frame.radius },
    ...copy,
  ];
  return finish(ctx, frame, elements);
}

/** Shares of its minimum height a subject steps down through when the
 *  headline cannot keep the hierarchy beside a subject at the minimum. */
const UNDERSIZED_SUBJECT = [0.9, 0.8, 0.7];

/** The least headline that still leads: HEADLINE_OVER_FOOTER times the
 *  footer's type, and never under the subheadline's minimum. */
function headlineFloor(ctx: Context, frame: CardFrame): number {
  const footerSize = Math.max(
    0,
    ...(frame.foot?.elements ?? []).map((e) =>
      e.type === "text" ? e.fontSize : 0,
    ),
  );
  return Math.max(
    Math.ceil(footerSize * HEADLINE_OVER_FOOTER),
    Math.round(ctx.ref * SIZES.subheadline.min * HIERARCHY),
  );
}

/** What the subject must stay out of: the copy as placed, quote mark and
 *  rule included. */
function copyKeepOut(copy: DesignElement[]): Rect[] {
  const box = boundsOf(copy);
  return box ? [box] : [];
}

/**
 * The image filling the card, clipped to its corners, with the copy
 * anchored low ("end") or high ("start") over the least veil its measured
 * pixels need (ground.ts). With a known subject the photo is placed so the
 * subject stays clear of the copy; with `strict`, null when it cannot.
 */
async function photoCard(
  ctx: Context,
  frame: CardFrame,
  vAlign: "start" | "end",
  strict: true,
): Promise<Built | null>;
async function photoCard(
  ctx: Context,
  frame: CardFrame,
  vAlign: "start" | "end",
): Promise<Built>;
async function photoCard(
  ctx: Context,
  frame: CardFrame,
  vAlign: "start" | "end",
  strict = false,
): Promise<Built | null> {
  const { region, radius, variant } = frame;
  const { palette, ref } = ctx;
  const stack = await stackOnCard(
    ctx,
    frame,
    region,
    flatCardColors(ctx, variant),
    vAlign,
  );
  const copyTop = Math.max(region.y, stack.top - px(ref * 0.02));
  const copyRegion = rect(
    region.x,
    copyTop,
    region.width,
    Math.min(region.y + region.height, stack.bottom + px(ref * 0.02)) - copyTop,
  );
  const copy = await placeStack(stack);
  const framed = framedImage(ctx, region, {
    keepOut: [copyRegion, ...copyKeepOut(copy)],
  });
  if (!framed || (strict && !framed.clean)) return null;
  commitFaults(ctx, stack);
  const placement = framed.placement;
  const from = vAlign === "end" ? "bottom" : "top";
  const veiling = { from, background: palette.background } as const;
  const blocks = copyBlocks(ctx, copy);
  const graded = gradedVeil(ctx, placement, region, blocks, veiling);
  const face = veiledFaces(ctx, placement, region, blocks, graded, veiling);
  const colors = cardColors(ctx, variant, face, graded.veil.text);

  const elements: DesignElement[] = [
    shapeElement("card", "Card", region, palette.background, { radius }),
    { ...framed.element, radius },
  ];
  const scrim = scrimElement(region, graded, { from, radius });
  if (scrim) elements.push(scrim);
  if (variant === "stat") elements.push(cardEdge(ctx, frame, region));
  elements.push(...colorCopy(copy, colors));
  return finish(ctx, frame, elements);
}

/** The placed copy in `colors`: the stack was fitted before the ground under
 *  it was known, and colour does not change a fit. */
function colorCopy(
  elements: DesignElement[],
  colors: CopyColors,
): DesignElement[] {
  return elements.map((element) => {
    if (element.type === "text") {
      const color =
        element.id === "headline"
          ? colors.headline
          : element.id === "subheadline"
            ? colors.body
            : element.id === "quote-mark"
              ? colors.accent
              : element.color;
      return { ...element, color };
    }
    if (element.type === "shape" && element.id === "accent-rule") {
      return { ...element, fill: colors.accent };
    }
    return element;
  });
}

function finish(
  ctx: Context,
  frame: CardFrame,
  elements: DesignElement[],
): Built {
  if (frame.foot) elements.push(...frame.foot.elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: frame.ground, elements };
}

function stackOnCard(
  ctx: Context,
  frame: CardFrame,
  region: Rect,
  colors: CopyColors,
  vAlign: "start" | "center" | "end",
): Promise<Stack> {
  const { pad, variant } = frame;
  /* Centred copy gives up the same room top and bottom to clear a corner
     mark; copy anchored low only needs to clear it at the top. */
  const zones = zonesAvoidingLogo(ctx, region, vAlign === "center");
  return candidateStack(zones, (candidate) =>
    copyStack(ctx, {
      zone: rect(
        candidate.x + pad,
        candidate.y + pad,
        candidate.width - pad * 2,
        candidate.height - pad * 2,
      ),
      align: "center",
      vAlign,
      colors,
      ...(variant === "quote"
        ? { quoteMark: true }
        : { rule: "below" as const }),
    }),
  );
}

/** The card hugs its copy but never shrinks below 60% of the room, or a
 *  short headline sits in a postage stamp on a sea of colour. */
function cardAround(stack: Stack, pad: number): Rect {
  const room = stack.zone.height + pad * 2;
  const content = stack.bottom - stack.top + pad * 2;
  const cardHeight = Math.min(room, Math.max(content, room * 0.6));
  return rect(
    stack.zone.x - pad,
    (stack.top + stack.bottom) / 2 - cardHeight / 2,
    stack.zone.width + pad * 2,
    cardHeight,
  );
}

function statBorder(ctx: Context) {
  return {
    borderColor: ctx.palette.accent,
    borderWidth: Math.max(3, px(ctx.ref * 0.006)),
  };
}

function cardShape(ctx: Context, frame: CardFrame, box: Rect): DesignElement {
  return shapeElement("card", "Card", box, ctx.palette.background, {
    radius: frame.radius,
    ...(frame.variant === "stat" ? statBorder(ctx) : {}),
  });
}

/** The stat card's accent border, drawn over the image so the photo cannot
 *  cover it. */
function cardEdge(ctx: Context, frame: CardFrame, box: Rect): DesignElement {
  return shapeElement("card-edge", "Card border", box, "transparent", {
    radius: frame.radius,
    ...statBorder(ctx),
  });
}

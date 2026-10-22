import { contrastRatio, mixToward } from "@/lib/design/palette";
import type { DesignElement } from "../schema";
import {
  type Built,
  type Context,
  logoElement,
  px,
  type Rect,
  rect,
  shapeElement,
} from "./context";
import {
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
  samplesUnder,
  veiled,
  veilFor,
} from "./image";
import {
  CUTOUT_SHARES,
  copyBottom,
  flatColors,
  footerColorOn,
  MIN_SUBJECT_SHARE,
  scrimFor,
} from "./shared";

/**
 * A card holding the copy: quote-card and stat-highlight.
 *
 * The image, when there is one, lives inside the card and is clipped to its
 * rounded corners; the canvas around the card is a flat ground. Round 1 laid
 * the card over a full-bleed image, so a cut-out's plate stuck out past the
 * card's border with its ragged alpha edge, and the card covered the very
 * subject it was chosen for (U3 live critique). A cut-out sits whole in the
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
  if (isCutout(ctx)) {
    const above = await subjectAboveCopy(ctx, frame);
    if (above) return above;
  }
  return photoCard(ctx, frame);
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
  return finish(ctx, frame, [
    cardShape(ctx, frame, cardAround(stack, frame.pad)),
    ...(await placeStack(stack)),
  ]);
}

/**
 * A cut-out whole in the top of the card, the copy in the lower part.
 *
 * The copy gets the least room it fits in cleanly, trying the larger
 * subject shares first. Null when no share leaves both clean copy and a
 * subject worth drawing; the caller then contains the subject in the whole
 * card with the copy over it.
 */
async function subjectAboveCopy(
  ctx: Context,
  frame: CardFrame,
): Promise<Built | null> {
  const { region, pad } = frame;
  for (const share of CUTOUT_SHARES) {
    const lowerTop = px(ctx.height * share);
    const lower = rect(
      region.x,
      lowerTop,
      region.width,
      region.y + region.height - lowerTop,
    );
    const stack = await stackOnCard(
      ctx,
      frame,
      lower,
      flatCardColors(ctx, frame.variant),
      "end",
    );
    if (stack.faults.length > 0) continue;
    const subjectBottom = stack.top - px(ctx.ref * 0.03);
    if (subjectBottom - region.y - pad < ctx.height * MIN_SUBJECT_SHARE) {
      return null;
    }
    const framed = framedImage(
      ctx,
      rect(region.x, region.y, region.width, subjectBottom - region.y),
      { top: pad, bottom: 0, sides: pad },
    );
    const elements: DesignElement[] = [cardShape(ctx, frame, region)];
    if (framed) elements.push({ ...framed.element, radius: frame.radius });
    elements.push(...(await placeStack(stack)));
    return finish(ctx, frame, elements);
  }
  return null;
}

/**
 * The image filling the card, clipped to its corners, with the copy
 * anchored low over the least veil its measured pixels need (ground.ts).
 * A cut-out that lands here is contained inside the card's padding, so it
 * is still whole; the copy then sits over it, veiled.
 */
async function photoCard(ctx: Context, frame: CardFrame): Promise<Built> {
  const { region, pad, radius, variant } = frame;
  const { palette, ref } = ctx;
  const framed = framedImage(ctx, region, {
    top: pad,
    bottom: pad,
    sides: pad,
  });
  const placement = framed?.placement ?? null;

  const stack = await stackOnCard(
    ctx,
    frame,
    region,
    flatCardColors(ctx, variant),
    "end",
  );
  commitFaults(ctx, stack);
  const copyTop = Math.max(region.y, stack.top - px(ref * 0.02));
  const copyRegion = rect(
    region.x,
    copyTop,
    region.width,
    Math.min(region.y + region.height, stack.bottom + px(ref * 0.02)) - copyTop,
  );
  /* The card's own fill is what a cut-out's transparent pixels show. */
  const veil = veilFor(ctx, placement, copyRegion, palette.background);
  const face = veiled(
    samplesUnder(ctx, placement, copyRegion, palette.background),
    veil,
    veil.alpha,
  );
  const colors = cardColors(ctx, variant, face, veil.text);

  const elements: DesignElement[] = [
    shapeElement("card", "Card", region, palette.background, { radius }),
  ];
  if (framed) elements.push({ ...framed.element, radius });
  const scrim = scrimFor(region, stack.top, veil, radius);
  if (scrim) elements.push(scrim);
  if (variant === "stat") elements.push(cardEdge(ctx, frame, region));
  elements.push(...colorCopy(await placeStack(stack), colors));
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
  vAlign: "center" | "end",
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

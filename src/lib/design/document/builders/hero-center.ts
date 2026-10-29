import type { AssetRef, DesignElement } from "../schema";
import {
  BAND_COVER_MAX,
  type BandSide,
  bandedPlacement,
  grown,
  isSideBand,
  overlapShare,
  SAME_PLACE_SHARE,
  SUBJECT_COVERED,
  SUBJECT_CROPPED,
  subjectOnCanvas,
} from "../subject";
import {
  type Built,
  type Context,
  imageElement,
  logoElement,
  px,
  type Rect,
  rect,
  WHITE,
} from "./context";
import {
  boundsOf,
  candidateStack,
  commitFaults,
  copyStack,
  placeStack,
  type Stack,
  zonesAvoidingLogo,
} from "./copy-stack";
import { type Footer, footer, recolorFooter } from "./footer";
import type { ImagePlacement } from "./ground";
import {
  type Framed,
  framedImage,
  isCutout,
  minSubjectEdge,
  minSubjectHeight,
  onMargin,
  subjectGap,
} from "./image";
import { HERO_OVER_PHOTO } from "./looks";
import {
  copyBlocks,
  gradedVeil,
  nearestLead,
  scrimElement,
  startClear,
  veiledFaces,
} from "./scrim";
import {
  buttonOn,
  CUTOUT_SHARES,
  copyBottom,
  flatColors,
  footerColorOn,
  recolorCopy,
} from "./shared";

/**
 * Copy centred on the canvas, over a full-bleed photograph when there is
 * one.
 *
 * With a known subject the layout tries, in order, and takes the first that
 * keeps the copy off the subject and the subject whole at its minimum size
 * (subject.ts):
 *  1. the photo full bleed, copy low, the subject framed above it;
 *  2. the photo full bleed, copy high, the subject below it;
 *  3. the photo full bleed, copy in a band on the side covering least of
 *     the subject, under a dark veil where it lies on it (coveredBleed);
 *  4. the subject in a band above the copy, the copy on the flat ground.
 * A cut-out only ever takes 4: it is a product on nothing, and the flat
 * ground is its background. When none holds, 1 is drawn and the fault is
 * reported. Without a subject the photo fills the canvas and the copy is
 * veiled only as much as the pixels under each run need (scrim.ts).
 */

export async function heroCenter(ctx: Context): Promise<Built> {
  const { width, margin, palette } = ctx;
  const foot = await footer(ctx, {
    band: { x: margin, width: width - margin * 2 },
    align: "center",
    color: footerColorOn(ctx, palette.background),
  });

  if (!ctx.image) return flat(ctx, foot);
  if (isCutout(ctx)) return band(ctx, foot);
  if (!ctx.subject) {
    /* Low or high, whichever veil changes the photo least (scrim.ts);
       low wins near-ties and anything that fits worse. */
    const low = await fullBleed(ctx, foot, "end");
    const high = await fullBleed(ctx, foot, "start");
    const highFitsAsWell = high.stack.faults.length <= low.stack.faults.length;
    return settle(
      ctx,
      highFitsAsWell && high.veilCost < low.veilCost - 0.01 ? high : low,
    );
  }

  for (const vAlign of ["end", "start"] as const) {
    const attempt = await fullBleed(ctx, foot, vAlign, true);
    if (attempt) return settle(ctx, attempt);
  }
  const bled = await coveredBleed(ctx);
  if (bled) return bled;
  const banded = await band(ctx, foot, true);
  if (banded) return banded;
  const aside = await beside(ctx, true);
  if (aside) return aside;
  ctx.subjectFaults.add(SUBJECT_COVERED);
  return settle(ctx, await fullBleed(ctx, foot, "end"));
}

async function flat(ctx: Context, foot: Footer | null): Promise<Built> {
  const stack = await stackIn(ctx, copyZone(ctx, foot), "center");
  commitFaults(ctx, stack);
  return finish(ctx, foot, await placeStack(stack));
}

function copyZone(ctx: Context, foot: Footer | null): Rect {
  const { width, margin } = ctx;
  return rect(
    margin,
    margin,
    width - margin * 2,
    copyBottom(ctx, foot) - margin,
  );
}

function stackIn(
  ctx: Context,
  zone: Rect,
  vAlign: "start" | "center" | "end",
): Promise<Stack> {
  return candidateStack(zonesAvoidingLogo(ctx, zone, true), (z) =>
    copyIn(ctx, z, vAlign),
  );
}

function finish(
  ctx: Context,
  foot: Footer | null,
  elements: DesignElement[],
): Built {
  if (foot) elements.push(...foot.elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: ctx.palette.background, elements };
}

/** What the subject must stay out of: the placed copy and the footer's
 *  lines (a footer bar is ground, and may run under it). */
function keepOutOf(copy: DesignElement[], foot: Footer | null): Rect[] {
  const lines = foot?.elements.filter((e) => e.type === "text") ?? [];
  return [boundsOf(copy), boundsOf(lines)].filter(
    (box): box is Rect => box !== null,
  );
}

/** A full-bleed build not yet chosen: how heavily its veil touches the
 *  photo, and the stack whose faults are reported if it is. */
type Bled = Built & { veilCost: number; stack: Stack };

function settle(ctx: Context, bled: Bled): Built {
  commitFaults(ctx, bled.stack);
  return { background: bled.background, elements: bled.elements };
}

/**
 * The photo over the whole canvas with the copy anchored low ("end") or
 * high ("start"). With `strict`, null unless the subject is placed clean.
 */
async function fullBleed(
  ctx: Context,
  foot: Footer | null,
  vAlign: "start" | "end",
  strict: true,
): Promise<Bled | null>;
async function fullBleed(
  ctx: Context,
  foot: Footer | null,
  vAlign: "start" | "end",
): Promise<Bled>;
async function fullBleed(
  ctx: Context,
  foot: Footer | null,
  vAlign: "start" | "end",
  strict = false,
): Promise<Bled | null> {
  const { width, height, palette } = ctx;
  const stack = await stackIn(ctx, copyZone(ctx, foot), vAlign);
  const copy = await placeStack(stack);
  const framed = framedImage(ctx, rect(0, 0, width, height), {
    keepOut: keepOutOf(copy, foot),
  });
  if (!framed || (strict && !framed.clean)) return null;

  const from = vAlign === "end" ? "bottom" : "top";
  const canvas = rect(0, 0, width, height);
  const graded = gradedVeil(
    ctx,
    framed.placement,
    canvas,
    copyBlocks(ctx, [...copy, ...veiledFooter(foot)]),
    { from, background: palette.background },
  );
  const veil = graded.veil;
  const elements: DesignElement[] = [framed.element];
  const scrim = scrimElement(canvas, graded, { from });
  if (scrim) elements.push(scrim);
  elements.push(...recolorCopy(copy, veil.text));
  if (foot) elements.push(...recolorFooter(foot, veil.text).elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return {
    background: palette.background,
    elements,
    veilCost: graded.cost,
    stack,
  };
}

/* The share of the canvas a side band of copy takes over a full-bleed
   photo: the copy column of a split, so the type sets as it does there. */
const SIDE_BAND_SHARE = 0.46;

/* Shares of the canvas width a photo bleeding off three edges steps down
   through, widest first, when no placement over the whole canvas shows
   the subject whole: a portrait on 16:9, whose head box alone is taller
   than the canvas at any cover of its width (round-24 geometry). */
const BLEED_STEPS = Array.from({ length: 33 }, (_, i) => 0.96 - i * 0.02);

/* How far a side band runs onto a photo that bleeds off the other three
   edges, as a share of the shorter side: the dark band fades into the
   photo over it instead of meeting it at a hard edge. */
const BLEED_OVERLAP = 0.08;

/* Room between the copy and the edge of a top or bottom band. */
const BAND_PAD = 0.5;

interface BandPlan {
  side: BandSide;
  band: Rect;
  frame: Rect;
  placement: ImagePlacement;
  cover: number;
  foot: Footer | null;
  stack: Stack;
}

/**
 * The photo full bleed with the copy in a band on one side, under a veil
 * that is dark wherever the band lies on the subject. Oluwaseyi's ruling of
 * 2026-10-29: the band may lie on the subject box's outer edge, never on a
 * face or head box and never on more than BAND_COVER_MAX of the box's width
 * (side band) or height (top or bottom band); text AA and the button 3:1
 * on the veiled pixels; the side covering least of the subject wins. Before
 * it no band cleared the stock portrait, facade or espresso bar, and each
 * pair shipped as a left/right mirror (round-9 live critic). When no
 * placement over the whole canvas shows the subject whole, a side band
 * tries the photo bleeding off the other three edges, the band's dark
 * ground fading into it. Null when nothing holds.
 */
async function coveredBleed(ctx: Context): Promise<Built | null> {
  const { width, height, subject, imageFacts } = ctx;
  if (!subject || !imageFacts || isCutout(ctx)) return null;
  const canvas = rect(0, 0, width, height);
  const onRight = subject.x + subject.w / 2 >= 0.5;
  const sides: BandSide[] = [
    ...(onRight ? (["left", "right"] as const) : (["right", "left"] as const)),
    ...(subject.y + subject.h / 2 >= 0.5
      ? (["top", "bottom"] as const)
      : (["bottom", "top"] as const)),
  ];
  const plans: BandPlan[] = [];
  for (const side of sides) {
    const plan = await planBand(ctx, side, canvas);
    if (plan) plans.push(plan);
  }
  if (plans.length === 0) {
    for (const side of sides.filter(isSideBand)) {
      for (const share of BLEED_STEPS) {
        const fw = px(width * share);
        const frame =
          side === "left"
            ? rect(width - fw, 0, fw, height)
            : rect(0, 0, fw, height);
        const plan = await planBand(ctx, side, frame);
        if (plan) {
          plans.push(plan);
          break;
        }
      }
    }
  }
  const best = leastCover(apartFromSibling(ctx, plans));
  return best ? drawBand(ctx, best) : null;
}

/* Among bands the ruling allows, those that keep the photo out of the
   place the pair's other design draws it, when any do: a portrait whose
   two sides covered it about equally bled on the side of its split
   sibling's print, and the pair read as one shape (round-24 job test). */
function apartFromSibling(ctx: Context, plans: BandPlan[]): BandPlan[] {
  const sibling = ctx.siblingPhoto;
  if (!sibling) return plans;
  const apart = plans.filter(
    (plan) =>
      overlapShare(
        {
          x: plan.frame.x / ctx.width,
          y: plan.frame.y / ctx.height,
          w: plan.frame.width / ctx.width,
          h: plan.frame.height / ctx.height,
        },
        sibling,
      ) < SAME_PLACE_SHARE,
  );
  return apart.length > 0 ? apart : plans;
}

function leastCover(plans: BandPlan[]): BandPlan | null {
  let best: BandPlan | null = null;
  for (const plan of plans) {
    if (!best || plan.cover < best.cover - 1e-9) best = plan;
  }
  return best;
}

/** The band on `side`, its copy, and the placement in `frame` that keeps
 *  the ruling, or null. */
async function planBand(
  ctx: Context,
  side: BandSide,
  frame: Rect,
  given?: Rect,
): Promise<BandPlan | null> {
  const { width, height, margin, palette, subject, imageFacts } = ctx;
  if (!subject || !imageFacts) return null;
  const gap = subjectGap(ctx);
  const avoid = ctx.logoBox ? [grown(ctx.logoBox, gap)] : [];
  const place = (band: Rect, more: Rect[]) =>
    bandedPlacement(imageFacts, subject, frame, band, side, {
      heads: ctx.heads ?? [],
      avoid: [...avoid, ...more.map((zone) => grown(zone, gap))],
      minEdge: minSubjectEdge(ctx),
      gap,
    });

  if (isSideBand(side)) {
    const reach = px(ctx.ref * BLEED_OVERLAP);
    const bandWidth =
      side === "left"
        ? Math.max(px(width * SIDE_BAND_SHARE), frame.x + reach)
        : Math.max(
            px(width * SIDE_BAND_SHARE),
            width - (frame.x + frame.width) + reach,
          );
    const full =
      given ??
      (side === "left"
        ? rect(0, 0, bandWidth, height)
        : rect(width - bandWidth, 0, bandWidth, height));
    const hasBar = ctx.spec.footerStyle === "bar";
    /* Without a bar the footer only sits in the band, so a band that fails
       is not worth measuring it for. */
    if (!hasBar && !place(full, [])) return null;
    const foot = await footer(ctx, {
      band: { x: full.x + margin, width: full.width - margin * 2 },
      align: "center",
      color: palette.foreground,
    });
    const bar = foot && hasBar ? foot : null;
    const band = bar ? aboveBar(full, bar.top) : full;
    if (bar) frame = aboveBar(frame, bar.top);
    const found = place(band, []);
    if (!found) return null;
    const bleeds = frame.width < width - 0.5;
    if (bleeds && !given) {
      /* A band that only touched the photo's edge reads as a split with a
         dark panel; it runs as far onto the photo as the ruling allows, so
         the copy sits over the photo's edge. */
      const reached = furthestBand(ctx, side, band, found.placement);
      if (reached.width > band.width + 0.5) {
        const wider = await planBand(ctx, side, frame, reached);
        if (wider) return wider;
      }
    }
    const stack = await stackIn(
      ctx,
      rect(
        band.x + margin,
        margin,
        band.width - margin * 2,
        copyBottom(ctx, foot) - margin,
      ),
      "center",
    );
    return { side, band, frame, foot, stack, ...found };
  }

  const foot = await footer(ctx, {
    band: { x: margin, width: width - margin * 2 },
    align: "center",
    color: palette.foreground,
  });
  const bar = foot && ctx.spec.footerStyle === "bar" ? foot : null;
  if (bar) frame = aboveBar(frame, bar.top);
  /* A top band leaves a plain footer on the bare photo at the bottom,
     under no veil: only a footer bar, which is its own ground, goes with
     it. */
  if (side === "top" && foot && !bar) return null;
  const stack = await stackIn(
    ctx,
    copyZone(ctx, foot),
    side === "top" ? "start" : "end",
  );
  const copy = await placeStack(stack);
  const lines = side === "bottom" ? veiledFooter(foot) : [];
  const bounds = boundsOf([...copy, ...lines]);
  if (!bounds) return null;
  const pad = px(margin * BAND_PAD);
  const band =
    side === "top"
      ? rect(0, 0, width, bounds.y + bounds.height + pad)
      : rect(
          0,
          bounds.y - pad,
          width,
          (bar ? bar.top : height) - (bounds.y - pad),
        );
  const found = place(band, []);
  return found ? { side, band, frame, foot, stack, ...found } : null;
}

/* A footer bar is its own ground: the photo and its veil stop at it, as a
   split's photo does, rather than run under it (round-24 live run, the
   fashion portrait with a bar could not bleed past it whole). */
function aboveBar(box: Rect, top: number): Rect {
  return rect(box.x, box.y, box.width, Math.min(box.height, top - box.y));
}

/** A side band widened onto the photo up to the ruling's limits: no
 *  further than BAND_COVER_MAX into the subject, and the gap short of every
 *  head. */
function furthestBand(
  ctx: Context,
  side: BandSide,
  band: Rect,
  placement: ImagePlacement,
): Rect {
  const { width, height, imageFacts, subject } = ctx;
  if (!imageFacts || !subject) return band;
  const gap = subjectGap(ctx);
  const box = subjectOnCanvas(imageFacts, subject, placement);
  const heads = (ctx.heads ?? []).map((head) =>
    subjectOnCanvas(imageFacts, head, placement),
  );
  if (side === "left") {
    const limit = Math.min(
      box.x + box.width * BAND_COVER_MAX,
      ...heads
        .filter((h) => h.x + h.width > band.x + band.width)
        .map((h) => h.x - gap),
    );
    const edge = Math.floor(Math.max(band.x + band.width, limit));
    return rect(0, 0, edge, height);
  }
  const limit = Math.max(
    box.x + box.width * (1 - BAND_COVER_MAX),
    ...heads.filter((h) => h.x < band.x).map((h) => h.x + h.width + gap),
  );
  const edge = Math.ceil(Math.min(band.x, limit));
  return rect(edge, 0, width - edge, height);
}

/** The planned band drawn: the photo, its veil, the copy and the button
 *  set to clear their ground. */
async function drawBand(ctx: Context, plan: BandPlan): Promise<Built> {
  const { palette } = ctx;
  const { side, band, frame, placement, cover, foot, stack } = plan;
  const copy = await placeStack(stack);
  const bleeds = frame.width < ctx.width - 0.5;
  /* A photo bleeding off three edges meets the band's dark ground: the
     veil is whole from the canvas edge to the photo, then fades into it. */
  const photoAt =
    side === "left"
      ? (band.x + band.width - frame.x) / band.width
      : (frame.x + frame.width - band.x) / band.width;
  const floor = bleeds
    ? [
        { at: 0, alpha: 0 },
        { at: Math.min(1, Math.max(0, photoAt)), alpha: 1 },
        { at: 1, alpha: 1 },
      ]
    : undefined;
  const options = {
    from: side,
    background: palette.background,
    /* The ruling's dark veil wherever the band lies on the subject. */
    ...(cover > 0 || bleeds ? { texts: [WHITE] } : {}),
    ...(floor ? { floor } : {}),
  };
  const footLines = side === "top" ? [] : veiledFooter(foot);
  const text = [...copy.filter((e) => e.id !== "cta"), ...footLines];
  const blocks = copyBlocks(ctx, text);
  const button = copy.find((e) => e.type === "button");
  const buttonBlock = button
    ? [
        {
          box: rect(button.x, button.y, button.width, button.height),
          large: false,
        },
      ]
    : [];
  const veil = gradedVeil(ctx, placement, band, blocks, options);
  const graded = {
    ...veil,
    stops: startClear(
      veil.stops,
      nearestLead(band, [...blocks, ...buttonBlock], side),
    ),
  };
  const pill = buttonOn(
    ctx,
    veiledFaces(ctx, placement, band, buttonBlock, graded, options),
  );
  const elements: DesignElement[] = [
    imageElement(ctx.image as AssetRef, frame, placement),
  ];
  const scrim = scrimElement(band, graded, { from: side });
  if (scrim) elements.push(scrim);
  elements.push(
    ...recolorCopy(copy, graded.veil.text).map((e) =>
      e.type === "button" ? { ...e, fill: pill.fill, color: pill.label } : e,
    ),
  );
  if (foot) elements.push(...recolorFooter(foot, graded.veil.text).elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  commitFaults(ctx, stack);
  return { background: palette.background, elements };
}

/** Footer lines that sit on the photo, not on a bar of their own. */
function veiledFooter(foot: Footer | null): DesignElement[] {
  if (!foot || foot.elements.some((e) => e.type === "shape")) return [];
  return foot.elements;
}

/**
 * The subject in a band across the top, the copy below it on the flat
 * ground. The band takes the largest share (CUTOUT_SHARES) whose copy fits
 * cleanly, never less than the subject's minimum size needs: copy that then
 * has to shrink is reported as a copy fault, never laid over the subject.
 * With `strict`, null unless the subject is placed clean.
 */
async function band(
  ctx: Context,
  foot: Footer | null,
  strict: true,
): Promise<Built | null>;
async function band(ctx: Context, foot: Footer | null): Promise<Built>;
async function band(
  ctx: Context,
  foot: Footer | null,
  strict = false,
): Promise<Built | null> {
  const { width, height, margin } = ctx;
  const bottom = copyBottom(ctx, foot);
  const gap = subjectGap(ctx);
  const leastTop = margin + minSubjectHeight(ctx) + gap * 2;
  let stack: Stack | null = null;
  for (const share of CUTOUT_SHARES) {
    const top = Math.max(px(height * share), leastTop);
    const below = rect(margin, top, width - margin * 2, bottom - top);
    stack = await stackIn(ctx, below, "center");
    if (stack.faults.length === 0) break;
  }
  if (!stack) throw new Error("No band share was tried");
  const copy = await placeStack(stack);
  const frame = rect(0, 0, width, stack.top - px(ctx.ref * 0.03));
  const framed: Framed | null = framedImage(ctx, frame, {
    insets: { top: margin, bottom: 0, sides: margin },
    keepOut: keepOutOf(copy, foot),
    inset: true,
    align: "axis",
    minInsetWidth: BAND_MIN_PRINT_WIDTH,
  });
  if (!framed || (strict && !framed.clean)) return null;
  if (!framed.clean) ctx.subjectFaults.add(SUBJECT_CROPPED);
  commitFaults(ctx, stack);
  return finish(ctx, foot, [framed.element, ...copy]);
}

/* A photo band narrower than this share of the canvas is a thumbnail over
   the copy (round-8 live critic, storefront); the photo is then set beside
   the copy instead. A cut-out is contained, never narrowed, and is not
   held to it. */
const BAND_MIN_PRINT_WIDTH = 0.75;

/* The shares of the canvas the photo takes when it stands beside the
   copy, narrowest first. A wider panel is taken only when the narrower
   cannot show the subject whole at its least size with every head it
   touches: round-23 live cafe, a barista's head past the subject box left
   hero-center, split-left and banner-bottom without a clean placement, and
   the pair shipped as two cards. */
const BESIDE_SHARES = [0.46, 0.5, 0.54, 0.58];

/**
 * The photo on the left, the copy centred on the ground to its right: for
 * a subject that no full bleed or band shows whole and clear, a portrait
 * on 16:9 above all (round-8 live critic, fashion: the second direction
 * dropped the dress for a text card). Mirror of split-left, so a pair that
 * shows one photo in both still reads as two compositions (Oluwaseyi's
 * ruling, 2026-10-28). A print narrower than its half sits on the left
 * margin and the copy takes the room it frees. With `strict`, null unless
 * the subject is placed clean.
 */
async function beside(ctx: Context, strict: boolean): Promise<Built | null> {
  for (const share of strict ? BESIDE_SHARES : BESIDE_SHARES.slice(0, 1)) {
    const built = await besideAt(ctx, share, strict);
    if (built) return built;
  }
  return null;
}

async function besideAt(
  ctx: Context,
  share: number,
  strict: boolean,
): Promise<Built | null> {
  const { width, height, margin, palette } = ctx;
  const panel = px(width * share);
  const foot = await footer(ctx, {
    band: { x: panel + margin, width: width - panel - margin * 2 },
    align: "center",
    color: footerColorOn(ctx, palette.background),
  });
  const bar = foot && ctx.spec.footerStyle === "bar" ? foot : null;
  const region = rect(0, 0, panel, bar ? bar.top : height);
  const placed = framedImage(ctx, region, {
    inset: true,
    against: bar ? [rect(0, bar.top, width, height - bar.top)] : [],
  });
  if (!placed || (strict && !placed.clean)) return null;
  const framed = onMargin(ctx, placed, region, "left");
  const copyLeft =
    Math.min(panel, framed.element.x + framed.element.width) + margin;
  const zone = rect(
    copyLeft,
    margin,
    width - copyLeft - margin,
    copyBottom(ctx, foot) - margin,
  );
  const stack = await stackIn(ctx, zone, "center");
  commitFaults(ctx, stack);
  return finish(ctx, foot, [framed.element, ...(await placeStack(stack))]);
}

/* Over an image the copy anchors low or high and the subject keeps the rest
   of the frame, which is also where a veil can stay light. */
function copyIn(
  ctx: Context,
  zone: Rect,
  vAlign: "start" | "center" | "end",
): Promise<Stack> {
  return copyStack(ctx, {
    zone,
    align: "center",
    vAlign,
    colors: flatColors(ctx),
    rule: "above",
    ...(ctx.image && !isCutout(ctx) && vAlign !== "center"
      ? { headline: HERO_OVER_PHOTO }
      : {}),
  });
}

import type { DesignElement } from "../schema";
import { SUBJECT_COVERED, SUBJECT_CROPPED } from "../subject";
import {
  type Built,
  type Context,
  logoElement,
  px,
  type Rect,
  rect,
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
import {
  type Framed,
  framedImage,
  isCutout,
  minSubjectHeight,
  onMargin,
  subjectGap,
} from "./image";
import { HERO_OVER_PHOTO } from "./looks";
import { copyBlocks, gradedVeil, scrimElement } from "./scrim";
import {
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
 *  3. the subject in a band above the copy, the copy on the flat ground.
 * A cut-out only ever takes 3: it is a product on nothing, and the flat
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

/* The share of the canvas the photo takes when it stands beside the copy. */
const BESIDE_SHARE = 0.46;

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
  const { width, height, margin, palette } = ctx;
  const panel = px(width * BESIDE_SHARE);
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

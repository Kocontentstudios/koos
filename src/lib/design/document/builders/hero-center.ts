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
  subjectGap,
  veilFor,
} from "./image";
import { HERO_OVER_PHOTO } from "./looks";
import {
  CUTOUT_SHARES,
  copyBottom,
  flatColors,
  footerColorOn,
  recolorCopy,
  scrimFor,
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
 * veiled only as much as the pixels under it need (ground.ts).
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
  if (!ctx.subject) return fullBleed(ctx, foot, "end");

  for (const vAlign of ["end", "start"] as const) {
    const attempt = await fullBleed(ctx, foot, vAlign, true);
    if (attempt) return attempt;
  }
  const banded = await band(ctx, foot, true);
  if (banded) return banded;
  ctx.subjectFaults.add(SUBJECT_COVERED);
  return fullBleed(ctx, foot, "end");
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

/** The canvas the copy, its rule and the footer cover, which the veil is
 *  measured for. */
function copyRegion(ctx: Context, stack: Stack, foot: Footer | null): Rect {
  const zone = stack.zone;
  const top = stack.top - px(ctx.ref * 0.02);
  const footBottom = foot ? foot.textBox.y + foot.textBox.height : 0;
  const bottom = Math.max(stack.bottom + px(ctx.ref * 0.02), footBottom);
  return rect(zone.x, top, zone.width, bottom - top);
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
): Promise<Built | null>;
async function fullBleed(
  ctx: Context,
  foot: Footer | null,
  vAlign: "start" | "end",
): Promise<Built>;
async function fullBleed(
  ctx: Context,
  foot: Footer | null,
  vAlign: "start" | "end",
  strict = false,
): Promise<Built | null> {
  const { width, height, palette } = ctx;
  const stack = await stackIn(ctx, copyZone(ctx, foot), vAlign);
  const copy = await placeStack(stack);
  const region = copyRegion(ctx, stack, foot);
  const framed = framedImage(ctx, rect(0, 0, width, height), {
    keepOut: keepOutOf(copy, foot),
  });
  if (!framed || (strict && !framed.clean)) return null;
  commitFaults(ctx, stack);

  const elements: DesignElement[] = [framed.element];
  const veil = veilFor(ctx, framed.placement, region, palette.background);
  const subject = framed.subject;
  const scrim = scrimFor(
    rect(0, 0, width, height),
    vAlign === "end" ? stack.top : stack.bottom,
    veil,
    0,
    {
      from: vAlign === "end" ? "bottom" : "top",
      ...(subject
        ? {
            subjectEdge:
              vAlign === "end" ? subject.y + subject.height : subject.y,
          }
        : {}),
    },
  );
  if (scrim) elements.push(scrim);
  elements.push(...recolorCopy(copy, veil.text));
  if (foot) elements.push(...recolorFooter(foot, veil.text).elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: palette.background, elements };
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
  });
  if (!framed || (strict && !framed.clean)) return null;
  if (!framed.clean) ctx.subjectFaults.add(SUBJECT_CROPPED);
  commitFaults(ctx, stack);
  return finish(ctx, foot, [framed.element, ...copy]);
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

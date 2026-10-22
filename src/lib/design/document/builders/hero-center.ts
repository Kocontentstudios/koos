import type { DesignElement } from "../schema";
import {
  type Built,
  type Context,
  logoElement,
  px,
  type Rect,
  rect,
} from "./context";
import {
  bestStack,
  candidateStack,
  commitFaults,
  copyStack,
  placeStack,
  type Stack,
  zonesAvoidingLogo,
} from "./copy-stack";
import { footer, recolorFooter } from "./footer";
import { framedImage, isCutout, veilFor } from "./image";
import { HERO_OVER_PHOTO } from "./looks";
import {
  CUTOUT_SHARE,
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
 * A cut-out gets the space above the copy to itself when there is room for
 * it, so the subject is whole and the copy sits on the flat ground with no
 * veil at all. Otherwise the image fills the canvas and the copy is veiled
 * only as much as the pixels under it need (ground.ts).
 */

export async function heroCenter(ctx: Context): Promise<Built> {
  const { width, height, margin, palette, image } = ctx;
  const foot = await footer(ctx, {
    band: { x: margin, width: width - margin * 2 },
    align: "center",
    color: footerColorOn(ctx, palette.background),
  });
  const bottom = copyBottom(ctx, foot);
  const zone = rect(margin, margin, width - margin * 2, bottom - margin);
  const elements: DesignElement[] = [];

  if (isCutout(ctx)) {
    const below = rect(
      margin,
      height * CUTOUT_SHARE,
      width - margin * 2,
      bottom - height * CUTOUT_SHARE,
    );
    const stack = await candidateStack(
      zonesAvoidingLogo(ctx, below, true),
      (z) => copyIn(ctx, z, "center"),
    );
    if (stack.fits) {
      commitFaults(ctx, stack);
      const frame = rect(0, 0, width, stack.top - px(ctx.ref * 0.03));
      const framed = framedImage(ctx, frame, {
        top: margin,
        bottom: 0,
        sides: margin,
      });
      if (framed) elements.push(framed.element);
      elements.push(...(await placeStack(stack)));
      if (foot) elements.push(...foot.elements);
      const logo = logoElement(ctx);
      if (logo) elements.push(logo);
      return { background: palette.background, elements };
    }
  }

  const stack = await bestStack(ctx, zonesAvoidingLogo(ctx, zone, true), (z) =>
    copyIn(ctx, z, image ? "end" : "center"),
  );
  const copy = await placeStack(stack);
  if (image) {
    const framed = framedImage(ctx, rect(0, 0, width, height));
    const placement = framed?.placement ?? null;
    if (framed) elements.push(framed.element);
    const copyRegion = rect(
      zone.x,
      stack.top - px(ctx.ref * 0.02),
      zone.width,
      (foot ? foot.textBox.y + foot.textBox.height : stack.bottom) -
        stack.top +
        px(ctx.ref * 0.04),
    );
    const veil = veilFor(ctx, placement, copyRegion, palette.background);
    const scrim = scrimFor(rect(0, 0, width, height), stack.top, veil);
    if (scrim) elements.push(scrim);
    elements.push(...recolorCopy(copy, veil.text));
    if (foot) elements.push(...recolorFooter(foot, veil.text).elements);
  } else {
    elements.push(...copy);
    if (foot) elements.push(...foot.elements);
  }

  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: palette.background, elements };
}

/* Over an image the copy anchors low and the subject keeps the upper part
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
    ...(ctx.image ? { headline: HERO_OVER_PHOTO } : {}),
  });
}

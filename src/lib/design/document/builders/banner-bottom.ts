import { BANNER_BAND } from "@/lib/design/render/copy-fit";
import type { DesignElement } from "../schema";
import { SUBJECT_CROPPED } from "../subject";
import {
  type Built,
  type Context,
  logoElement,
  px,
  rect,
  shapeElement,
} from "./context";
import {
  candidateStack,
  commitFaults,
  copyStack,
  placeStack,
  stackQuality,
  zonesAvoidingLogo,
} from "./copy-stack";
import { footer } from "./footer";
import { framedImage, isCutout, minSubjectHeight, subjectGap } from "./image";
import { accentField, copyBottom, flatColors, footerColorOn } from "./shared";

/**
 * The image (or an accent panel) across the top, copy in a band along the
 * bottom. The band grows to fit its copy between the flex layout's own
 * limits (BANNER_BAND), and the image takes what is left.
 */

/* Past BANNER_BAND.max only when the copy would otherwise have to shrink
   below the type scale: at the schema's longest copy the flex band runs a
   few pixels short, and a slightly shorter image beats smaller type. */
const BANNER_OVERFLOW = 0.62;
/* The banner is a band across the top; a print narrower than this share
   of it reads as a thumbnail floating in the ground (round-8 live critic,
   storefront: a 450 px facade in a 1080 px band). A photo whose subject
   needs a narrower frame is reported cropped here and drawn in a layout
   it fills. */
const BANNER_MIN_PRINT_WIDTH = 0.75;
export async function bannerBottom(ctx: Context): Promise<Built> {
  const { width, height, margin, palette } = ctx;
  const foot = await footer(ctx, {
    band: { x: margin, width: width - margin * 2 },
    align: "left",
    color: footerColorOn(ctx, palette.background),
  });
  const bottom = copyBottom(ctx, foot);
  const stackIn = (share: number) => {
    const zone = rect(
      margin,
      height * (1 - share) + margin,
      width - margin * 2,
      bottom - (height * (1 - share) + margin),
    );
    return candidateStack(zonesAvoidingLogo(ctx, zone, false), (z) =>
      copyStack(ctx, {
        zone: z,
        align: "left",
        vAlign: "end",
        colors: flatColors(ctx),
        rule: "above",
      }),
    );
  };
  let maxBand = height * BANNER_BAND.max;
  let stack = await stackIn(BANNER_BAND.max);
  /* A taller band takes its height from the picture; with a subject to
     keep at its minimum size, the copy shrinks instead (a copy fault)
     before the subject would. */
  const subjectKeepsRoom =
    !ctx.image ||
    (!isCutout(ctx) && !ctx.subject) ||
    height * (1 - BANNER_OVERFLOW) - margin >=
      minSubjectHeight(ctx) + subjectGap(ctx);
  if (stack.faults.length > 0 && subjectKeepsRoom) {
    const roomier = await stackIn(BANNER_OVERFLOW);
    if (stackQuality(roomier) > stackQuality(stack)) {
      stack = roomier;
      maxBand = height * BANNER_OVERFLOW;
    }
  }
  commitFaults(ctx, stack);

  const bandTop = px(
    Math.min(
      height * (1 - BANNER_BAND.min),
      Math.max(height - maxBand, stack.top - margin),
    ),
  );
  /* The stack was anchored to the bottom of the largest band. When the band
     is held at its minimum share instead, the copy is centred in it so the
     space above and below the copy match. */
  const interiorTop = bandTop + margin;
  const centredTop =
    interiorTop + (bottom - interiorTop - (stack.bottom - stack.top)) / 2;
  const shift = px(Math.min(0, centredTop - stack.top));

  const top = rect(0, 0, width, bandTop);
  /* No inset at the bottom: the copy's own margin already separates the
     subject from the rule, and a second one left a gap that read as a
     missing element. */
  const framed = framedImage(ctx, top, {
    insets: { top: margin, bottom: 0, sides: margin },
    inset: true,
    align: "start",
    minInsetWidth: BANNER_MIN_PRINT_WIDTH,
  });
  if (framed && !framed.clean) ctx.subjectFaults.add(SUBJECT_CROPPED);
  const elements: DesignElement[] = [
    framed
      ? framed.element
      : shapeElement("accent-panel", "Colour panel", top, accentField(ctx)),
    ...(await placeStack(stack, shift)),
  ];
  if (foot) elements.push(...foot.elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: palette.background, elements };
}

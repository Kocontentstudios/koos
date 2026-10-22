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
  bestStack,
  copyStack,
  placeStack,
  zonesAvoidingLogo,
} from "./copy-stack";
import { footer } from "./footer";
import { framedImage } from "./image";
import { accentField, copyBottom, flatColors, footerColorOn } from "./shared";

/**
 * Copy in a 52% column on the left, the image (or an accent panel) on the
 * right. The footer stays in the copy column, on the flat background, where
 * it is legible; flex ran it across the photo in white.
 */
export async function splitLeft(ctx: Context): Promise<Built> {
  const { width, height, margin, palette } = ctx;
  const column = px(width * 0.52);
  const foot = await footer(ctx, {
    band: { x: margin, width: column - margin * 2 },
    align: "left",
    color: footerColorOn(ctx, palette.background),
  });
  const sideBottom = foot && ctx.spec.footerStyle === "bar" ? foot.top : height;
  const zone = rect(
    margin,
    margin,
    column - margin * 2,
    copyBottom(ctx, foot) - margin,
  );
  const stack = await bestStack(ctx, zonesAvoidingLogo(ctx, zone, false), (z) =>
    copyStack(ctx, {
      zone: z,
      align: "left",
      vAlign: "center",
      colors: flatColors(ctx),
      rule: "above",
    }),
  );

  const side = rect(column, 0, width - column, sideBottom);
  /* A half-width column is narrow for a cut-out: half the margin at its
     sides lets the subject reach its minimum size (subject.ts). */
  const inset = px(margin / 2);
  const framed = framedImage(ctx, side, {
    insets: { top: margin, bottom: margin, sides: inset },
    inset: true,
  });
  if (framed && !framed.clean) ctx.subjectFaults.add(SUBJECT_CROPPED);
  const elements: DesignElement[] = [
    framed
      ? framed.element
      : shapeElement("accent-panel", "Colour panel", side, accentField(ctx)),
    ...(await placeStack(stack)),
  ];
  if (foot) elements.push(...foot.elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: palette.background, elements };
}

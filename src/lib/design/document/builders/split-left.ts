import { mixToward } from "@/lib/design/palette";
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
import { framedImage, isCutout } from "./image";
import { accentField, copyBottom, flatColors, footerColorOn } from "./shared";

/**
 * Copy in a 52% column on the left, on the right the photograph, or a
 * cut-out on a tinted panel, or an accent panel alone. The footer stays in the copy column, on the flat background, where
 * it is legible; flex ran it across the photo in white.
 */
const CUTOUT_PANEL_TINT = 0.16;

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
  /* A cut-out sits on a colour panel: on the bare background a product
     the column's width left half the
     column empty above and below it, and read as a thumbnail lost on the
     page. A third of the margin at the column's sides lets it span the
     panel. */
  const cutout = isCutout(ctx);
  const framed = framedImage(ctx, side, {
    insets: {
      top: margin,
      bottom: margin,
      sides: px(margin / (cutout ? 3 : 2)),
    },
    inset: true,
  });
  if (framed && !framed.clean) ctx.subjectFaults.add(SUBJECT_CROPPED);
  /* Under a cut-out the panel is a light tint of the accent: a cut-out's
     soft shadow is a pale grey veil, which reads as a shadow on a light
     ground and as a ragged white smear on the saturated accent. */
  const panel = shapeElement(
    "accent-panel",
    "Colour panel",
    side,
    cutout
      ? mixToward(palette.background, palette.accent, CUTOUT_PANEL_TINT)
      : accentField(ctx),
  );
  const elements: DesignElement[] = [
    ...(!framed || cutout ? [panel] : []),
    ...(framed ? [framed.element] : []),
    ...(await placeStack(stack)),
  ];
  if (foot) elements.push(...foot.elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: palette.background, elements };
}

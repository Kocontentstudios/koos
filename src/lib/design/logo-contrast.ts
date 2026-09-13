import { ImageResponse } from "next/og";
import { logoBoxIn } from "@/lib/design/logo-placement";
import { relativeLuminance } from "@/lib/design/palette";
import { readImageDimensions } from "@/lib/design/png-dimensions";
import type { DesignSpec } from "@/lib/design/spec";
import {
  type DecodedPng,
  decodePngRgba,
  regionInk,
} from "@/lib/images/png-pixels";

/**
 * Whether a logo needs something behind it to be seen.
 *
 * The mark is a supplied file, so its colours are not ours to change — a navy
 * wordmark on a navy plate is drawn perfectly and is invisible, and every
 * check up to this point calls that a success. The only lever left is what
 * sits under it.
 */

/* Below 3:1 a mark stops reading as a distinct object. Deliberately looser
   than the 4.5:1 body-copy threshold in palette.ts: a logo is a large graphic,
   not small text, and WCAG grades large elements at 3:1. */
export const MIN_LOGO_CONTRAST = 3;

/** Reported when the mark is on the design but part of it cannot be read. */
export const LOGO_NOT_LEGIBLE =
  "its colours are too close to the design behind it for the whole mark to read, even with a panel added";

function ratio(a: number, b: number): number {
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The colour to put behind the logo, or null when the ground already works.
 *
 * Returns null for an unreadable luminance too: an unmeasured mark gets the
 * benefit of the doubt rather than an unrequested plate behind it.
 */
export interface MarkInk {
  /** Darkest ink in the mark, 5th percentile. */
  darkest: number;
  /** Lightest ink in the mark, 95th percentile. */
  lightest: number;
}

/**
 * The colour to put behind the logo, or null when the ground already works.
 *
 * Judged on the mark's darkest AND lightest ink, and BOTH have to read. A mean
 * is the wrong instrument — a mark with a dark glyph and light lettering
 * averages to a mid-tone neither half has, so it demands a plate for a mark
 * already sitting at 4:1 and then picks that plate for a tone nothing on it
 * matches. But "either extreme reads" is just as wrong in the other
 * direction: a navy mark with a small white knockout, on navy, passes on the
 * knockout alone and renders as a white speck where a logo should be. All of
 * the mark has to be visible, so the weaker half is what decides.
 *
 * The plate is then chosen to maximise that weaker half. A mid-tone can rescue
 * a mark that neither white nor black can: ink at 0.0 and 1.0 clears 3:1
 * against any ground between 0.1 and 0.3 and against nothing outside it.
 *
 * `ground` must be measured. There is deliberately no fallback to a flat
 * palette colour: on a photograph that colour is unrelated to what is under
 * the corner, and substituting it is guessing dressed as a measurement. An
 * unreadable ground means no backing.
 */

export interface BackingDecision {
  /** The colour to put behind the mark, or null when the ground already works
   *  or nothing would improve on it. */
  backing: string | null;
  /** False when even the best plate leaves part of the mark unreadable. Some
   *  marks cannot be rescued by any solid colour, and the user has to be told
   *  rather than handed a design with half a logo on it. */
  legible: boolean;
}

/**
 * The best solid ground for a mark, derived rather than guessed.
 *
 * Searching a handful of hardcoded swatches was a cliff: an ordinary
 * near-black-plus-orange mark peaked at 2.80 against the best of five and fell
 * off the end into "no plate at all". The optimum is computable. Contrast
 * against a ground rises as the ground moves away from the ink, so for ink
 * spanning [d, l] the best ground is either past one end — pure black or pure
 * white — or the point between them where both halves are equally served,
 * which is the geometric mean in WCAG's offset space.
 */
function bestGroundFor(ink: MarkInk): number {
  const between =
    Math.sqrt((ink.darkest + 0.05) * (ink.lightest + 0.05)) - 0.05;
  const options = [0, 1, Math.min(1, Math.max(0, between))];
  return options.reduce((best, candidate) =>
    weakestRatio(ink, { darkest: candidate, lightest: candidate }) >
    weakestRatio(ink, { darkest: best, lightest: best })
      ? candidate
      : best,
  );
}

/** The derived ground as a hex, rounded to a colour satori can paint. */
function toHex(luminance: number): string {
  /* Inverse of the sRGB transfer function, so the swatch really has the
     luminance the maths chose. */
  const channel =
    luminance <= 0.0031308
      ? luminance * 12.92
      : 1.055 * luminance ** (1 / 2.4) - 0.055;
  const byte = Math.max(0, Math.min(255, Math.round(channel * 255)));
  const hex = byte.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

export function logoBackingFor({
  ink,
  ground,
}: {
  ink: MarkInk;
  /** Measured luminance range of what the mark will sit on. NaN to leave it
   *  alone. A single number is accepted for a ground known to be flat. */
  ground: MarkInk | number;
}): BackingDecision {
  const under =
    typeof ground === "number" ? { darkest: ground, lightest: ground } : ground;

  /* An unmeasured mark or ground gets no plate and no complaint: we cannot
     tell whether it needs one, and inventing an answer is what the whole
     measurement architecture exists to avoid. */
  if (
    !Number.isFinite(under.darkest) ||
    !Number.isFinite(under.lightest) ||
    !Number.isFinite(ink.darkest) ||
    !Number.isFinite(ink.lightest)
  ) {
    return { backing: null, legible: true };
  }

  const asIs = weakestRatio(ink, under);
  if (asIs >= MIN_LOGO_CONTRAST) return { backing: null, legible: true };

  const chosen = bestGroundFor(ink);
  const improved = weakestRatio(ink, { darkest: chosen, lightest: chosen });

  /* Applied even when it falls short of the bar, because 2.8 is a great deal
     better than the 1.0 an unplated mark scores against its own colour — but
     the shortfall is reported rather than swallowed. Some marks cannot be made
     fully readable on any single colour, and a design carrying half a logo is
     the thing this ticket is about. */
  if (improved <= asIs) return { backing: null, legible: false };
  return { backing: toHex(chosen), legible: improved >= MIN_LOGO_CONTRAST };
}

/**
 * The worst pairing of any part of the mark against any part of the ground.
 *
 * Conservative on purpose: we know the mark's range and the ground's range but
 * not which sits over which, so the assumption has to be that the worst
 * pairing happens somewhere. Being wrong costs an unnecessary plate; the other
 * direction costs an invisible logo.
 */
export function weakestRatio(ink: MarkInk, ground: MarkInk): number {
  return Math.min(
    ratio(ink.darkest, ground.darkest),
    ratio(ink.darkest, ground.lightest),
    ratio(ink.lightest, ground.darkest),
    ratio(ink.lightest, ground.lightest),
  );
}

/**
 * How light the picture is exactly where the logo is about to land.
 *
 * The first attempt measured the flat palette colour and skipped any design
 * with a background plate — which is nearly all of them, since getPlateAdapter
 * falls back to whatever adapter is configured. So the contrast check only ran
 * when the plate model had FAILED, and a navy mark on a navy photograph was
 * caught nowhere. The picture is right there in memory; the honest thing is to
 * read it.
 *
 * Returns NaN when the image cannot be decoded or the corner is empty, and
 * every caller treats NaN as "leave it alone" rather than guessing.
 */
export async function groundLuminanceUnderLogo({
  image,
  placement,
  layout,
  aspect,
}: {
  image: { bytes: Uint8Array; contentType: string } | null;
  placement: DesignSpec["logoPlacement"];
  layout: DesignSpec["layout"];
  /** The mark's proportions, so the reading covers the mark and not the slot
   *  it sits in — most of which the mark never covers. */
  aspect?: number;
}): Promise<MarkInk> {
  const unreadable = { darkest: Number.NaN, lightest: Number.NaN };
  if (!image) return unreadable;

  /* The decoder reads PNG. A native model may answer with JPEG, and leaving
     that route with no contrast check at all meant a dark mark could be
     stamped invisible onto a dark composition on a whole delivery path. resvg
     reads JPEG even though we cannot, so the picture is re-rendered once into
     a PNG we can look at — the same trick the SVG path already uses. */
  const decoded =
    decodePngRgba(image.bytes) ?? (await decodeViaRenderer(image));
  if (!decoded) return unreadable;

  const box = logoBoxIn({
    placement,
    layout,
    width: decoded.width,
    height: decoded.height,
    aspect,
  });
  return box ? regionInk(decoded, box) : unreadable;
}

/** Re-renders an image we cannot decode into one we can, at its own size. */
async function decodeViaRenderer(image: {
  bytes: Uint8Array;
  contentType: string;
}): Promise<DecodedPng | null> {
  const size = readImageDimensions(image.bytes);
  if (!size) return null;
  try {
    const uri = `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
    const response = new ImageResponse(
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            width: `${size.width}px`,
            height: `${size.height}px`,
          },
          children: {
            type: "img",
            props: { src: uri, width: size.width, height: size.height },
          },
        },
      } as never,
      { width: size.width, height: size.height },
    );
    return decodePngRgba(new Uint8Array(await response.arrayBuffer()));
  } catch {
    // An unreadable ground means no backing, never a guessed one.
    return null;
  }
}

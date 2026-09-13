import { weakestRatio } from "@/lib/design/logo-contrast";
import { relativeLuminance } from "@/lib/design/palette";
import { readImageDimensions } from "@/lib/design/png-dimensions";
import { detectImageType, IMAGE_MIME } from "@/lib/images/detect";
import {
  cropRgba,
  decodePngRgba,
  encodePngRgba,
  inkBoxOf,
} from "@/lib/images/png-pixels";
import {
  rasterizeSvg,
  svgRasterBox,
  withViewBox,
} from "@/lib/images/rasterize";
import {
  getObjectBytes,
  STORAGE_PREFIXES,
  storageKeyFrom,
} from "@/lib/storage";
import { probeLogo } from "./logo-probe";

export interface LoadedLogo {
  bytes: Uint8Array;
  contentType: string;
  /** Darkest and lightest ink in the mark, from the probe render. Drives the
   *  contrast decision downstream. */
  darkest: number;
  lightest: number;
  /** Width divided by height of the mark itself, so the box drawn behind it
   *  can hug the mark rather than the slot it sits in. */
  aspect: number;
}

/** Why the brand's logo could not be used, phrased for the user. Null on a
 * normal load. A design that quietly drops the brand's mark looks finished, so
 * nothing about the result tells them (KOOS-BUG-022). */
export type LogoFault = string;

export interface LogoLoadResult {
  logo: LoadedLogo | null;
  fault: LogoFault | null;
}

/** The vector is drawn into a box this wide; the height follows its own
 * ratio. Well above the ~150px a logo occupies on the largest canvas, so the
 * raster never limits sharpness. */
const SVG_RASTER_WIDTH = 600;

const NOT_OURS =
  "the file is not in KO OS storage, so it may have been uploaded elsewhere";
const UNREADABLE = "the file could not be read from storage";
const UNKNOWN_FORMAT =
  "the file is not a PNG, JPEG or SVG that we can place on a design";
const VECTOR_FAILED = "the SVG could not be converted for the design renderer";
/** The composite renderer's own reason, declared here so it lands in the set
 *  below rather than missing it by a few words and sending the user the wrong
 *  remedy. */
export const LOGO_UNDECODABLE_IN_RENDER =
  "the design renderer could not decode the file";

/* Faults that are about the file the brand uploaded, as opposed to ours or
   the image model's. Only these justify telling someone to replace it. */
const NOT_DRAWABLE =
  "the design renderer could not decode it — the file may be damaged, or saved in a colour mode we cannot read";

/* Faults that are about the file the brand uploaded, as opposed to ours or
   the image model's. Only these justify telling someone to replace it. */
export const LOGO_FILE_FAULTS = [
  NOT_OURS,
  UNREADABLE,
  UNKNOWN_FORMAT,
  VECTOR_FAILED,
  NOT_DRAWABLE,
  LOGO_UNDECODABLE_IN_RENDER,
] as const;

/**
 * Loads the brand's logo as bytes the renderer can actually decode.
 *
 * Three things this does that the old inline loader did not:
 *
 *  - Reports WHY it failed. The old one caught everything and returned null,
 *    so a logo that never arrived was indistinguishable from a brand that had
 *    never uploaded one.
 *  - Labels the bytes with what they are. /api/upload accepts PNG, JPEG and
 *    SVG for logos; the old loader declared every one of them image/png, and
 *    satori cannot decode a JPEG or an SVG wearing a PNG mime.
 *  - Rasterises SVG onto a TRANSPARENT ground at its own aspect ratio. The
 *    vision path's opaque white square would paste a white card into the
 *    corner of the design and squash a wordmark into it.
 *
 * Storage-only by key, never an arbitrary fetch: logo_url is user-writable and
 * this runs server-side inside a job, so following whatever it contains would
 * let a brand aim the renderer at a link-local metadata endpoint and use the
 * reply as artwork. Every URL that legitimately reaches here was minted by
 * publicUrl.
 */
export async function loadBrandLogo(
  logoUrl: string | null | undefined,
): Promise<LogoLoadResult> {
  if (!logoUrl) return { logo: null, fault: null };

  const key = storageKeyFrom(logoUrl, STORAGE_PREFIXES.logos);
  if (!key) return { logo: null, fault: NOT_OURS };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await getObjectBytes(key));
  } catch (err) {
    console.error("brand logo could not be read from storage", err);
    return { logo: null, fault: UNREADABLE };
  }

  /* detectImageType also recognises GIF and WEBP, which are truthy and would
     otherwise fall through to the probe and come back as "the file may be
     damaged" — about a file that is fine and simply not a format we place. */
  const type = detectImageType(bytes);
  if (type !== "png" && type !== "jpeg" && type !== "svg") {
    return { logo: null, fault: UNKNOWN_FORMAT };
  }

  if (type === "svg") {
    try {
      const rastered = await rasterizeSvg(withViewBox(bytes), {
        background: "transparent",
        ...svgRasterBox(bytes, SVG_RASTER_WIDTH),
      });
      return confirmDrawable({
        bytes: rastered,
        contentType: IMAGE_MIME.png,
      });
    } catch (err) {
      console.error("brand logo SVG could not be rasterised", err);
      return { logo: null, fault: VECTOR_FAILED };
    }
  }

  return confirmDrawable({ bytes, contentType: IMAGE_MIME[type] });
}

/** Enough for a light/dark/mono set several times over. */
const MAX_LOGO_CANDIDATES = 8;

/* Below this the file is mostly empty space. */
const CROP_WHEN_INK_BELOW = 0.9;

/**
 * Trims a logo's transparent surround, at the file's own resolution.
 *
 * A logo is usually exported on an artboard, or with clear space baked in.
 * Fitting the FILE into the logo box then shrinks the mark by however much
 * padding it happens to carry — a 1000px artboard holding an 80px mark arrived
 * on the design twelve pixels wide.
 *
 * Done on the original bytes rather than on the probe's 512px render, which
 * would have thrown away every pixel of detail above that. JPEG is skipped
 * because it has no alpha channel, so it cannot carry transparent padding in
 * the first place.
 */
function cropToInk(logo: {
  bytes: Uint8Array;
  contentType: string;
}): Uint8Array | null {
  if (logo.contentType !== IMAGE_MIME.png) return null;
  try {
    return trim(logo.bytes);
  } catch (err) {
    /* Trimming is an improvement, never a requirement. An allocation failure
       here would otherwise escape loadBestLogo and fail the whole design. */
    console.error("brand logo could not be trimmed", err);
    return null;
  }
}

function trim(bytes: Uint8Array): Uint8Array | null {
  const decoded = decodePngRgba(bytes);
  if (!decoded) return null;
  const box = inkBoxOf(decoded);
  if (!box) return null;
  /* Either axis, not both. A wordmark that touches the left and right edges
     but carries vertical padding fills its width completely, and a max() test
     then leaves the padding on — which is the exact shape this exists to
     trim. */
  const fills = Math.min(
    box.width / decoded.width,
    box.height / decoded.height,
  );
  return fills < CROP_WHEN_INK_BELOW
    ? encodePngRgba(cropRgba(decoded, box))
    : null;
}

async function confirmDrawable(
  logo: Omit<LoadedLogo, "darkest" | "lightest" | "aspect">,
): Promise<LogoLoadResult> {
  /* Cropped BEFORE the probe, so the bytes that pass the check are the bytes
     the renderer draws. Probing the original and returning the crop left the
     one invariant this module exists to hold quietly unproven. */
  const trimmed = cropToInk(logo);
  const drawn = { ...logo, bytes: trimmed ?? logo.bytes };
  const { drawable, darkest, lightest, aspect } = await probeLogo(drawn);
  if (!drawable) return { logo: null, fault: NOT_DRAWABLE };

  /* The renderer fits the whole FILE into the logo box with object-fit:
     contain, so the aspect it needs is the file's. Those agree once the file
     has been trimmed to its ink — but cropToInk only reaches formats the
     decoder handles, and a 16-bit or interlaced PNG (an ordinary Photoshop
     export) keeps its padding. Reporting the INK aspect for one of those sized
     the box for a 3:1 mark and then contained a 1:1 file into it, drawing at
     under a third of the intended size. The header is readable even when the
     pixels are not. */
  const declared = trimmed ? null : readImageDimensions(drawn.bytes);
  return {
    logo: {
      ...drawn,
      darkest,
      lightest,
      aspect: declared ? declared.width / declared.height : aspect,
    },
    fault: null,
  };
}

/**
 * Picks the logo variant best suited to the ground it will sit on.
 *
 * A brand can hold more than one approved mark: `brands.logo_url` is the one
 * the profile shows, and `brand_assets` rows typed "logo" can hold others —
 * the light-on-dark and dark-on-light pair a designer normally supplies. Which
 * one belongs on a given design is a contrast question, and the probe already
 * measures exactly the number that answers it.
 *
 * Chosen by measurement rather than by filename hints: "logo-white.png" is a
 * convention, not a guarantee, and an inverted mark under a misleading name
 * would be picked confidently and be invisible.
 *
 * With a single candidate — which is every brand today, since nothing in the
 * product writes a second — this loads that one and the extra work is a single
 * comparison.
 */
export async function loadBestLogo({
  urls,
  background,
}: {
  urls: (string | null | undefined)[];
  /** Hex the mark will sit on, for the contrast comparison. */
  background: string;
}): Promise<LogoLoadResult> {
  /* De-duped by storage KEY, not URL string: the same object reaches this list
     through different spellings — a query string, a different percent-encoding
     — and each spelling would otherwise cost a second R2 read and a second
     probe render of identical bytes. */
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    const identity = storageKeyFrom(url, STORAGE_PREFIXES.logos) ?? url;
    if (seen.has(identity)) continue;
    seen.add(identity);
    candidates.push(url);
    /* Each candidate costs a fetch, a decode and a 512px render. A brand with
       a runaway asset list must not turn one design into fifty renders. */
    if (candidates.length >= MAX_LOGO_CANDIDATES) break;
  }
  if (candidates.length === 0) return { logo: null, fault: null };

  const loaded = await Promise.all(candidates.map((url) => loadBrandLogo(url)));
  const usable = loaded.filter(
    (result): result is { logo: LoadedLogo; fault: null } =>
      result.logo !== null,
  );

  if (usable.length === 0) {
    /* Every candidate failed. Report the first reason rather than a generic
       one: it names what is actually wrong with the file they uploaded. */
    return { logo: null, fault: loaded.find((r) => r.fault)?.fault ?? null };
  }

  const ground = relativeLuminance(background);
  const best = usable.reduce((winner, candidate) =>
    bestContrast(candidate.logo, ground) > bestContrast(winner.logo, ground)
      ? candidate
      : winner,
  );

  /* A candidate that failed while another worked is not worth a notification:
     the design gets a correct mark, and the brand has a usable logo. */
  return { logo: best.logo, fault: null };
}

/* The same metric the legibility decision uses. Ranking by the BEST-reading
   half picks the mark with a bright accent and a body that vanishes — the
   "white speck" case logoBackingFor exists to prevent — so the variant that
   wins has to be the one whose WORST half reads best. */
function bestContrast(logo: LoadedLogo, ground: number): number {
  if (!Number.isFinite(logo.darkest) || !Number.isFinite(logo.lightest)) {
    return 0;
  }
  return weakestRatio(
    { darkest: logo.darkest, lightest: logo.lightest },
    { darkest: ground, lightest: ground },
  );
}

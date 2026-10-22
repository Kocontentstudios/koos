import type { Canvas } from "@/lib/design/canvas";
import { logoBoxIn } from "@/lib/design/logo-placement";
import type { ResolvedPalette } from "@/lib/design/palette";
import type { DesignSpec } from "@/lib/design/spec";
import { bannerBottom } from "./builders/banner-bottom";
import {
  type Built,
  COPY_SHRUNK,
  COPY_TOO_LONG,
  COPY_WORD_BROKEN,
  type Context,
  type DocumentLogoInput,
  px,
  rect,
} from "./builders/context";
import type { ImageFacts } from "./builders/ground";
import { heroCenter } from "./builders/hero-center";
import { quoteCard } from "./builders/quote-card";
import { splitLeft } from "./builders/split-left";
import { statHighlight } from "./builders/stat-highlight";
import type { TextMeasurer } from "./fit";
import { type AssetRef, type DesignDocument, DOCUMENT_VERSION } from "./schema";

/**
 * Builds a layer document from a DesignSpec, one builder per flex layout
 * (builders/<layout>.ts).
 *
 * Each builder draws the same composition as render/layouts.tsx: the same
 * zones, the same 8% margin, the same logo corner from logoBoxIn, the same
 * headline ladder, banner band and footer band. Where the flex version had
 * a known weakness it is fixed here rather than copied:
 *
 *  - Copy over a photograph is veiled only as much as the measured pixels
 *    under it need (builders/ground.ts), and set dark when the photo is
 *    bright. The flex scrim reached 0.05-0.3 behind the headline and white
 *    type on a pale photo was unreadable; a fixed 0.6 scrim fixed that and
 *    turned every bright photo grey.
 *  - A cut-out subject is contained, never cropped (builders/cutout.ts).
 *  - The card layouts hold the image inside the card, clipped to its
 *    corners; flex laid the card over a full-bleed image and a cut-out's
 *    plate stuck out past the card's border (builders/card.ts).
 *  - The footer is lifted off the bottom edge and coloured for what is
 *    actually under it.
 *  - Every size comes from the measured layout (fit.ts), so the headline is
 *    as large as the room allows instead of a pessimistic estimate.
 *  - Split and banner compositions without an image fill the image zone
 *    with an accent field instead of leaving half the canvas bare.
 */

export { COPY_SHRUNK, COPY_TOO_LONG, COPY_WORD_BROKEN, type DocumentLogoInput };

export interface DocumentFromSpecInput {
  spec: DesignSpec;
  palette: ResolvedPalette;
  canvas: Canvas;
  image: AssetRef | null;
  /** measureImage(bytes) for `image`. Without it a photo is veiled for the
   *  worst case and a cut-out is cropped like a photo, as in round 1. */
  imageFacts?: ImageFacts | null;
  logo: DocumentLogoInput | null;
  measurer: TextMeasurer;
}

export interface DocumentBuild {
  document: DesignDocument;
  /** Set when the copy could not be set cleanly: it is below the layout's
   *  type scale, a word had to break, or it overflows even at the
   *  legibility floor. The most severe one. The design is still drawn; the
   *  user is told so they can shorten the copy. */
  copyFault: string | null;
}

const BUILDERS: Record<DesignSpec["layout"], (ctx: Context) => Promise<Built>> =
  {
    "hero-center": heroCenter,
    "split-left": splitLeft,
    "banner-bottom": bannerBottom,
    "quote-card": quoteCard,
    "stat-highlight": statHighlight,
  };

/* Most severe first: copy that overflows is worse than copy that breaks,
   which is worse than copy set small. */
const FAULT_ORDER = [COPY_TOO_LONG, COPY_WORD_BROKEN, COPY_SHRUNK];

export async function documentFromSpec({
  spec,
  palette,
  canvas,
  image,
  imageFacts = null,
  logo,
  measurer,
}: DocumentFromSpecInput): Promise<DocumentBuild> {
  const ref = Math.min(canvas.width, canvas.height);
  const box =
    logo && spec.logoPlacement !== "none"
      ? logoBoxIn({
          placement: spec.logoPlacement,
          layout: spec.layout,
          width: canvas.width,
          height: canvas.height,
          aspect: logo.aspect,
        })
      : null;

  const ctx: Context = {
    spec,
    palette,
    width: canvas.width,
    height: canvas.height,
    ref,
    /* Must match the flex layouts' pad and the logo inset, so the mark shares
       a margin with the type. */
    margin: px(ref * 0.08),
    image,
    imageFacts: image ? imageFacts : null,
    logo,
    logoBox: box ? rect(box.left, box.top, box.width, box.height) : null,
    measurer,
    faults: new Set(),
  };

  const built = await (BUILDERS[spec.layout] ?? heroCenter)(ctx);
  return {
    document: {
      version: DOCUMENT_VERSION,
      width: canvas.width,
      height: canvas.height,
      background: built.background,
      elements: built.elements,
    },
    copyFault: FAULT_ORDER.find((fault) => ctx.faults.has(fault)) ?? null,
  };
}

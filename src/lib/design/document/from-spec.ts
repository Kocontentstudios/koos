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
import { HEADLINE_OVER_FOOTER } from "./builders/looks";
import { quoteCard } from "./builders/quote-card";
import { splitLeft } from "./builders/split-left";
import { statHighlight } from "./builders/stat-highlight";
import type { TextMeasurer } from "./fit";
import {
  type AssetRef,
  type DesignDocument,
  type DesignElement,
  DOCUMENT_VERSION,
} from "./schema";
import {
  resolveSubject,
  SUBJECT_COVERED,
  SUBJECT_CROPPED,
  type SubjectBox,
} from "./subject";
import {
  DocumentTextFault,
  normalizeText,
  type TextFault,
  textFault,
} from "./text-safety";

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
   *  worst case and a cut-out is cropped like a photo. */
  imageFacts?: ImageFacts | null;
  logo: DocumentLogoInput | null;
  measurer: TextMeasurer;
  /** Where the subject is in the image, as shares of it (subject.ts). Every
   *  layout keeps copy and decoration off it and draws it whole and large.
   *  A cut-out's comes from its alpha channel when not given; a photograph
   *  without one is laid out as before, with nothing to keep clear. A box
   *  out of range or too small throws SubjectBoxFault. */
  subject?: SubjectBox | null;
}

export interface DocumentBuild {
  document: DesignDocument;
  /** Set when the copy could not be set cleanly: it is below the layout's
   *  type scale, a word had to break, or it overflows even at the
   *  legibility floor. The most severe one. The design is still drawn; the
   *  user is told so they can shorten the copy. */
  copyFault: string | null;
  /** Set when no arrangement of the layout keeps the copy off the subject
   *  (SUBJECT_COVERED) or shows it whole at its minimum size
   *  (SUBJECT_CROPPED). The design is still drawn. */
  subjectFault: string | null;
}

/** The copy fields a document draws, normalised (NFC). */
function normalizedCopy(spec: DesignSpec): DesignSpec {
  return {
    ...spec,
    headline: normalizeText(spec.headline),
    subheadline:
      spec.subheadline === undefined
        ? undefined
        : normalizeText(spec.subheadline),
    cta: spec.cta === undefined ? undefined : normalizeText(spec.cta),
    footerLines: (spec.footerLines ?? []).map(normalizeText),
  };
}

/**
 * Why the spec's copy cannot be drawn, and in which field, or null.
 *
 * For the job to call before building: the message is written for the user
 * (or for a correction prompt), and a spec that fails it never reaches the
 * renderer. documentFromSpec raises the same fault as DocumentTextFault for
 * a caller that skipped this.
 */
export function specTextFault(
  spec: DesignSpec,
): (TextFault & { field: string }) | null {
  const copy = normalizedCopy(spec);
  const fields: [string, string | undefined][] = [
    ["headline", copy.headline],
    ["subheadline", copy.subheadline],
    ["cta", copy.cta],
    ...copy.footerLines.map((line): [string, string] => ["footer", line]),
  ];
  for (const [field, text] of fields) {
    const fault = text ? textFault(text) : null;
    if (fault) return { ...fault, field };
  }
  return null;
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
  spec: rawSpec,
  palette,
  canvas,
  image,
  imageFacts = null,
  logo,
  measurer,
  subject = null,
}: DocumentFromSpecInput): Promise<DocumentBuild> {
  const refused = specTextFault(rawSpec);
  if (refused) throw new DocumentTextFault(refused, refused.field);
  const spec = normalizedCopy(rawSpec);
  const subjectBox = image ? resolveSubject(subject, imageFacts) : null;
  const input = { palette, canvas, image, imageFacts, logo, measurer };
  const first = await buildLeading(spec, subjectBox, input);
  /* The logo's corner is the one arrangement every layout shares. When the
     subject sits under it, the mirrored corner is tried before the fault
     stands. */
  const mirrored = MIRRORED_CORNER[spec.logoPlacement];
  if (!first.subjectFault || !logo || !mirrored) return first;
  const other = await buildLeading(
    { ...spec, logoPlacement: mirrored },
    subjectBox,
    input,
  );
  return other.subjectFault ? first : other;
}

/** Headline size over the largest footer size: how far the headline leads
 *  the small print. Infinite without a footer. */
function headlineLead(doc: DesignDocument): number {
  const sizeOf = (keep: (e: DesignElement) => boolean) =>
    Math.max(
      0,
      ...doc.elements.map((e) =>
        e.type === "text" && keep(e) ? e.fontSize : 0,
      ),
    );
  const footerSize = sizeOf((e) => e.type === "text" && e.role === "footer");
  return footerSize > 0
    ? sizeOf((e) => e.id === "headline") / footerSize
    : Number.POSITIVE_INFINITY;
}

/**
 * The build, and when its headline does not lead the footer by
 * HEADLINE_OVER_FOOTER, the build with the footer at its smallest size,
 * which hands the copy its room: the footer gives way before the headline.
 * Whichever leads by more.
 */
async function buildLeading(
  spec: DesignSpec,
  subject: SubjectBox | null,
  input: Omit<DocumentFromSpecInput, "spec" | "subject">,
): Promise<DocumentBuild> {
  const natural = await buildWith(spec, subject, input, false);
  if (headlineLead(natural.document) >= HEADLINE_OVER_FOOTER) return natural;
  const small = await buildWith(spec, subject, input, true);
  return headlineLead(small.document) > headlineLead(natural.document)
    ? small
    : natural;
}

const MIRRORED_CORNER: Partial<
  Record<DesignSpec["logoPlacement"], DesignSpec["logoPlacement"]>
> = {
  "top-left": "top-right",
  "top-right": "top-left",
  "bottom-left": "bottom-right",
  "bottom-right": "bottom-left",
};

async function buildWith(
  spec: DesignSpec,
  subject: SubjectBox | null,
  {
    palette,
    canvas,
    image,
    imageFacts,
    logo,
    measurer,
  }: Omit<DocumentFromSpecInput, "spec" | "subject">,
  smallFooter: boolean,
): Promise<DocumentBuild> {
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
    imageFacts: image ? (imageFacts ?? null) : null,
    subject,
    logo,
    logoBox: box ? rect(box.left, box.top, box.width, box.height) : null,
    measurer,
    smallFooter,
    faults: new Set(),
    subjectFaults: new Set(),
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
    subjectFault:
      [SUBJECT_COVERED, SUBJECT_CROPPED].find((fault) =>
        ctx.subjectFaults.has(fault),
      ) ?? null,
  };
}

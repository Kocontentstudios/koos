import type { ImageFacts } from "@/lib/design/document/builders/ground";
import { HEADLINE_OVER_FOOTER } from "@/lib/design/document/builders/looks";
import type {
  DesignDocument,
  DesignElement,
} from "@/lib/design/document/schema";

/**
 * Faults of craft a layout check can see on a built document, before a
 * pixel is drawn.
 *
 * Round 3 delivered a quote card whose headline had shrunk to 21 px under a
 * 28 px footer, with its button straddling the card's edge and the footer
 * bar (round-3 live critic, event-ko and the eval's conference-ko-1). The
 * subject rule passed it and nothing else looked. Hard faults are never
 * delivered: the next layout is tried, and a direction no layout draws
 * cleanly fails with the reason. A soft fault is delivered only when no
 * layout avoids it, and is recorded as a quality fault.
 */

export const HEADLINE_UNDER_COPY =
  "the headline is set smaller than other copy on the design";
export const COPY_COLLIDES = "two pieces of copy are drawn over each other";
export const COPY_STRADDLES_PANEL =
  "copy is drawn across the edge of a card or bar";
export const HEADLINE_NOT_LEADING =
  "the headline does not lead the footer by the type scale";
export const CUTOUT_EDGE_SHOWS =
  "the cut-out's light edge shows against a dark or coloured ground";

export const IMAGE_AGAINST_EDGE =
  "the picture is narrower than its card but flush against the card's edge";

export interface CraftFaults {
  hard: string | null;
  soft: string | null;
}

/* The shapes copy sits on. A line or button that is partly on one and
   partly off reads as a mistake. */
const PANELS = new Set(["card", "footer-bar", "accent-panel"]);

/* Measured boxes are whole pixels apart; a shared edge is not an overlap. */
const TOLERANCE = 2;

type Box = Pick<DesignElement, "x" | "y" | "width" | "height">;

function intersection(a: Box, b: Box): number {
  const w =
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) - TOLERANCE;
  const h =
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) - TOLERANCE;
  return w > 0 && h > 0 ? w * h : 0;
}

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - TOLERANCE &&
    inner.y >= outer.y - TOLERANCE &&
    inner.x + inner.width <= outer.x + outer.width + TOLERANCE &&
    inner.y + inner.height <= outer.y + outer.height + TOLERANCE
  );
}

function sizeOf(element: DesignElement): number {
  return element.type === "text" || element.type === "button"
    ? element.fontSize
    : 0;
}

function luminance([r, g, b]: number[]): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function hexColour(fill: string): number[] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(fill.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* The cut-out's outline as the eye sees it: opaque cells of the measured
   grid that touch a see-through one. A light backdrop's matting leaves a
   pale rim or cast shadow there. */
function cutoutEdgeLuminance(facts: ImageFacts): number | null {
  const { cols, rows, rgba } = facts.grid;
  const alpha = (c: number, r: number) =>
    c < 0 || r < 0 || c >= cols || r >= rows ? 0 : rgba[(r * cols + c) * 4 + 3];
  const edge: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (alpha(c, r) < 200) continue;
      const touches = [
        [c - 1, r],
        [c + 1, r],
        [c, r - 1],
        [c, r + 1],
      ].some(([x, y]) => alpha(x, y) < 40);
      if (!touches) continue;
      const at = (r * cols + c) * 4;
      edge.push(luminance([rgba[at], rgba[at + 1], rgba[at + 2]]));
    }
  }
  return edge.length > 0 ? edge.reduce((a, b) => a + b, 0) / edge.length : null;
}

/* What the image sits on: the last panel drawn before it that holds its
   centre, else the page. */
function groundUnder(
  doc: Pick<DesignDocument, "elements" | "background">,
  image: DesignElement,
): number[] | null {
  const cx = image.x + image.width / 2;
  const cy = image.y + image.height / 2;
  let fill = doc.background;
  for (const element of doc.elements) {
    if (element === image) break;
    if (
      element.type === "shape" &&
      !element.hidden &&
      cx >= element.x &&
      cx <= element.x + element.width &&
      cy >= element.y &&
      cy <= element.y + element.height
    ) {
      fill = element.fill;
    }
  }
  return hexColour(fill);
}

/**
 * The spec's palette turned so its ground is the light colour, when a
 * cut-out's pale rim would otherwise sit on a dark one. Every layout draws
 * the image on the palette's background or a card of it, so turning the
 * palette clears the fault in all of them; the brand's own two colours are
 * kept, only their roles swap. Unchanged when the rim is dark, the ground
 * already light, or the foreground no lighter.
 */
export function paletteForCutout<
  S extends { palette: { background: string; foreground: string } },
>(spec: S, facts: ImageFacts | null | undefined): S {
  if (!facts?.cutout) return spec;
  const rim = cutoutEdgeLuminance(facts);
  const ground = hexColour(spec.palette.background);
  const ink = hexColour(spec.palette.foreground);
  if (rim === null || rim <= 0.75 || !ground || !ink) return spec;
  if (luminance(ground) >= 0.3 || luminance(ink) <= luminance(ground)) {
    return spec;
  }
  return {
    ...spec,
    palette: {
      ...spec.palette,
      background: spec.palette.foreground,
      foreground: spec.palette.background,
    },
  };
}

/* How far from grey a ground may be before a pale rim reads as a white
   cut line on it: the peach panel behind round-5's mille-feuille is about
   0.17; a cream or warm-white page is under 0.08. */
const COLOURED_GROUND = 0.12;

function chroma([r, g, b]: number[]): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Whether a cut-out with a pale rim is drawn on a dark ground, where the
 *  rim reads as torn paper (round-3 live critic), or on a coloured one,
 *  where its matting shows as a hard white outline (round-5 live critic:
 *  the mille-feuille's shadow on the peach panel). */
export function cutoutEdgeShows(
  doc: Pick<DesignDocument, "elements" | "background">,
  facts: ImageFacts | null | undefined,
): boolean {
  if (!facts?.cutout) return false;
  const image = doc.elements.find((e) => e.type === "image" && !e.hidden);
  if (!image) return false;
  const rim = cutoutEdgeLuminance(facts);
  const ground = groundUnder(doc, image);
  if (rim === null || ground === null || rim <= 0.75) return false;
  return luminance(ground) < 0.3 || chroma(ground) >= COLOURED_GROUND;
}

/* Round-5 live critic: a print narrower than its card, jammed against the
   card's top edge, read as a mistake. */
function imageAgainstCardEdge(visible: readonly DesignElement[]): boolean {
  const image = visible.find((e) => e.type === "image");
  const card = visible.find(
    (e) => e.type === "shape" && (e.id === "card" || e.id === "card-edge"),
  );
  if (!image || !card || !inside(image, card)) return false;
  return (
    image.width < card.width - TOLERANCE && Math.abs(image.y - card.y) <= 1
  );
}

/** The craft faults of `doc`, worst first. */
export function layoutCraftFaults(
  doc: Pick<DesignDocument, "elements"> &
    Partial<Pick<DesignDocument, "background">>,
  imageFacts?: ImageFacts | null,
): CraftFaults {
  const visible = doc.elements.filter((e) => !e.hidden);
  const copy = visible.filter(
    (e) => (e.type === "text" && e.id !== "quote-mark") || e.type === "button",
  );
  const headline = copy.find((e) => e.type === "text" && e.role === "headline");
  let soft: string | null = null;
  if (headline) {
    const others = copy.filter((e) => e !== headline);
    if (others.some((e) => sizeOf(e) > sizeOf(headline))) {
      return { hard: HEADLINE_UNDER_COPY, soft: null };
    }
    const footer = Math.max(
      0,
      ...others
        .filter((e) => e.type === "text" && e.role === "footer")
        .map(sizeOf),
    );
    if (footer > 0 && sizeOf(headline) < footer * HEADLINE_OVER_FOOTER) {
      soft = HEADLINE_NOT_LEADING;
    }
  }
  for (const [i, a] of copy.entries()) {
    for (const b of copy.slice(i + 1)) {
      if (intersection(a, b) > 0) return { hard: COPY_COLLIDES, soft };
    }
  }
  const panels = visible.filter((e) => e.type === "shape" && PANELS.has(e.id));
  for (const element of copy) {
    for (const panel of panels) {
      if (intersection(element, panel) > 0 && !inside(element, panel)) {
        return { hard: COPY_STRADDLES_PANEL, soft };
      }
    }
  }
  if (!soft && imageAgainstCardEdge(visible)) soft = IMAGE_AGAINST_EDGE;
  if (
    !soft &&
    doc.background !== undefined &&
    cutoutEdgeShows(
      { elements: doc.elements, background: doc.background },
      imageFacts,
    )
  ) {
    soft = CUTOUT_EDGE_SHOWS;
  }
  return { hard: null, soft };
}

import { canvasFor } from "@/lib/design/canvas";
import { encodePngRgba } from "@/lib/images/png-pixels";
import {
  type DesignDocument,
  type DesignElement,
  DOCUMENT_LIMITS,
  MAX_CANVAS_EDGE,
  MAX_GRADIENT_STOPS,
  MAX_LABEL_LENGTH,
  MAX_TEXT_LENGTH,
} from "./schema";

/**
 * The costliest document the schema accepts, for the cost test and the
 * measurement script: every type at its cap, each element as large, rotated,
 * bordered, rounded and translucent as allowed, on the tallest canvas.
 *
 * Elements reach two canvases past the edge in every direction and are
 * rotated 45 degrees, so each covers the whole canvas and nothing is culled.
 * Text is the widest Latin (W) at the largest size and tracking, which is
 * the most glyph outline per character satori builds.
 */

const CANVAS = canvasFor("9:16");
const REACH = MAX_CANVAS_EDGE * 2;
const OFF = -(REACH - CANVAS.width) / 2;
/* The largest image the server accepts on either side. */
export const WORST_IMAGE_EDGE = 4096;

export const WORST_IMAGE_KEY = "design-images/b1/worst.png";
export const WORST_LOGO_KEY = "logos/b1/worst.png";

function base(id: string) {
  return {
    id,
    name: id,
    x: OFF,
    y: OFF,
    width: REACH,
    height: REACH,
    rotation: 45,
    opacity: 0.5,
    hidden: false,
    locked: false,
  };
}

const GRADIENT = `linear-gradient(33deg, ${Array.from(
  { length: MAX_GRADIENT_STOPS },
  (_, i) =>
    `${i % 2 ? "#FF0000" : "#0000FF"} ${Math.round((i / (MAX_GRADIENT_STOPS - 1)) * 100)}%`,
).join(", ")})`;

export function worstCaseDocument(): DesignDocument {
  const { byType, byRole, gradients } = DOCUMENT_LIMITS;
  const elements: DesignElement[] = [];
  for (let i = 0; i < byType.image; i += 1) {
    elements.push({
      ...base(`image-${i}`),
      type: "image",
      asset: { key: WORST_IMAGE_KEY },
      fit: "cover",
      crop: { zoom: 10, focusX: 0.5, focusY: 0.5 },
      radius: MAX_CANVAS_EDGE,
    });
  }
  for (let i = 0; i < byType.shape; i += 1) {
    elements.push({
      ...base(`shape-${i}`),
      type: "shape",
      fill: i < gradients ? GRADIENT : "#336699",
      borderColor: "#000000",
      borderWidth: MAX_CANVAS_EDGE,
      radius: MAX_CANVAS_EDGE,
    });
  }
  const roles = Object.entries(byRole).flatMap(([role, max]) =>
    Array.from({ length: max }, () => role),
  );
  roles.slice(0, byType.text).forEach((role, i) => {
    elements.push({
      ...base(`text-${i}`),
      type: "text",
      text: "W ".repeat(MAX_TEXT_LENGTH / 2),
      role: role as "body",
      font: "heading",
      fontSize: Math.round(MAX_CANVAS_EDGE / 3),
      fontWeight: 700,
      lineHeight: 0.5,
      letterSpacing: 2,
      align: "left",
      italic: true,
      color: "#000000",
    });
  });
  for (let i = 0; i < byType.button; i += 1) {
    elements.push({
      ...base(`button-${i}`),
      type: "button",
      label: "W ".repeat(MAX_LABEL_LENGTH / 2),
      fill: "#123456",
      color: "#FFFFFF",
      radius: MAX_CANVAS_EDGE,
      fontSize: Math.round(MAX_CANVAS_EDGE / 3),
      fontWeight: 700,
    });
  }
  for (let i = 0; i < byType.logo; i += 1) {
    elements.push({
      ...base(`logo-${i}`),
      type: "logo",
      asset: { key: WORST_LOGO_KEY },
      backing: "#FFFFFF",
    });
  }
  return {
    version: 1,
    width: CANVAS.width,
    height: CANVAS.height,
    background: "#FFFFFF",
    elements: elements.slice(0, DOCUMENT_LIMITS.elements),
  };
}

/** A smooth (compressible) PNG of `edge` square: the pixel count, not the
 *  entropy, is what resvg pays to decode and resample. */
export function largePng(edge = WORST_IMAGE_EDGE): Uint8Array {
  const pixels = new Uint8Array(edge * edge * 4);
  for (let y = 0; y < edge; y += 1) {
    for (let x = 0; x < edge; x += 1) {
      const at = (y * edge + x) * 4;
      pixels[at] = (x * 255) / edge;
      pixels[at + 1] = (y * 255) / edge;
      pixels[at + 2] = 128;
      pixels[at + 3] = 255;
    }
  }
  return encodePngRgba({ width: edge, height: edge, pixels });
}

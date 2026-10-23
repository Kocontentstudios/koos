import { canvasFor } from "@/lib/design/canvas";
import { encodePngRgba } from "@/lib/images/png-pixels";
import {
  type DesignDocument,
  type DesignElement,
  DOCUMENT_LIMITS,
  LETTER_SPACING_RANGE,
  LINE_HEIGHT_RANGE,
  MAX_CANVAS_EDGE,
  MAX_ELEMENT_REACH,
  MAX_FONT_SIZE,
  MAX_GRADIENT_STOPS,
  MAX_LABEL_LENGTH,
  MAX_TEXT_LENGTH,
} from "./schema";
import { MAX_EMOJI_PER_DOCUMENT, MAX_EMOJI_PER_TEXT } from "./text-safety";

/**
 * The costliest document the schema accepts, for the cost test and the
 * measurement script: every type at its cap, each element as large, rotated,
 * bordered, rounded and translucent as allowed, on the tallest canvas.
 *
 * Elements reach two canvases past the edge in every direction and are
 * rotated 45 degrees, so each covers the whole canvas and nothing is culled.
 * The copy budget is spent on the densest Han glyphs there are (up to 64
 * strokes, each a fallback-face outline satori builds), at the largest
 * size, packed with the tightest tracking and leading so the most of them
 * land on the canvas. Measured against the same budget in W, in emoji and
 * in Han at 300px, this is the slowest.
 */

const CANVAS = canvasFor("9:16");
const REACH = MAX_ELEMENT_REACH;
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

/* The 64 Han glyphs with the most outline data in Noto Sans JP, the face
   satori fetches for Han; a rarer character it lacks would draw as a cheap
   empty box instead. */
const DENSE_HAN = Array.from(
  "繼纞魕驋籧鸞斷蘩鐖鱲鏺鱻繸籛癴龞纔獼歠鼷麤鑾驫齺彌襼饑穖鬱蘙籘櫞鷞臠鸂燹鑠囓灣蠮嬭獵灤鱁蟣鱫縿鷀鸍襻鞿鑞灊鰺鰵纘麴變鬖驂櫲鷥黲鬣",
);

function denseCopy(length: number, offset: number): string {
  return Array.from(
    { length },
    (_, i) => DENSE_HAN[(offset + i) % DENSE_HAN.length],
  ).join("");
}

const GRADIENT = `linear-gradient(33deg, ${Array.from(
  { length: MAX_GRADIENT_STOPS },
  (_, i) =>
    `${i % 2 ? "#FF0000" : "#0000FF"} ${Math.round((i / (MAX_GRADIENT_STOPS - 1)) * 100)}%`,
).join(", ")})`;

export function worstCaseDocument(): DesignDocument {
  const { byType, byRole, gradients, textCodePoints } = DOCUMENT_LIMITS;
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
  const roles = Object.entries(byRole)
    .flatMap(([role, max]) => Array.from({ length: max }, () => role))
    .slice(0, byType.text);
  const labelLength = Math.min(
    MAX_LABEL_LENGTH,
    Math.floor(textCodePoints / (roles.length + byType.button)),
  );
  const textLength = Math.min(
    MAX_TEXT_LENGTH,
    Math.floor((textCodePoints - labelLength * byType.button) / roles.length),
  );
  roles.forEach((role, i) => {
    elements.push({
      ...base(`text-${i}`),
      type: "text",
      text: denseCopy(textLength, i * textLength),
      role: role as "body",
      font: "heading",
      fontSize: MAX_FONT_SIZE,
      fontWeight: 700,
      lineHeight: LINE_HEIGHT_RANGE.min,
      letterSpacing: LETTER_SPACING_RANGE.min,
      align: "left",
      italic: true,
      color: "#000000",
    });
  });
  for (let i = 0; i < byType.button; i += 1) {
    elements.push({
      ...base(`button-${i}`),
      type: "button",
      label: denseCopy(labelLength, i * labelLength + 7),
      fill: "#123456",
      color: "#FFFFFF",
      radius: MAX_CANVAS_EDGE,
      fontSize: MAX_FONT_SIZE,
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

/**
 * The caps `bench:document-cost` last timed the worst case under, and the
 * result. Wall-clock time depends on the machine and its load, so the gate
 * cannot assert it without going flaky; it asserts these caps instead, and
 * any change to them must re-run the bench and record the new figures here.
 */
export const BENCHED_CAPS = {
  limits: {
    elements: 18,
    byType: { image: 2, shape: 5, text: 8, button: 2, logo: 2 },
    byRole: { headline: 2, subheadline: 2, cta: 2, footer: 3, body: 3 },
    gradients: 2,
    textCodePoints: 600,
  },
  maxCanvasEdge: 1920,
  maxElementReach: 3840,
  maxFontSize: 640,
  lineHeightRange: { min: 0.5, max: 4 },
  letterSpacingRange: { min: -0.5, max: 2 },
  maxGradientStops: 5,
  maxTextLength: 400,
  maxLabelLength: 100,
  maxEmojiPerText: 24,
  maxEmojiPerDocument: 24,
  worstImageEdge: 4096,
  measured: {
    date: "2026-10-23",
    machine: "10-core WSL2 dev box, other builds running",
    aloneMs: 2449,
    pairMs: 2602,
  },
} as const;

export function currentCaps() {
  return {
    limits: DOCUMENT_LIMITS,
    maxCanvasEdge: MAX_CANVAS_EDGE,
    maxElementReach: MAX_ELEMENT_REACH,
    maxFontSize: MAX_FONT_SIZE,
    lineHeightRange: LINE_HEIGHT_RANGE,
    letterSpacingRange: LETTER_SPACING_RANGE,
    maxGradientStops: MAX_GRADIENT_STOPS,
    maxTextLength: MAX_TEXT_LENGTH,
    maxLabelLength: MAX_LABEL_LENGTH,
    maxEmojiPerText: MAX_EMOJI_PER_TEXT,
    maxEmojiPerDocument: MAX_EMOJI_PER_DOCUMENT,
    worstImageEdge: WORST_IMAGE_EDGE,
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

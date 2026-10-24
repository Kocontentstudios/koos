import { z } from "zod";
import { canvasFor } from "@/lib/design/canvas";
import { encodePngRgba } from "@/lib/images/png-pixels";
import { MAX_DOCUMENT_ASSET_EDGE } from "./rasterize";
import {
  type DesignDocument,
  type DesignElement,
  DOCUMENT_LIMITS,
  designDocumentSchema,
  MAX_GRADIENT_STOPS,
} from "./schema";
import { MAX_EMOJI_PER_DOCUMENT, MAX_EMOJI_PER_TEXT } from "./text-safety";

interface Bound {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

const BOUND_KEYS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
] as const;

/**
 * Every numeric and length bound the document schema enforces, read from
 * the schema itself, keyed by element type and field ("shape.borderWidth").
 * Pinning constants by name missed a bound the schema used directly (shape
 * border width took the worst case from 2.4 s to 7.2 s with every gate
 * green); reading what zod accepts cannot miss one.
 */
export function schemaBounds(): Record<string, Bound> {
  const json = z.toJSONSchema(designDocumentSchema, {
    unrepresentable: "any",
    io: "input",
  }) as Record<string, unknown>;
  const bounds: Record<string, Bound> = {};
  const visit = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, path);
      return;
    }
    const record = node as Record<string, unknown>;
    const bound: Bound = {};
    for (const key of BOUND_KEYS) {
      if (typeof record[key] === "number") bound[key] = record[key] as number;
    }
    if (Object.keys(bound).length > 0) bounds[path || "document"] = bound;
    const properties = record.properties as Record<string, unknown> | undefined;
    const type = (properties?.type as { const?: string } | undefined)?.const;
    for (const [key, child] of Object.entries(record)) {
      if (key === "properties" && child && typeof child === "object") {
        const scope = type ?? path;
        for (const [field, value] of Object.entries(child)) {
          visit(value, scope ? `${scope}.${field}` : field);
        }
      } else if (key !== "properties") {
        visit(child, path);
      }
    }
  };
  visit(json, "");
  return Object.fromEntries(
    Object.entries(bounds).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function extreme(path: string, key: "minimum" | "maximum"): number {
  const value = schemaBounds()[path]?.[key];
  if (value === undefined) throw new Error(`schema has no ${key} for ${path}`);
  return value;
}

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
export const WORST_IMAGE_EDGE = MAX_DOCUMENT_ASSET_EDGE;

export const WORST_IMAGE_KEY = "design-images/b1/worst.png";
export const WORST_LOGO_KEY = "logos/b1/worst.png";

function base(id: string, type: DesignElement["type"]) {
  const reach = extreme(`${type}.width`, "maximum");
  const off = -(reach - CANVAS.width) / 2;
  return {
    id,
    name: id,
    x: off,
    y: off,
    width: reach,
    height: extreme(`${type}.height`, "maximum"),
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
      ...base(`image-${i}`, "image"),
      type: "image",
      asset: { key: WORST_IMAGE_KEY },
      fit: "cover",
      crop: {
        zoom: extreme("image.crop.zoom", "maximum"),
        focusX: 0.5,
        focusY: 0.5,
      },
      radius: extreme("image.radius", "maximum"),
    });
  }
  for (let i = 0; i < byType.shape; i += 1) {
    elements.push({
      ...base(`shape-${i}`, "shape"),
      type: "shape",
      fill: i < gradients ? GRADIENT : "#336699",
      borderColor: "#000000",
      borderWidth: extreme("shape.borderWidth", "maximum"),
      radius: extreme("shape.radius", "maximum"),
    });
  }
  const roles = Object.entries(byRole)
    .flatMap(([role, max]) => Array.from({ length: max }, () => role))
    .slice(0, byType.text);
  const labelLength = Math.min(
    schemaBounds()["button.label"]?.maxLength ?? 0,
    Math.floor(textCodePoints / (roles.length + byType.button)),
  );
  const textLength = Math.min(
    schemaBounds()["text.text"]?.maxLength ?? 0,
    Math.floor((textCodePoints - labelLength * byType.button) / roles.length),
  );
  roles.forEach((role, i) => {
    elements.push({
      ...base(`text-${i}`, "text"),
      type: "text",
      text: denseCopy(textLength, i * textLength),
      role: role as "body",
      font: "heading",
      fontSize: extreme("text.fontSize", "maximum"),
      fontWeight: 700,
      lineHeight: extreme("text.lineHeight", "minimum"),
      letterSpacing: extreme("text.letterSpacing", "minimum"),
      align: "left",
      italic: true,
      color: "#000000",
    });
  });
  for (let i = 0; i < byType.button; i += 1) {
    elements.push({
      ...base(`button-${i}`, "button"),
      type: "button",
      label: denseCopy(labelLength, i * labelLength + 7),
      fill: "#123456",
      color: "#FFFFFF",
      radius: extreme("button.radius", "maximum"),
      fontSize: extreme("button.fontSize", "maximum"),
      fontWeight: 700,
    });
  }
  for (let i = 0; i < byType.logo; i += 1) {
    elements.push({
      ...base(`logo-${i}`, "logo"),
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
 * Everything that bounds what a document can cost to draw: every bound the
 * schema enforces, the counts and copy budget its refinements check, the
 * emoji caps, and the largest asset rasterizeDocument accepts. The gate
 * compares this with what `bench:document-cost --record` last timed
 * (cost-bench.json), because wall-clock time cannot be asserted in a gate
 * without going flaky.
 */
export function currentCaps() {
  return {
    schema: schemaBounds(),
    limits: DOCUMENT_LIMITS,
    maxGradientStops: MAX_GRADIENT_STOPS,
    maxEmojiPerText: MAX_EMOJI_PER_TEXT,
    maxEmojiPerDocument: MAX_EMOJI_PER_DOCUMENT,
    maxAssetEdge: MAX_DOCUMENT_ASSET_EDGE,
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

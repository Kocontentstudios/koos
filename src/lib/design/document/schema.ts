import { z } from "zod";
import { SUPPORTED_ASPECT_RATIOS } from "@/lib/ai/image/types";
import { canvasFor } from "@/lib/design/canvas";
import {
  isCanonicalKey,
  keyUnderPrefix,
  STORAGE_PREFIXES,
} from "@/lib/storage-keys";

/**
 * The layer document: a design as an absolutely positioned list of elements.
 *
 * Generation builds one from a DesignSpec (from-spec.ts), the editor mutates
 * it, and one renderer (render.tsx) draws it as PNG on the server and as DOM
 * in the browser. Everything here is plain JSON so a document can live in a
 * jsonb column and round-trip through the client untouched.
 */

export const DOCUMENT_VERSION = 1;

/** The only places a document may point the renderer at. Logos are the brand's
 *  own marks, generated holds stored background plates, design-images holds
 *  the user's uploads. Anything else (deliverables, fonts, another tenant's
 *  objects) is refused at the schema, so no edit can smuggle it in. */
export const DOCUMENT_ASSET_PREFIXES = [
  STORAGE_PREFIXES.logos,
  STORAGE_PREFIXES.generated,
  STORAGE_PREFIXES.designImages,
] as const;

/* The canvas is one of the sizes the app renders, never a free number. Cost
   is quadratic in the edge: a 10000px square took 54s and 1.9GB to rasterize,
   so a size a user can type is a size an attacker can type. */
const CANVASES = SUPPORTED_ASPECT_RATIOS.map(canvasFor);

export function isDocumentCanvas(size: {
  width: number;
  height: number;
}): boolean {
  return CANVASES.some(
    (canvas) => canvas.width === size.width && canvas.height === size.height,
  );
}

/** The longest edge any canvas has. An element may hang off the canvas (a
 *  zoomed photo, a bleed) but never by more than a canvas in any direction,
 *  so no field can carry a 1e308 into yoga. */
export const MAX_CANVAS_EDGE = Math.max(
  ...CANVASES.flatMap((canvas) => [canvas.width, canvas.height]),
);
const REACH = MAX_CANVAS_EDGE * 2;

const coordinate = z.number().min(-REACH).max(REACH);
const size = z.number().positive().max(REACH);
const length = z.number().min(0).max(MAX_CANVAS_EDGE);
/* Type taller than a third of the longest canvas is a layout bug, and every
   extra pixel of size is glyph outline satori has to build. */
const fontSize = z
  .number()
  .positive()
  .max(Math.round(MAX_CANVAS_EDGE / 3));

export const assetRefSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(512)
      .refine(isCanonicalKey, "Assets are storage keys, not URLs")
      .refine(
        (key) => keyUnderPrefix(key, DOCUMENT_ASSET_PREFIXES) !== null,
        "Asset key is outside the allowed storage prefixes",
      ),
  })
  .strict();

/* Colours are written into inline styles in two renderers, so they are a
   closed grammar rather than any string: a `url(...)` here would make the
   browser editor fetch from an arbitrary host. Hex, rgb()/rgba() and
   `transparent` cover everything the builders and the palette emit. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

export function isDocumentColor(value: string): boolean {
  return value === "transparent" || HEX.test(value) || RGB.test(value);
}

/* A gradient is checked stop by stop rather than with one regex over the
   whole string, so a stop list cannot carry anything but colours and
   percentages. */
const ANGLE = /^-?\d{1,3}(?:\.\d+)?deg$/;
const STOP_POSITION = /^\d{1,3}(?:\.\d+)?%$/;

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return [];
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (depth !== 0) return [];
  parts.push(current.trim());
  return parts;
}

export function isDocumentGradient(value: string): boolean {
  const match = /^linear-gradient\((.*)\)$/i.exec(value.trim());
  if (!match) return false;
  const parts = splitTopLevel(match[1]);
  if (parts.length < 3) return false;
  const [angle, ...stops] = parts;
  if (!ANGLE.test(angle)) return false;
  return stops.every((stop) => {
    const lastSpace = stop.lastIndexOf(" ");
    const hasPosition =
      lastSpace > 0 && STOP_POSITION.test(stop.slice(lastSpace + 1));
    const color = hasPosition ? stop.slice(0, lastSpace).trim() : stop;
    return isDocumentColor(color);
  });
}

const color = z
  .string()
  .max(64)
  .refine(isDocumentColor, "Not a supported colour");
const fill = z
  .string()
  .max(512)
  .refine(
    (value) => isDocumentColor(value) || isDocumentGradient(value),
    "Not a supported colour or linear-gradient",
  );

const baseElement = {
  id: z.string().min(1).max(64),
  name: z.string().max(80),
  x: coordinate,
  y: coordinate,
  width: size,
  height: size,
  rotation: z.number().min(-360).max(360),
  opacity: z.number().min(0).max(1),
  hidden: z.boolean(),
  locked: z.boolean(),
};

export const imageElementSchema = z
  .object({
    ...baseElement,
    type: z.literal("image"),
    asset: assetRefSchema,
    fit: z.enum(["cover", "contain"]),
    crop: z
      .object({
        zoom: z.number().min(1).max(10),
        focusX: z.number().min(0).max(1),
        focusY: z.number().min(0).max(1),
      })
      .strict(),
    radius: length,
  })
  .strict();

export const shapeElementSchema = z
  .object({
    ...baseElement,
    type: z.literal("shape"),
    fill,
    borderColor: color,
    borderWidth: length,
    radius: length,
  })
  .strict();

export const TEXT_ROLES = [
  "headline",
  "subheadline",
  "cta",
  "footer",
  "body",
] as const;

const fontWeight = z.union([
  z.literal(100),
  z.literal(200),
  z.literal(300),
  z.literal(400),
  z.literal(500),
  z.literal(600),
  z.literal(700),
  z.literal(800),
  z.literal(900),
]);

export const textElementSchema = z
  .object({
    ...baseElement,
    type: z.literal("text"),
    text: z.string().max(2000),
    role: z.enum(TEXT_ROLES),
    font: z.enum(["heading", "body"]),
    fontSize,
    fontWeight,
    /** Unitless multiple of fontSize, as in CSS. */
    lineHeight: z.number().min(0.5).max(4),
    /** In em, so it scales with the type like a designer's tracking value. */
    letterSpacing: z.number().min(-0.5).max(2),
    align: z.enum(["left", "center", "right"]),
    italic: z.boolean(),
    color,
  })
  .strict();

export const buttonElementSchema = z
  .object({
    ...baseElement,
    type: z.literal("button"),
    label: z.string().max(200),
    fill,
    color,
    radius: length,
    fontSize,
    fontWeight,
  })
  .strict();

export const logoElementSchema = z
  .object({
    ...baseElement,
    type: z.literal("logo"),
    asset: assetRefSchema,
    /** A plate behind the mark when the ground would swallow it. Chosen by the
     *  rasterizer from the finished picture, never by the builder. */
    backing: color.nullable(),
  })
  .strict();

export const designElementSchema = z.discriminatedUnion("type", [
  imageElementSchema,
  shapeElementSchema,
  textElementSchema,
  buttonElementSchema,
  logoElementSchema,
]);

export const designDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    width: z.number(),
    height: z.number(),
    background: color,
    /** Array order is z-order: the first element is drawn at the bottom. */
    elements: z
      .array(designElementSchema)
      .max(200)
      .refine(
        (elements) =>
          new Set(elements.map((e) => e.id)).size === elements.length,
        "Element ids must be unique",
      ),
  })
  .strict()
  .refine(isDocumentCanvas, {
    message: "Canvas must be one of the supported sizes",
    path: ["width"],
  });

export type AssetRef = z.infer<typeof assetRefSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type ButtonElement = z.infer<typeof buttonElementSchema>;
export type LogoElement = z.infer<typeof logoElementSchema>;
export type DesignElement = z.infer<typeof designElementSchema>;
export type DesignDocument = z.infer<typeof designDocumentSchema>;
export type TextRole = (typeof TEXT_ROLES)[number];

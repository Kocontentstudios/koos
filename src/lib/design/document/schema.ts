import { z } from "zod";
import { SUPPORTED_ASPECT_RATIOS } from "@/lib/ai/image/types";
import { canvasFor } from "@/lib/design/canvas";
import {
  isCanonicalKey,
  keyUnderPrefix,
  STORAGE_PREFIXES,
} from "@/lib/storage-keys";
import { documentEmojiFault, normalizeText, textFault } from "./text-safety";

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
export const MAX_ELEMENT_REACH = MAX_CANVAS_EDGE * 2;
/* Type taller than a third of the longest canvas is a layout bug, and every
   extra pixel of size is glyph outline satori has to build. */
export const MAX_FONT_SIZE = Math.round(MAX_CANVAS_EDGE / 3);
/** Unitless multiples of fontSize, as in CSS. Tighter leading and tracking
 *  pack more glyphs onto the canvas, so the low ends are cost bounds too. */
export const LINE_HEIGHT_RANGE = { min: 0.5, max: 4 } as const;
export const LETTER_SPACING_RANGE = { min: -0.5, max: 2 } as const;

const coordinate = z.number().min(-MAX_ELEMENT_REACH).max(MAX_ELEMENT_REACH);
const size = z.number().positive().max(MAX_ELEMENT_REACH);
const length = z.number().min(0).max(MAX_CANVAS_EDGE);
const fontSize = z.number().positive().max(MAX_FONT_SIZE);

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
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

/* A channel past 255 is refused, not clamped: the browser and satori clamp
   it the same way today, but a value that means nothing is a bug upstream
   that should surface where it was written. */
function isRgb(value: string): boolean {
  const channels = RGB.exec(value);
  return Boolean(
    channels?.slice(1, 4).every((channel) => Number(channel) <= 255),
  );
}

export function isDocumentColor(value: string): boolean {
  return value === "transparent" || HEX.test(value) || isRgb(value);
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

/** The builders use three; every stop is another band resvg rasterises. */
export const MAX_GRADIENT_STOPS = 5;

/* Exact spelling only: satori draws " linear-gradient(...)" or an upper-case
   one as solid black while a browser draws the gradient, so the editor and
   the PNG would disagree, and the gradient cap would not count it. */
export function isDocumentGradient(value: string): boolean {
  const match = /^linear-gradient\((.*)\)$/.exec(value);
  if (!match) return false;
  const parts = splitTopLevel(match[1]);
  if (parts.length < 3) return false;
  const [angle, ...stops] = parts;
  if (!ANGLE.test(angle)) return false;
  if (stops.length > MAX_GRADIENT_STOPS) return false;
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

/** Longest text run and button label. Spec copy is at most 140 characters;
 *  the rest is room for body text typed in the editor. */
export const MAX_TEXT_LENGTH = 400;
export const MAX_LABEL_LENGTH = 100;

/* Copy is normalised once, here, and refused when the renderer cannot draw
   it correctly or could loop on it (text-safety.ts). */
function documentText(max: number) {
  return z
    .string()
    .max(max)
    .transform(normalizeText)
    .superRefine((text, issues) => {
      const fault = textFault(text);
      if (fault) {
        issues.addIssue({
          code: "custom",
          message: fault.message,
          params: { code: fault.code },
        });
      }
    });
}

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
    text: documentText(MAX_TEXT_LENGTH),
    role: z.enum(TEXT_ROLES),
    font: z.enum(["heading", "body"]),
    fontSize,
    fontWeight,
    /** Unitless multiple of fontSize, as in CSS. */
    lineHeight: z
      .number()
      .min(LINE_HEIGHT_RANGE.min)
      .max(LINE_HEIGHT_RANGE.max),
    /** In em, so it scales with the type like a designer's tracking value. */
    letterSpacing: z
      .number()
      .min(LETTER_SPACING_RANGE.min)
      .max(LETTER_SPACING_RANGE.max),
    align: z.enum(["left", "center", "right"]),
    italic: z.boolean(),
    color,
  })
  .strict();

export const buttonElementSchema = z
  .object({
    ...baseElement,
    type: z.literal("button"),
    label: documentText(MAX_LABEL_LENGTH),
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

/**
 * What one document may hold, by type, by text role and in all.
 *
 * Bounding each field did not bound the render: 200 schema-valid shapes,
 * each a canvas-sized rotated gradient, took 59.5s, and twelve runs of 600
 * dense Han glyphs at 300px took 12.1s. Cost is the sum over elements, and
 * for text about 1.2ms per glyph on top of everything else, so the count is
 * capped per type, gradients (the costliest fill) on their own, and the
 * copy of the whole document by code points. The builders use at most 5
 * shapes, 6 text runs, 1 button, 1 image, 1 logo, 1 gradient and about 420
 * code points; the room above that is for the editor. The worst document
 * these caps allow (testing-cost.ts) draws in 2.1-2.5s alone and 2.2-2.8s
 * beside another on the render pool; `bench:document-cost` holds it under
 * 3s. cost-bounds.test.ts refuses one step past every bound and cap, with
 * the overflow on every element that can carry it and in every text look;
 * it tests the shapes it builds, so a change to limitIssues or text-safety
 * is a review item. cost.smoke.test.ts fails if a declared bound moves and
 * cost-bench.json is not re-recorded; a hand edit that also recomputes its
 * digest passes, so a change to that file is a review item too.
 * A process's first render also pays the handshakes for
 * the fallback faces and emoji next/og fetches, about 2s more whatever the
 * emoji count, which the render limit (satori-pool.ts) bounds.
 */
export const DOCUMENT_LIMITS = {
  elements: 18,
  byType: { image: 2, shape: 5, text: 8, button: 2, logo: 2 },
  byRole: { headline: 2, subheadline: 2, cta: 2, footer: 3, body: 3 },
  gradients: 2,
  textCodePoints: 600,
} as const;

function copyOf(elements: { type: string; text?: string; label?: string }[]) {
  return elements.flatMap((e) =>
    e.type === "text" && e.text !== undefined
      ? [e.text]
      : e.type === "button" && e.label !== undefined
        ? [e.label]
        : [],
  );
}

function limitIssues(
  elements: {
    type: string;
    role?: string;
    fill?: string;
    text?: string;
    label?: string;
  }[],
): string | null {
  const count = (keep: (e: (typeof elements)[number]) => boolean) =>
    elements.filter(keep).length;
  for (const [type, max] of Object.entries(DOCUMENT_LIMITS.byType)) {
    if (count((e) => e.type === type) > max) {
      return `A design holds at most ${max} ${type} elements`;
    }
  }
  for (const [role, max] of Object.entries(DOCUMENT_LIMITS.byRole)) {
    if (count((e) => e.type === "text" && e.role === role) > max) {
      return `A design holds at most ${max} ${role} text elements`;
    }
  }
  if (
    count((e) => e.fill !== undefined && isDocumentGradient(e.fill)) >
    DOCUMENT_LIMITS.gradients
  ) {
    return `A design holds at most ${DOCUMENT_LIMITS.gradients} gradient fills`;
  }
  const copy = copyOf(elements);
  const codePoints = copy.reduce(
    (sum, text) => sum + Array.from(text).length,
    0,
  );
  if (codePoints > DOCUMENT_LIMITS.textCodePoints) {
    return `A design holds at most ${DOCUMENT_LIMITS.textCodePoints} characters of copy`;
  }
  return documentEmojiFault(copy)?.message ?? null;
}

export const designDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    width: z.number(),
    height: z.number(),
    background: color,
    /** Array order is z-order: the first element is drawn at the bottom. */
    elements: z
      .array(designElementSchema)
      .max(DOCUMENT_LIMITS.elements)
      .refine(
        (elements) =>
          new Set(elements.map((e) => e.id)).size === elements.length,
        "Element ids must be unique",
      )
      .superRefine((elements, issues) => {
        const message = limitIssues(elements);
        if (message) issues.addIssue({ code: "custom", message });
      }),
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

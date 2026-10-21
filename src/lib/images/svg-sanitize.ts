import { SaxesParser, type SaxesTagNS } from "saxes";
import { detectImageType, IMAGE_MIME } from "./detect";
import {
  ImageOverBudgetError,
  RENDERER_IMAGE_BYTE_BUDGET,
  reencodeImage,
} from "./reencode";

/**
 * Rebuilds an uploaded SVG from what a strict XML parser read, keeping only
 * what draws from inside the file, so librsvg never decodes a raster or
 * follows a reference we did not vet.
 *
 * An SVG logo is drawn by next/og, so by librsvg (sharp) or resvg-wasm. Both
 * decode an embedded data:image/png with the Rust PNG decoder whose panic on a
 * bad palette aborts the whole Node process, so one logo could kill every
 * design job for its brand (FEAT-033 round-3 critic, B8). Both also follow
 * references: librsvg loads hrefs, XInclude, url() in CSS and, through
 * libxml2, external entities.
 *
 * So the rules, each a refusal rather than a repair:
 *  - The file parses as well-formed XML (saxes) with an <svg> root.
 *  - No DOCTYPE at all. A logo never needs one, and entities are how a
 *    string check is walked around.
 *  - Every href, in any namespace and on any element, is a "#fragment" in
 *    this document, except data:image/png or data:image/jpeg on <image>, which
 *    is decoded and re-encoded through reencodeImage and written back. That
 *    excludes nested SVG data URIs, feImage sources and external files.
 *  - No XInclude element, and no animation that retargets an href.
 *  - Every url() in an attribute or a <style> block names a "#fragment", and
 *    no @import. A CSS escape can spell url( or @import in a way no pattern
 *    sees, so a <style> block may hold no backslash at all, and an attribute
 *    none beside a "(" (an attribute cannot hold an @import).
 *
 * The output is serialised from the parse events (comments, processing
 * instructions and the XML declaration are dropped), so the renderer parses
 * exactly the document that was checked rather than the original text.
 */

declare const SANITISED: unique symbol;

/** SVG bytes that came out of sanitizeSvg. Only that function makes one. */
export type SafeSvg = { readonly bytes: Uint8Array } & {
  readonly [SANITISED]: true;
};

export type UnsafeSvgReason =
  | "not_svg"
  | "too_large"
  | "doctype"
  | "external_reference"
  | "embedded_image"
  | "too_complex";

const USER_REASONS: Record<UnsafeSvgReason, string> = {
  not_svg: "it is not a well-formed SVG file",
  too_large: "it is too large to place on a design",
  doctype: "it declares a DOCTYPE or entities, which a logo never needs",
  external_reference: "it links to a file or address outside itself",
  embedded_image: "an image embedded in it could not be read",
  too_complex: "it has more elements or embedded images than a logo needs",
};

export class UnsafeSvgError extends Error {
  constructor(
    readonly reason: UnsafeSvgReason,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(`${reason}: ${detail}`, options);
    this.name = "UnsafeSvgError";
  }

  /** Safe to show the person who uploaded the file. */
  get userMessage(): string {
    return `This SVG can't be used as a logo: ${USER_REASONS[this.reason]}. Export it again as a plain SVG, or upload a PNG.`;
  }
}

/* The logo upload cap, so a stored file is never judged by a looser rule
   than an uploaded one. */
export const MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_ELEMENTS = 50_000;
const MAX_EMBEDDED_IMAGES = 8;

/* Drawn inside a logo, which is a few hundred pixels wide, so a logo's bound.
   A PNG at 1024 px is at most about 4.2 MB, inside the renderer's budget. */
const EMBEDDED_IMAGE_LIMITS = {
  maxInputPixels: 4096 * 4096,
  maxOutputSide: 1024,
  minOutputSide: 256,
  tolerateMissingJpegEnd: true,
};

const SVG_NS = "http://www.w3.org/2000/svg";
const XINCLUDE_NS = "http://www.w3.org/2001/XInclude";
const EMBEDDED_RASTER = /^data:image\/(?:png|jpe?g);base64,([\s\S]*)$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const CSS_URL_ARGUMENT = /url\s*\(\s*["']?\s*([^"')\s]*)/gi;

interface EmbeddedJob {
  base64: string;
}

export async function sanitizeSvg(input: Uint8Array): Promise<SafeSvg> {
  if (input.length > MAX_SVG_INPUT_BYTES) {
    throw new UnsafeSvgError("too_large", `${input.length} bytes`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch (err) {
    throw new UnsafeSvgError("not_svg", "not UTF-8", { cause: err });
  }

  const parts = serialise(text);
  let out = "";
  for (const part of parts) {
    out += typeof part === "string" ? part : await reencodeEmbedded(part);
  }
  const bytes = new TextEncoder().encode(out);
  if (bytes.length > RENDERER_IMAGE_BYTE_BUDGET) {
    throw new UnsafeSvgError("too_large", `${bytes.length} bytes sanitised`);
  }
  return { bytes } as SafeSvg;
}

function serialise(text: string): (string | EmbeddedJob)[] {
  const parts: (string | EmbeddedJob)[] = [];
  let depth = 0;
  let elements = 0;
  let embedded = 0;
  let sawRoot = false;
  let styleText: string | null = null;

  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", (err) => {
    throw new UnsafeSvgError("not_svg", err.message, { cause: err });
  });
  parser.on("doctype", () => {
    throw new UnsafeSvgError("doctype", "DOCTYPE declared");
  });
  parser.on("opentag", (tag) => {
    elements += 1;
    if (elements > MAX_ELEMENTS) {
      throw new UnsafeSvgError("too_complex", `over ${MAX_ELEMENTS} elements`);
    }
    if (depth === 0) {
      if (tag.local !== "svg" || (tag.uri !== SVG_NS && tag.uri !== "")) {
        throw new UnsafeSvgError("not_svg", `root is <${tag.name}>`);
      }
      sawRoot = true;
    }
    if (tag.uri === XINCLUDE_NS) {
      throw new UnsafeSvgError("external_reference", `<${tag.name}>`);
    }
    if (retargetsHref(tag)) {
      throw new UnsafeSvgError("external_reference", `<${tag.name}> on href`);
    }

    parts.push(`<${tag.name}`);
    for (const attr of Object.values(tag.attributes)) {
      const isReference = attr.local === "href" && attr.prefix !== "xmlns";
      if (!isReference) {
        if (!cssReferencesOnlyFragments(attr.value)) {
          throw new UnsafeSvgError("external_reference", `${attr.name}`);
        }
        parts.push(` ${attr.name}="${escapeAttribute(attr.value)}"`);
        continue;
      }
      if (attr.value.startsWith("#")) {
        parts.push(` ${attr.name}="${escapeAttribute(attr.value)}"`);
        continue;
      }
      const raster = EMBEDDED_RASTER.exec(attr.value);
      if (!raster || tag.local !== "image") {
        throw new UnsafeSvgError(
          "external_reference",
          `${attr.name} on <${tag.name}>: ${attr.value.slice(0, 40)}`,
        );
      }
      embedded += 1;
      if (embedded > MAX_EMBEDDED_IMAGES) {
        throw new UnsafeSvgError(
          "too_complex",
          `over ${MAX_EMBEDDED_IMAGES} embedded images`,
        );
      }
      parts.push(` ${attr.name}="`, { base64: raster[1] }, `"`);
    }
    parts.push(">");
    depth += 1;
    if (tag.local === "style") styleText = "";
  });
  const onText = (value: string) => {
    if (styleText !== null) styleText += value;
    parts.push(escapeText(value));
  };
  parser.on("text", onText);
  parser.on("cdata", onText);
  parser.on("closetag", (tag) => {
    if (tag.local === "style" && styleText !== null) {
      if (styleText.includes("\\") || !cssReferencesOnlyFragments(styleText)) {
        throw new UnsafeSvgError("external_reference", "<style>");
      }
      styleText = null;
    }
    depth -= 1;
    parts.push(`</${tag.name}>`);
  });

  parser.write(text).close();
  if (!sawRoot) throw new UnsafeSvgError("not_svg", "no root element");
  return parts;
}

/* SMIL can swap an href after load. Neither rasteriser animates today, so
   this costs no logo anything and keeps the href rule true if one ever
   does. */
function retargetsHref(tag: SaxesTagNS): boolean {
  if (tag.local !== "set" && !tag.local.startsWith("animate")) return false;
  const target = Object.values(tag.attributes).find(
    (attr) => attr.local === "attributeName",
  );
  return target?.value.trim().toLowerCase().endsWith("href") ?? false;
}

function cssReferencesOnlyFragments(css: string): boolean {
  if (/@import/i.test(css)) return false;
  if (css.includes("\\") && css.includes("(")) return false;
  for (const [, target] of css.matchAll(CSS_URL_ARGUMENT)) {
    if (!target.startsWith("#")) return false;
  }
  return true;
}

async function reencodeEmbedded({ base64 }: EmbeddedJob): Promise<string> {
  const compact = base64.replace(/\s+/g, "");
  if (!BASE64.test(compact)) {
    throw new UnsafeSvgError("embedded_image", "not base64");
  }
  const bytes = Buffer.from(compact, "base64");
  const type = detectImageType(bytes);
  if (type !== "png" && type !== "jpeg") {
    throw new UnsafeSvgError("embedded_image", `sniffed as ${type}`);
  }
  try {
    const clean = await reencodeImage(bytes, type, EMBEDDED_IMAGE_LIMITS);
    return `data:${IMAGE_MIME[type]};base64,${clean.bytes.toString("base64")}`;
  } catch (err) {
    const reason =
      err instanceof ImageOverBudgetError ? "too_large" : "embedded_image";
    throw new UnsafeSvgError(reason, String(err), { cause: err });
  }
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* Tabs and line breaks are escaped too, so attribute-value normalisation in
   the renderer's parser cannot change a value this one already normalised. */
function escapeAttribute(value: string): string {
  return escapeText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");
}

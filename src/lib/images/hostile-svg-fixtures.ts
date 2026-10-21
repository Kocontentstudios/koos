import sharp from "sharp";
import { PNG_SIGNATURE, pngChunk } from "./image-fixtures";

/**
 * The FEAT-033 round-3 critic's SVG logos, rebuilt in memory (no binaries in
 * the repo). Each embeds the round-2 palette crash, a PNG whose PLTE is 4
 * bytes long: librsvg decodes it with the Rust PNG decoder, which panics, and
 * the panic aborts the Node process (exit 134).
 *
 * Source: /tmp/feat-033/critique/upload-repro-r3/logo/.
 */

const XMLNS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

export const svgLogo = (body = "") =>
  `<svg ${XMLNS} width="200" height="80" viewBox="0 0 200 80"><rect width="120" height="40" fill="#123456"/>${body}</svg>`;

const base64 = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString("base64");

/** A valid indexed PNG with its palette swapped for a 4-byte one. */
export async function paletteCrashPng(): Promise<Buffer> {
  const width = 64;
  const height = 40;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba.set([(i / 4) % 256, (i / 16) % 256, 90, 255], i);
  }
  const indexed = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ palette: true, colours: 16 })
    .toBuffer();
  return replaceChunk(indexed, "PLTE", Buffer.alloc(4, 9));
}

function replaceChunk(png: Buffer, type: string, data: Buffer): Buffer {
  const chunks: Buffer[] = [PNG_SIGNATURE];
  let at = PNG_SIGNATURE.length;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const name = png.toString("latin1", at + 4, at + 8);
    chunks.push(
      name === type ? pngChunk(type, data) : png.subarray(at, at + 12 + length),
    );
    at += 12 + length;
  }
  return Buffer.concat(chunks);
}

/** name -> SVG text. The first three abort the renderer if drawn raw. */
export function hostileSvgLogos(crash: Buffer): Record<string, string> {
  const png = `data:image/png;base64,${base64(crash)}`;
  const nested = svgLogo(`<image width="64" height="64" href="${png}"/>`);
  return {
    "svg-embeds-plte-len4.svg": svgLogo(
      `<image x="0" y="0" width="64" height="64" xlink:href="${png}"/>`,
    ),
    "svg-embeds-plte-len4-href.svg": svgLogo(
      `<image x="0" y="0" width="64" height="64" href="${png}"/>`,
    ),
    "svg-embeds-svg-embeds-plte.svg": svgLogo(
      `<image width="64" height="64" href="data:image/svg+xml;base64,${base64(nested)}"/>`,
    ),
    "svg-external-file-href.svg": svgLogo(
      '<image width="64" height="64" href="file:///etc/hostname"/><image width="64" height="64" href="http://169.254.169.254/latest/meta-data/"/>',
    ),
    "svg-xxe.svg":
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/hostname">]><svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="0" y="40">&x;</text></svg>',
  };
}

export const ABORTS_RAW = [
  "svg-embeds-plte-len4.svg",
  "svg-embeds-plte-len4-href.svg",
  "svg-embeds-svg-embeds-plte.svg",
];

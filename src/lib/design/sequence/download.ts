/**
 * KOOS-AI-002: a set leaves KO as one file, a zip of numbered PNGs or a
 * PDF with one page per frame (the shape LinkedIn takes as a document post).
 *
 * fflate for the zip: already a dependency, synchronous, no dependencies of
 * its own. pdf-lib for the PDF: pure JS with no filesystem reads, so it runs
 * in a serverless function without tracing tricks, and it parses what it
 * writes, which is how the tests check the pages.
 *
 * Server only: node:crypto, and pdf-lib is too heavy for a client bundle.
 */
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { generationFileName } from "@/lib/design/download-name";
import { STORAGE_PREFIXES } from "@/lib/storage-keys";
import type { FrameRole } from "./contract";

export const SET_DOWNLOAD_FORMATS = ["zip", "pdf"] as const;
export type SetDownloadFormat = (typeof SET_DOWNLOAD_FORMATS)[number];

export const SET_DOWNLOAD_CONTENT_TYPES: Record<SetDownloadFormat, string> = {
  zip: "application/zip",
  pdf: "application/pdf",
};

export function isSetDownloadFormat(
  value: unknown,
): value is SetDownloadFormat {
  return (SET_DOWNLOAD_FORMATS as readonly unknown[]).includes(value);
}

/* Two digits even for a set under ten, so "10-cta.png" never sorts above
   "2-body.png" in a file browser and every set names its files the same way. */
const MIN_NUMBER_WIDTH = 2;

/** "01-hook.png": the frame's 1-based position, padded to the set's size,
 *  then its role. A gap left by a failed frame stays visible in the
 *  numbering instead of being closed up. */
export function frameFileName(
  index: number,
  role: FrameRole,
  count: number,
): string {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`Invalid frame count: ${count}`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`Frame index ${index} is outside a set of ${count}`);
  }
  const width = Math.max(MIN_NUMBER_WIDTH, String(count).length);
  return `${String(index + 1).padStart(width, "0")}-${role}.png`;
}

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

export function zipFrames(frames: readonly ZipEntry[]): Uint8Array {
  if (frames.length === 0) throw new Error("A zip needs at least one frame.");
  const names = new Set(frames.map(({ name }) => name));
  /* fflate takes an object, which would silently keep only the last of two
     same-named frames. */
  if (names.size !== frames.length) {
    throw new Error("Two frames share a zip entry name.");
  }
  /* Stored, not deflated: a PNG is already compressed, so deflating it again
     spends CPU on every download to save almost nothing. */
  return zipSync(
    Object.fromEntries(frames.map(({ name, bytes }) => [name, bytes])),
    { level: 0 },
  );
}

export interface PdfFrame {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** One page per frame, in order, each page the frame's pixel size in
 *  points so the image is drawn 1:1 with no margin or scaling. */
export async function pdfFrames(
  frames: readonly PdfFrame[],
): Promise<Uint8Array> {
  if (frames.length === 0) throw new Error("A PDF needs at least one frame.");
  const pdf = await PDFDocument.create();
  for (const [i, frame] of frames.entries()) {
    const { width, height } = frame;
    if (!(width > 0 && height > 0)) {
      throw new RangeError(`Frame ${i} has no size: ${width}x${height}`);
    }
    const image = await pdf.embedPng(frame.bytes);
    pdf
      .addPage([width, height])
      .drawImage(image, { x: 0, y: 0, width, height });
  }
  return pdf.save();
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_OFFSET = 12;

/** A PNG's pixel size, read from its IHDR chunk. The file is what lands on
 *  the page, so its own header is the size, not a column that could drift. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const isPng =
    bytes.length >= 24 &&
    PNG_SIGNATURE.every((b, i) => bytes[i] === b) &&
    String.fromCharCode(...bytes.subarray(IHDR_OFFSET, IHDR_OFFSET + 4)) ===
      "IHDR";
  if (!isPng) throw new Error("Not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface SetFileNameFields {
  setId: string;
  brandName: string | null;
  designType: string | null;
  width: number | null;
  height: number | null;
}

/** "acme-bakery-instagram-carousel-1080x1350-1a2b3c4d.zip": the single
 *  design's naming with the brand in front, since a set is usually saved
 *  to hand to someone else. */
export function setFileName(
  fields: SetFileNameFields,
  format: SetDownloadFormat,
): string {
  const label = [fields.brandName, fields.designType ?? "design"]
    .filter((part) => part?.trim())
    .join(" ");
  return generationFileName({
    id: fields.setId,
    designType: label,
    width: fields.width,
    height: fields.height,
  }).replace(/\.png$/, `.${format}`);
}

/** Where a built download is kept. Named by the live frames it holds, so
 *  the same set downloaded twice reuses one object and a regenerated frame
 *  gets a new one instead of a stale file under a cached URL. */
export function setDownloadKey(fields: {
  brandId: string;
  setId: string;
  frameIds: readonly string[];
  format: SetDownloadFormat;
}): string {
  const frames = createHash("sha256")
    .update(fields.frameIds.join(","))
    .digest("hex")
    .slice(0, 16);
  return `${STORAGE_PREFIXES.generated}/${fields.brandId}/sets/${fields.setId}/${frames}.${fields.format}`;
}

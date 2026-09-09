/** Shared client/server validation for the single-page design request form.
 * Framework-free so it's unit-tested. */

import { z } from "zod";
import { STORAGE_PREFIXES } from "@/lib/storage";

export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

const ALLOWED_UPLOADS: Record<string, string[]> = {
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  svg: ["image/svg+xml"],
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  mp4: ["video/mp4"],
  mov: ["video/quicktime"],
  webm: ["video/webm"],
  zip: ["application/zip", "application/x-zip-compressed"],
};

/** Human-readable summary for upload UI copy and error messages. */
export const ALLOWED_UPLOAD_SUMMARY =
  "Images, logos, PDFs, DOCX, videos, brand guidelines, and ZIP files";

export function isAllowedUpload(fileName: string, mimeType: string): boolean {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length < 2) return false;
  const ext = parts.pop() ?? "";
  return ALLOWED_UPLOADS[ext]?.includes(mimeType.toLowerCase()) ?? false;
}

export function buildAttachmentKey(
  userId: string,
  fileName: string,
  rand: string,
): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "bin";
  return `${STORAGE_PREFIXES.referenceImages}/${userId}/${rand}.${ext}`;
}

/* Documents land under their own prefix, not reference-images: the parser
   pins that prefix when it turns a URL back into a key, so sharing one prefix
   would let any attachment URL be handed to the document reader. */
export function buildDocumentKey(
  userId: string,
  fileName: string,
  rand: string,
): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "bin";
  return `${STORAGE_PREFIXES.brandDocs}/${userId}/${rand}.${ext}`;
}

export function documentKeyBelongsToUser(key: string, userId: string): boolean {
  return key.startsWith(`${STORAGE_PREFIXES.brandDocs}/${userId}/`);
}

export function attachmentKeyBelongsToUser(
  key: string,
  userId: string,
): boolean {
  return key.startsWith(`${STORAGE_PREFIXES.referenceImages}/${userId}/`);
}

export const specsSchema = z.object({
  platform: z.string().max(100).optional(),
  dimensions: z.string().max(100).optional(),
  orientation: z.enum(["portrait", "landscape", "square"]).optional(),
  fileFormat: z.string().max(50).optional(),
  deliverablesCount: z.number().int().min(1).max(50).optional(),
});
export type DesignTicketSpecs = z.infer<typeof specsSchema>;

const attachmentCommon = {
  category: z.enum(["asset", "reference"]),
  note: z.string().max(1000).optional(),
};

export const attachmentInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    key: z.string().min(1).max(500),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    ...attachmentCommon,
  }),
  z.object({
    kind: z.literal("link"),
    url: z.url({ protocol: /^https?$/ }).max(2000),
    ...attachmentCommon,
  }),
]);
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

/** Server-side submission schema. `title` is nullish because pre-form
 * surfaces (chat brief panel, calendar modal, quick request) never send one;
 * the new form enforces it client-side via `formRequestSchema`. */
export const designRequestSchema = z.object({
  brandId: z.uuid(),
  requestType: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(200).nullish(),
  brief: z.string().trim().min(1).max(20000),
  dueDate: z.union([z.iso.date(), z.iso.datetime()]).nullish(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  specs: specsSchema.nullish(),
  attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS).default([]),
});
export type DesignRequestInput = z.infer<typeof designRequestSchema>;

/** Client-side schema for the single-page form, where a title is required. */
export const formRequestSchema = designRequestSchema.extend({
  title: z.string().trim().min(1, "Give your project a title.").max(200),
});

export const draftRequestSchema = designRequestSchema
  .partial()
  .extend({ brandId: z.uuid() })
  .refine((d) => Boolean(d.title?.trim() || d.brief?.trim()), {
    message: "Add a title or brief before saving a draft.",
  });
export type DraftRequestInput = z.infer<typeof draftRequestSchema>;

export const presignRequestSchema = z.object({
  brandId: z.uuid(),
  fileName: z.string().min(1).max(255),
  /* Empty allowed: some browsers send no MIME for .txt, and the document
     allow-list accepts that only where the extension is unambiguous. */
  mimeType: z.string().max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  /* Which allow-list, size cap and key prefix apply. Defaulted, so every
     existing caller keeps its behaviour without passing the field. */
  kind: z.enum(["attachment", "document"]).default("attachment"),
});
export type PresignRequestInput = z.infer<typeof presignRequestSchema>;

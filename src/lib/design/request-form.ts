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

export const designRequestSchema = z.object({
  brandId: z.uuid(),
  requestType: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  brief: z.string().trim().min(1).max(20000),
  dueDate: z.iso.date().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  specs: specsSchema.optional(),
  attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS).default([]),
});
export type DesignRequestInput = z.infer<typeof designRequestSchema>;

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
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type PresignRequestInput = z.infer<typeof presignRequestSchema>;

/**
 * What the onboarding document upload accepts, and how a file maps to a
 * reader. Framework-free and dependency-free so it can be unit-tested and
 * imported from both the client and the route.
 */

export const DOCUMENT_EXTENSIONS = ["pdf", "docx", "txt", "pptx"] as const;
export type DocumentExtension = (typeof DOCUMENT_EXTENSIONS)[number];

/** FEAT-018 states 25MB. Deliberately below MAX_UPLOAD_BYTES (100MB), which
 *  sizes video and deliverable zips rather than a text extraction budget. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/* Extension AND MIME must agree, the same contract isAllowedUpload enforces
   for design attachments: an extension alone is renameable, and a MIME type
   alone is whatever the browser felt like sending. */
export const DOCUMENT_MIME_TYPES: Record<DocumentExtension, string[]> = {
  pdf: ["application/pdf"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  /* Browsers disagree on plain text. Chrome sends text/plain; some send an
     empty string for a file with no registered handler, and an empty MIME is
     indistinguishable from "the browser has no opinion" — so it is accepted
     for .txt only, where the extension is unambiguous. */
  txt: ["text/plain", ""],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
};

export const DOCUMENT_SUMMARY = "PDF, DOCX, PPTX or TXT, up to 25MB";

export function documentExtensionOf(
  fileName: string,
): DocumentExtension | null {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length < 2) return null;
  const ext = parts.pop() ?? "";
  return (DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as DocumentExtension)
    : null;
}

export function isAllowedDocument(fileName: string, mimeType: string): boolean {
  const ext = documentExtensionOf(fileName);
  if (!ext) return false;
  return DOCUMENT_MIME_TYPES[ext].includes(mimeType.toLowerCase().trim());
}

/** The `accept` attribute for the file input, so the picker filters too. */
export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(
  ",",
);

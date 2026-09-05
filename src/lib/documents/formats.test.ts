import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_EXTENSIONS,
  DOCUMENT_MIME_TYPES,
  documentExtensionOf,
  isAllowedDocument,
  MAX_DOCUMENT_BYTES,
} from "./formats";

/* The four the ticket names, and only those. */
describe("the accepted formats", () => {
  it("accepts exactly PDF, DOCX, TXT and PPTX", () => {
    expect([...DOCUMENT_EXTENSIONS].sort()).toEqual([
      "docx",
      "pdf",
      "pptx",
      "txt",
    ]);
  });

  it("caps at the 25MB the ticket states", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(25 * 1024 * 1024);
  });

  it("offers every extension to the file picker", () => {
    for (const ext of DOCUMENT_EXTENSIONS) {
      expect(DOCUMENT_ACCEPT).toContain(`.${ext}`);
    }
  });

  it("gives every extension at least one MIME type", () => {
    for (const ext of DOCUMENT_EXTENSIONS) {
      expect(DOCUMENT_MIME_TYPES[ext].length).toBeGreaterThan(0);
    }
  });
});

describe("documentExtensionOf", () => {
  it.each([
    ["Brand Guidelines.PDF", "pdf"],
    ["deck.pptx", "pptx"],
    ["notes.txt", "txt"],
    ["identity.docx", "docx"],
    /* The LAST extension decides. "logo.pdf.exe" is an executable. */
    ["logo.pdf.exe", null],
    ["archive.tar.gz", null],
    ["noextension", null],
    ["", null],
  ])("%s", (fileName, expected) => {
    expect(documentExtensionOf(fileName)).toBe(expected);
  });
});

describe("isAllowedDocument", () => {
  it.each([
    ["guide.pdf", "application/pdf"],
    [
      "guide.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "deck.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    ["notes.txt", "text/plain"],
  ])("accepts %s", (fileName, mime) => {
    expect(isAllowedDocument(fileName, mime)).toBe(true);
  });

  /* Extension AND MIME must agree. An extension alone is renameable; a MIME
     alone is whatever the browser felt like sending. */
  it("refuses an extension whose MIME disagrees", () => {
    expect(isAllowedDocument("guide.pdf", "application/zip")).toBe(false);
    expect(isAllowedDocument("deck.pptx", "application/pdf")).toBe(false);
  });

  it("refuses a document type the ticket did not name", () => {
    expect(isAllowedDocument("sheet.xlsx", "application/vnd.ms-excel")).toBe(
      false,
    );
    expect(isAllowedDocument("old.doc", "application/msword")).toBe(false);
  });

  it("refuses an image even with a real image MIME", () => {
    expect(isAllowedDocument("logo.png", "image/png")).toBe(false);
  });

  /* Some browsers send no MIME at all for .txt, and an empty string is
     indistinguishable from "no opinion" — accepted only where the extension
     is unambiguous. */
  it("accepts a .txt with no MIME, but not a .pdf with none", () => {
    expect(isAllowedDocument("notes.txt", "")).toBe(true);
    expect(isAllowedDocument("guide.pdf", "")).toBe(false);
  });

  /* The contract is that extension AND MIME agree. Testing only a few
     hand-picked mismatches leaves room for one extension to quietly accept
     another format's MIME — so every pair is checked. */
  it.each(DOCUMENT_EXTENSIONS)(
    "%s refuses every other format's MIME type",
    (ext) => {
      for (const other of DOCUMENT_EXTENSIONS) {
        if (other === ext) continue;
        for (const mime of DOCUMENT_MIME_TYPES[other]) {
          /* The empty string is not one format's MIME, it is "no opinion" —
             and .txt is allowed to accept it, so it is not a mismatch. */
          if (mime === "") continue;
          expect(isAllowedDocument(`file.${ext}`, mime)).toBe(false);
        }
      }
    },
  );

  it("is case-insensitive on both halves", () => {
    expect(isAllowedDocument("GUIDE.PDF", "Application/PDF")).toBe(true);
  });
});

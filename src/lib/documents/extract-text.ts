import { unzipSync } from "fflate";
import type { DocumentExtension } from "./formats";

/**
 * Document bytes to plain text, one reader per format.
 *
 * The readers are dynamically imported so a route that only ever sees .txt
 * never pays to load a PDF engine, and so an unused format cannot break the
 * whole module at import time.
 *
 * Every reader returns text or throws. A file that parses to nothing is not an
 * error here — the caller decides whether empty text is worth telling the user
 * about, because "this PDF is a scan with no text layer" is a far more useful
 * message than a stack trace.
 */

/* Long enough for a real brand deck, bounded because the text is about to
   become prompt input and an unbounded document is an unbounded bill. The
   caller is told when it truncated so the user can be told too. */
export const MAX_DOCUMENT_CHARS = 60_000;

export interface ExtractedDocument {
  text: string;
  truncated: boolean;
}

function finish(raw: string): ExtractedDocument {
  /* Collapse the whitespace a PDF or slide deck produces: layout-derived text
     arrives full of single-character lines and runs of blanks, which spend
     tokens without carrying meaning. */
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > MAX_DOCUMENT_CHARS
    ? { text: text.slice(0, MAX_DOCUMENT_CHARS), truncated: true }
    : { text, truncated: false };
}

async function readPdf(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

async function readDocx(bytes: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: bytes });
  return value;
}

/* A .pptx is a zip of XML. Slide text lives in <a:t> runs; reading the whole
   part as prose would drag in relationship ids, theme names and layout junk. */
const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;

function readPptx(bytes: Buffer): string {
  const files = unzipSync(new Uint8Array(bytes));
  const slides = Object.keys(files)
    .map((path) => [path, SLIDE_PATH.exec(path)] as const)
    .filter((entry): entry is [string, RegExpExecArray] => entry[1] !== null)
    // Numeric, not lexicographic: slide10 sorts before slide2 as a string.
    .sort((a, b) => Number(a[1][1]) - Number(b[1][1]));

  const decoder = new TextDecoder();
  return slides
    .map(([path]) => {
      const xml = decoder.decode(files[path]);
      const runs = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) =>
        decodeXmlEntities(m[1]),
      );
      return runs.join(" ").trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

/* Only the five predefined entities: an XML part cannot declare its own
   without a DTD, which Office never writes. &amp; is unescaped LAST so
   "&amp;lt;" survives as the literal "&lt;" rather than becoming "<". */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function extractDocumentText(
  bytes: Buffer,
  extension: DocumentExtension,
): Promise<ExtractedDocument> {
  switch (extension) {
    case "pdf":
      return finish(await readPdf(bytes));
    case "docx":
      return finish(await readDocx(bytes));
    case "pptx":
      return finish(readPptx(bytes));
    case "txt":
      return finish(bytes.toString("utf8"));
  }
}

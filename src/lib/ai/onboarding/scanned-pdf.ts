import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { documentTranscript } from "./document-prompt";
import {
  EXTRACTION_OUTPUT_TOKEN_CAP,
  extractionSchema,
  omitUnfilled,
  SYSTEM_PROMPT,
} from "./extraction";

/**
 * Read a PDF that has no text layer by handing the file to the model.
 *
 * A scanned or fully-designed brand deck parses cleanly and yields no text, so
 * the text path could only tell the user to go and find a different export
 * (KOOS-V1-FEAT-031). The bytes go to the model instead: no OCR dependency,
 * and unlike OCR a vision model reads a designed page as a designer laid it
 * out — the palette, the typography and the headline hierarchy are the point,
 * not just the glyphs.
 *
 * Every failure returns null. This is an offer on top of the text path, so a
 * provider that rejects document parts, a model that finds nothing, or a file
 * the provider will not take must all leave the user exactly where they were.
 */

/* Provider document limits sit far below the 25MB upload cap — Bedrock's
   Converse document block is the tightest. Refusing here costs nothing; a
   rejected 25MB round trip costs the user a minute. */
export const MAX_VISION_PDF_BYTES = 4 * 1024 * 1024;

export interface ScannedPdfInput {
  bytes: Buffer | Uint8Array;
  fileName: string;
  conversation?: string;
}

export async function readScannedPdf({
  bytes,
  fileName,
  conversation,
}: ScannedPdfInput): Promise<{
  summary: string;
  fields: Record<string, unknown>;
} | null> {
  if (bytes.byteLength > MAX_VISION_PDF_BYTES) return null;

  try {
    const { object } = await generateObject({
      model: getModel("brand"),
      schema: extractionSchema,
      maxOutputTokens: EXTRACTION_OUTPUT_TOKEN_CAP,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: documentTranscript({
                fileName,
                text: "",
                truncated: false,
                conversation,
              }),
            },
            {
              type: "text",
              text: "This document has no text layer — it is a scan or a set of designed pages. Read the pages themselves, including any text set as part of the artwork, and the colours and typography they use.",
            },
            {
              type: "file",
              data: new Uint8Array(bytes),
              mediaType: "application/pdf",
            },
          ],
        },
      ],
    });

    /* Same shape the text path produces, so the caller builds one proposal and
       the two routes cannot drift. */
    const fields = omitUnfilled(object.fields);
    return Object.keys(fields).length > 0
      ? { summary: object.summary, fields }
      : null;
  } catch (err) {
    /* Includes providers that reject document parts outright, and files they
       accept but refuse by page count. The caller falls back to telling the
       user it could not be read. */
    console.error("scanned PDF extraction failed", { fileName }, err);
    return null;
  }
}

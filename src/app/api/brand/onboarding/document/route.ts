import { generateObject } from "ai";
import { z } from "zod";
import {
  documentTranscript,
  MAX_DOCUMENT_TRANSCRIPT,
} from "@/lib/ai/onboarding/document-prompt";
import {
  EXTRACTION_OUTPUT_TOKEN_CAP,
  extractionSchema,
  omitUnfilled,
  SYSTEM_PROMPT,
} from "@/lib/ai/onboarding/extraction";
import { getModel } from "@/lib/ai/provider";
import { ProposalSchema } from "@/lib/ai/tools/proposals";
import { getAuthUser } from "@/lib/auth/get-user";
import { addBrandAsset, checkBrandAccess } from "@/lib/db/queries";
import { documentKeyBelongsToUser } from "@/lib/design/request-form";
import { extractDocumentText } from "@/lib/documents/extract-text";
import {
  DOCUMENT_SUMMARY,
  documentExtensionOf,
  MAX_DOCUMENT_BYTES,
} from "@/lib/documents/formats";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getObjectBytes, publicUrl } from "@/lib/storage";

const bodySchema = z.object({
  brandId: z.uuid(),
  /* The KEY the presign step returned, never a URL. A caller-supplied URL is
     an SSRF: the server would fetch whatever it was pointed at. The key is
     additionally checked to sit under this user's own document prefix, so one
     user cannot read another's upload by guessing. */
  key: z.string().min(1).max(512),
  fileName: z.string().min(1).max(255),
  /* What the user has typed in the chat so far, so the document is read
     alongside it rather than instead of it. */
  conversation: z.string().max(MAX_DOCUMENT_TRANSCRIPT).optional(),
});

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  /* Parsing a deck is a model call per upload. Tighter than the chat's limit
     because each one is far more expensive. */
  const verdict = await checkRateLimit({
    key: `onboarding-document:${dbUser.id}`,
    limit: 10,
    windowSeconds: 600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { brandId, key, fileName, conversation } = parsed.data;

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  if (!documentKeyBelongsToUser(key, dbUser.id)) {
    return Response.json({ error: "Unknown document." }, { status: 403 });
  }

  const extension = documentExtensionOf(fileName);
  if (!extension) {
    return Response.json(
      { error: `That file type is not supported. ${DOCUMENT_SUMMARY}.` },
      { status: 400 },
    );
  }

  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(key);
  } catch {
    return Response.json(
      { error: "That upload could not be read. Please try again." },
      { status: 404 },
    );
  }

  /* The real size, not the one the client claimed at presign time. */
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return Response.json(
      { error: `That document is too large. ${DOCUMENT_SUMMARY}.` },
      { status: 413 },
    );
  }

  let extracted: Awaited<ReturnType<typeof extractDocumentText>>;
  try {
    extracted = await extractDocumentText(bytes, extension);
  } catch (err) {
    console.error("document extraction failed", { extension }, err);
    return Response.json(
      {
        error:
          "We couldn't read that file. It may be password-protected or damaged.",
      },
      { status: 422 },
    );
  }

  /* A scanned deck parses fine and contains no text. Saying so is far more
     useful than an empty confirmation card, and it names the fix. */
  if (!extracted.text) {
    return Response.json(
      {
        error:
          "That file has no readable text — it may be a scan or images only. Try a text-based export, or tell KO about your brand in the chat.",
      },
      { status: 422 },
    );
  }

  try {
    const { object } = await generateObject({
      model: getModel("brand"),
      schema: extractionSchema,
      system: SYSTEM_PROMPT,
      prompt: documentTranscript({
        fileName,
        text: extracted.text,
        truncated: extracted.truncated,
        conversation,
      }),
      // Unbounded output truncates mid-JSON on Bedrock and surfaces as a
      // schema-mismatch retry loop rather than a token error.
      maxOutputTokens: EXTRACTION_OUTPUT_TOKEN_CAP,
    });

    const proposal = {
      kind: "brand_fields" as const,
      summary: object.summary,
      data: { fields: omitUnfilled(object.fields) },
    };

    const validated = ProposalSchema.safeParse(proposal);
    if (!validated.success) {
      console.error("document extract: invalid proposal", validated.error);
      return Response.json(
        { error: "We couldn't make sense of that document." },
        { status: 502 },
      );
    }

    /* Kept, not discarded: the deck is the brand's own material and belongs on
       the brand. Recorded AFTER the parse succeeds, so a file we could not
       read does not leave a broken asset behind — and a failure to record must
       not lose the user the extraction they are waiting on. */
    try {
      await addBrandAsset({
        brandId,
        assetType: "document",
        fileUrl: publicUrl(key),
        fileName,
      });
    } catch (err) {
      console.error("document asset not recorded", err);
    }

    return Response.json({
      proposal: validated.data,
      fileName,
      truncated: extracted.truncated,
    });
  } catch (err) {
    console.error("document extraction model call failed", err);
    return Response.json(
      { error: "Reading that document failed. Please try again." },
      { status: 500 },
    );
  }
}

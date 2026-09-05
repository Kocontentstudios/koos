import { randomBytes } from "node:crypto";
import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess } from "@/lib/db/queries";
import {
  ALLOWED_UPLOAD_SUMMARY,
  buildAttachmentKey,
  buildDocumentKey,
  isAllowedUpload,
  presignRequestSchema,
} from "@/lib/design/request-form";
import {
  DOCUMENT_SUMMARY,
  isAllowedDocument,
  MAX_DOCUMENT_BYTES,
} from "@/lib/documents/formats";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getSignedUploadUrl, isStorageConfigured } from "@/lib/storage";

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!isStorageConfigured()) {
    return Response.json(
      { error: "File uploads are not available right now." },
      { status: 503 },
    );
  }

  const verdict = await checkRateLimit({
    key: `upload-presign:${dbUser.id}`,
    limit: 60,
    windowSeconds: 600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = presignRequestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid upload request" }, { status: 400 });
  }
  const { brandId, fileName, mimeType, sizeBytes, kind } = parsed.data;

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  /* A document is a narrower allow-list and a smaller cap than a design
     attachment, and lands under its own prefix. The size is re-checked against
     the real bytes when the document is parsed — this is only what the client
     claims, and a client can claim anything. */
  const isDocument = kind === "document";
  const allowed = isDocument
    ? isAllowedDocument(fileName, mimeType)
    : isAllowedUpload(fileName, mimeType);
  if (!allowed) {
    return Response.json(
      {
        error: `This file type is not supported. ${
          isDocument ? DOCUMENT_SUMMARY : ALLOWED_UPLOAD_SUMMARY
        }.`,
      },
      { status: 400 },
    );
  }

  if (isDocument && sizeBytes > MAX_DOCUMENT_BYTES) {
    return Response.json(
      { error: `That document is too large. ${DOCUMENT_SUMMARY}.` },
      { status: 400 },
    );
  }

  const rand = randomBytes(12).toString("hex");
  const key = isDocument
    ? buildDocumentKey(dbUser.id, fileName, rand)
    : buildAttachmentKey(dbUser.id, fileName, rand);
  const url = await getSignedUploadUrl(key, mimeType);
  return Response.json({ key, url });
}

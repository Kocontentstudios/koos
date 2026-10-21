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
  canonicalDocumentMime,
  DOCUMENT_SUMMARY,
  isAllowedDocument,
  MAX_DOCUMENT_BYTES,
} from "@/lib/documents/formats";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getSignedUploadUrl, isStorageConfigured } from "@/lib/storage";
import { designImageKeyFor } from "@/lib/uploads/design-image";
import {
  EXTENSION_FOR_STORED_TYPE,
  isPresignableDesignImage,
  isStoredDesignImageType,
  MAX_DESIGN_IMAGE_BYTES,
} from "@/lib/uploads/design-image-limits";

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

  const request = { fileName, mimeType, sizeBytes };
  /* The brand row's id, not the request's: Postgres matches an uppercase UUID
     case-insensitively, so the request string can pass the access check and
     still not be the canonical id a key is built from. */
  const target =
    kind === "design-image"
      ? designImageTarget(access.brand.id, request)
      : kind === "document"
        ? documentTarget(dbUser.id, request)
        : attachmentTarget(dbUser.id, request);
  if ("error" in target) {
    return Response.json({ error: target.error }, { status: 400 });
  }

  /* The URL binds this type and this size. The browser sends the type back
     verbatim, which matters where it differs from file.type (an untyped .txt
     is signed as text/plain). */
  const url = await getSignedUploadUrl(
    target.key,
    target.contentType,
    sizeBytes,
  );
  return Response.json({
    key: target.key,
    url,
    contentType: target.contentType,
  });
}

interface UploadClaim {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

type UploadTarget = { key: string; contentType: string } | { error: string };

function attachmentTarget(userId: string, claim: UploadClaim): UploadTarget {
  if (!isAllowedUpload(claim.fileName, claim.mimeType)) {
    return {
      error: `This file type is not supported. ${ALLOWED_UPLOAD_SUMMARY}.`,
    };
  }
  const rand = randomBytes(12).toString("hex");
  return {
    key: buildAttachmentKey(userId, claim.fileName, rand),
    contentType: claim.mimeType.toLowerCase(),
  };
}

/* A document is a narrower allow-list and a smaller cap than a design
   attachment, and lands under its own prefix. The size is re-checked against
   the real bytes when the document is parsed; this is only what the client
   claims, and a client can claim anything. */
function documentTarget(userId: string, claim: UploadClaim): UploadTarget {
  if (!isAllowedDocument(claim.fileName, claim.mimeType)) {
    return { error: `This file type is not supported. ${DOCUMENT_SUMMARY}.` };
  }
  if (claim.sizeBytes > MAX_DOCUMENT_BYTES) {
    return { error: `That document is too large. ${DOCUMENT_SUMMARY}.` };
  }
  const rand = randomBytes(12).toString("hex");
  return {
    key: buildDocumentKey(userId, claim.fileName, rand),
    contentType: canonicalDocumentMime(claim.fileName, claim.mimeType),
  };
}

const STORED_SUMMARY = `PNG or JPEG image, up to ${MAX_DESIGN_IMAGE_BYTES / (1024 * 1024)} MB`;

/* Keyed by brand, not user: the image belongs to the design, and generation
   proves the key is this brand's before reading it (loadDesignImage). Only
   PNG and JPEG are signed because only they are ever stored; the browser
   converts WEBP first, so a WEBP here is a client that skipped that step. The
   bytes are judged again at generation, because the signature binds only the
   declared type and size, never what the bytes are. */
function designImageTarget(brandId: string, claim: UploadClaim): UploadTarget {
  const mime = claim.mimeType.toLowerCase().trim();
  if (mime === "image/webp") {
    return {
      error:
        "WEBP images are converted to PNG or JPEG before upload. Upload a PNG or JPEG.",
    };
  }
  if (
    !isStoredDesignImageType(mime) ||
    !isPresignableDesignImage(claim.fileName, mime)
  ) {
    return {
      error: `This file type is not supported. Upload a ${STORED_SUMMARY}.`,
    };
  }
  if (claim.sizeBytes > MAX_DESIGN_IMAGE_BYTES) {
    return { error: `That image is too large. Upload a ${STORED_SUMMARY}.` };
  }
  return {
    key: designImageKeyFor(brandId, EXTENSION_FOR_STORED_TYPE[mime]),
    contentType: mime,
  };
}

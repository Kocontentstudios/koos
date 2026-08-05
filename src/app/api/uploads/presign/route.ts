import { randomBytes } from "node:crypto";
import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess } from "@/lib/db/queries";
import {
  ALLOWED_UPLOAD_SUMMARY,
  buildAttachmentKey,
  isAllowedUpload,
  presignRequestSchema,
} from "@/lib/design/request-form";
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
  const { brandId, fileName, mimeType } = parsed.data;

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  if (!isAllowedUpload(fileName, mimeType)) {
    return Response.json(
      { error: `This file type is not supported. ${ALLOWED_UPLOAD_SUMMARY}.` },
      { status: 400 },
    );
  }

  const key = buildAttachmentKey(
    dbUser.id,
    fileName,
    randomBytes(12).toString("hex"),
  );
  const url = await getSignedUploadUrl(key, mimeType);
  return Response.json({ key, url });
}

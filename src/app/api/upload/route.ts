import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import {
  isStorageConfigured,
  publicUrl,
  STORAGE_PREFIXES,
  uploadObject,
} from "@/lib/storage";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/svg+xml", "svg"],
]);

export async function POST(request: Request) {
  /* Storage writes are workspace work, not merely signed-in work: gating on
     the capability keeps a removed member (or a future read-only role) from
     writing objects. Every current role holds manage_content, so this does
     not change what a legitimate user can do. */
  const guard = await guardWorkspaceRoute("manage_content");
  if ("response" in guard) return guard.response;
  const { dbUser } = guard.ctx;
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "File storage is not configured." },
      { status: 503 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 5MB)." },
      {
        status: 400,
      },
    );
  }
  const ext = ALLOWED.get(file.type);
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported file type." },
      { status: 400 },
    );
  }

  const key = `${STORAGE_PREFIXES.logos}/${dbUser.id}/${Date.now()}-${randomBytes(
    6,
  ).toString("hex")}.${ext}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadObject({ key, body: buffer, contentType: file.type });
  } catch {
    return NextResponse.json({ error: "Upload failed." }, { status: 502 });
  }

  return NextResponse.json({ url: publicUrl(key), key });
}

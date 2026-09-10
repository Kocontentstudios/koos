import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import {
  checkFontBytes,
  fontExtension,
  fontRejectionMessage,
} from "@/lib/design/render/font-file";
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
  const buffer = Buffer.from(await file.arrayBuffer());
  const wantsFont = form.get("kind") === "font";

  /* Fonts and images are validated differently on purpose: an image's MIME is
     the only signal available, while a font's is unreliable enough that the
     bytes are the only honest check.

     A font is checked in full rather than by its first four bytes. The
     signature says only that a file claims to be a font; satori parses lazily
     inside the render, so a shredded body is accepted here and then fails
     every design the brand ever generates (KOS-V1-BUG-018). Refusing it while
     the user is still looking at the file picker is the only point where the
     message can name the file. */
  if (wantsFont) {
    const check = checkFontBytes(new Uint8Array(buffer));
    if (!check.ok) {
      return NextResponse.json(
        { error: fontRejectionMessage(file.name, check.reason) },
        { status: 400 },
      );
    }
  }

  const ext = wantsFont
    ? fontExtension(new Uint8Array(buffer))
    : ALLOWED.get(file.type);
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported file type." },
      {
        status: 400,
      },
    );
  }

  const prefix = wantsFont ? STORAGE_PREFIXES.fonts : STORAGE_PREFIXES.logos;
  const key = `${prefix}/${dbUser.id}/${Date.now()}-${randomBytes(6).toString(
    "hex",
  )}.${ext}`;

  try {
    await uploadObject({
      key,
      body: buffer,
      // Never echo the client's type for a font: it is frequently wrong, and
      // the signature already told us what this is.
      contentType: wantsFont ? "font/sfnt" : file.type,
    });
  } catch {
    return NextResponse.json({ error: "Upload failed." }, { status: 502 });
  }

  return NextResponse.json({ url: publicUrl(key), key });
}

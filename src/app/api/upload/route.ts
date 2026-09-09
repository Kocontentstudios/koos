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

/* Fonts are checked by signature, not MIME. Browsers send fonts as
   application/octet-stream, an empty string, or one of several font/* values
   depending on the platform, so file.type cannot decide this — and it is
   client-controlled anyway. These four are what satori can actually parse:
   0x00010000 and "true" for TrueType, "OTTO" for CFF OpenType, "ttcf" for a
   collection. WOFF and WOFF2 are deliberately absent; satori rejects them. */
const FONT_SIGNATURES: [number[], string][] = [
  [[0x00, 0x01, 0x00, 0x00], "ttf"],
  [[0x74, 0x72, 0x75, 0x65], "ttf"],
  [[0x4f, 0x54, 0x54, 0x4f], "otf"],
  [[0x74, 0x74, 0x63, 0x66], "ttc"],
];

function fontExtension(bytes: Uint8Array): string | null {
  for (const [signature, ext] of FONT_SIGNATURES) {
    if (signature.every((byte, i) => bytes[i] === byte)) return ext;
  }
  return null;
}

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
     bytes are the only honest check. */
  const ext = wantsFont
    ? fontExtension(new Uint8Array(buffer.subarray(0, 4)))
    : ALLOWED.get(file.type);
  if (!ext) {
    return NextResponse.json(
      {
        error: wantsFont
          ? "That does not look like a TTF or OTF font file."
          : "Unsupported file type.",
      },
      { status: 400 },
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

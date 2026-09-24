// @vitest-environment node
//
// Node, not jsdom: this route reads a multipart body, and jsdom's File is not
// the File undici's FormData produces — instanceof fails across the two.
import { beforeEach, describe, expect, it, vi } from "vitest";

const guardWorkspaceRoute = vi.fn();
const isStorageConfigured = vi.fn();
const uploadObject = vi.fn();

vi.mock("@/lib/auth/workspace-guard", () => ({
  guardWorkspaceRoute: (cap: string) => guardWorkspaceRoute(cap),
}));
vi.mock("@/lib/storage", () => ({
  isStorageConfigured: () => isStorageConfigured(),
  uploadObject: (a: unknown) => uploadObject(a),
  publicUrl: (key: string) => `https://cdn.example.com/${key}`,
  STORAGE_PREFIXES: { logos: "logos", fonts: "fonts" },
}));

import {
  buildFont,
  signatureOnlyFont,
} from "@/lib/design/render/font-fixtures";
import { POST } from "./route";

function upload(file: File | null) {
  const body = new FormData();
  if (file) body.append("file", file);
  return new Request("http://x/api/upload", { method: "POST", body });
}

const png = (bytes = 10, type = "image/png") =>
  new File([new Uint8Array(bytes)], "logo.png", { type });

/* The 5MB cap and the png/jpeg/svg allowlist are the only thing standing
   between an authenticated user and arbitrary objects in a public-read bucket,
   and neither had a test. */
describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardWorkspaceRoute.mockResolvedValue({ ctx: { dbUser: { id: "u1" } } });
    isStorageConfigured.mockReturnValue(true);
    uploadObject.mockResolvedValue(undefined);
  });

  it("stores an allowed file under the caller's own prefix", async () => {
    const res = await POST(upload(png()));

    expect(res.status).toBe(200);
    const { url, key } = await res.json();
    expect(key).toMatch(/^logos\/u1\/\d+-[0-9a-f]{12}\.png$/);
    expect(url).toBe(`https://cdn.example.com/${key}`);
    expect(uploadObject).toHaveBeenCalledWith(
      expect.objectContaining({ key, contentType: "image/png" }),
    );
  });

  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/svg+xml", "svg"],
  ])("accepts %s with the right extension", async (type, ext) => {
    await POST(upload(png(10, type)));
    expect(uploadObject.mock.calls[0][0].key).toMatch(new RegExp(`\\.${ext}$`));
  });

  it.each([
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/html",
    "application/octet-stream",
    "",
  ])("refuses %j", async (type) => {
    const res = await POST(upload(png(10, type)));

    expect(res.status).toBe(400);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("refuses a file over 5MB", async () => {
    const res = await POST(upload(png(5 * 1024 * 1024 + 1)));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "File too large (max 5MB)." });
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at the cap", async () => {
    expect((await POST(upload(png(5 * 1024 * 1024)))).status).toBe(200);
  });

  it("refuses a request with no file", async () => {
    expect((await POST(upload(null))).status).toBe(400);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  /* Storage writes are workspace work: the guard keeps a removed member, or a
     future read-only role, from writing objects. */
  it("passes the guard's refusal straight through", async () => {
    guardWorkspaceRoute.mockResolvedValue({
      response: new Response(null, { status: 403 }),
    });
    expect((await POST(upload(png()))).status).toBe(403);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("asks for manage_content", async () => {
    await POST(upload(png()));
    expect(guardWorkspaceRoute).toHaveBeenCalledWith("manage_content");
  });

  it("503s when storage is not configured", async () => {
    isStorageConfigured.mockReturnValue(false);
    expect((await POST(upload(png()))).status).toBe(503);
  });

  it("gives each upload a distinct key", async () => {
    await POST(upload(png()));
    await POST(upload(png()));
    expect(uploadObject.mock.calls[0][0].key).not.toBe(
      uploadObject.mock.calls[1][0].key,
    );
  });
});

/* Fonts are validated from their bytes because a browser's MIME for a font
   file is unreliable and client-controlled either way — and in full, not by
   signature alone: a valid signature on a shredded body is accepted here and
   then fails every design the brand ever renders (KOS-V1-BUG-018). */
describe("POST /api/upload — fonts", () => {
  function fontFile(signature?: number[], type = "application/octet-stream") {
    const bytes = buildFont(signature ? { signature } : {});
    return new File([Buffer.from(bytes)], "brand.ttf", { type });
  }

  function corruptFile(bytes: Uint8Array, name = "brand.ttf") {
    return new File([Buffer.from(bytes)], name, { type: "font/ttf" });
  }

  function uploadFont(file: File) {
    const body = new FormData();
    body.append("file", file);
    body.append("kind", "font");
    return new Request("http://x/api/upload", { method: "POST", body });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    guardWorkspaceRoute.mockResolvedValue({ ctx: { dbUser: { id: "u1" } } });
    isStorageConfigured.mockReturnValue(true);
    uploadObject.mockResolvedValue(undefined);
  });

  it.each([
    ["TrueType", [0x00, 0x01, 0x00, 0x00], "ttf"],
    ["'true' TrueType", [0x74, 0x72, 0x75, 0x65], "ttf"],
    ["CFF OpenType", [0x4f, 0x54, 0x54, 0x4f], "otf"],
  ])("accepts %s under the fonts prefix", async (_l, sig, ext) => {
    const res = await POST(uploadFont(fontFile(sig)));

    expect(res.status).toBe(200);
    const { key } = await res.json();
    expect(key).toMatch(new RegExp(`^fonts/u1/\\d+-[0-9a-f]{12}\\.${ext}$`));
  });

  /* Satori rejects both outright, so accepting them would store a file that
     can only ever fail at render time. */
  it.each([
    ["WOFF", [0x77, 0x4f, 0x46, 0x46]],
    ["WOFF2", [0x77, 0x4f, 0x46, 0x32]],
    ["a TrueType collection", [0x74, 0x74, 0x63, 0x66]],
  ])("refuses %s, which satori cannot render", async (_l, sig) => {
    const res = await POST(uploadFont(fontFile(sig)));

    expect(res.status).toBe(400);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  /* The defect: each of these carries a signature the old four-byte check
     accepted, and throws inside satori once stored. Refused here, while the
     user is still looking at the file picker and the message can name it. */
  it.each([
    ["a body of zeros", signatureOnlyFont()],
    ["a half-finished upload", buildFont({ truncateTo: 220 })],
    ["a shredded header", buildFont({ truncateTo: 40 })],
  ])("refuses %s and names the file", async (_l, bytes) => {
    const res = await POST(uploadFont(corruptFile(bytes, "Acme Display.ttf")));

    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain("Acme Display.ttf");
    expect(error).toMatch(/can't be used/);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  /* A name is attacker-supplied and echoed straight back into the UI. */
  it("clamps an absurd filename out of the message", async () => {
    const res = await POST(
      uploadFont(corruptFile(signatureOnlyFont(), "z".repeat(500))),
    );

    expect((await res.json()).error.length).toBeLessThan(300);
  });

  /* The whole point of checking bytes: a PNG announcing itself as a font gets
     nowhere. */
  it("refuses a non-font wearing a font MIME type", async () => {
    const res = await POST(
      uploadFont(fontFile([0x89, 0x50, 0x4e, 0x47], "font/ttf")),
    );

    expect(res.status).toBe(400);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("accepts a real font despite an empty MIME type", async () => {
    const res = await POST(uploadFont(fontFile(undefined, "")));
    expect(res.status).toBe(200);
  });

  /* The client's type is frequently wrong for fonts, and the signature already
     settled what this is. */
  it("stores its own content type rather than the client's", async () => {
    await POST(uploadFont(fontFile(undefined, "text/plain")));
    expect(uploadObject.mock.calls[0][0].contentType).toBe("font/sfnt");
  });

  it("still enforces the size cap", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(buildFont(), 0);
    const res = await POST(
      uploadFont(new File([big], "brand.ttf", { type: "font/ttf" })),
    );
    expect(res.status).toBe(400);
  });

  /* An image upload must not start passing signature validation instead. */
  it("leaves image uploads on the MIME allowlist", async () => {
    const body = new FormData();
    body.append("file", fontFile(undefined, "font/ttf"));
    const res = await POST(
      new Request("http://x/api/upload", { method: "POST", body }),
    );
    expect(res.status).toBe(400);
  });
});

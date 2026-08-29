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
  STORAGE_PREFIXES: { logos: "logos" },
}));

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

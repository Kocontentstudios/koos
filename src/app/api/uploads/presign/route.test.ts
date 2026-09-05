import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const checkRateLimit = vi.fn();
const getSignedUploadUrl = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (...a: unknown[]) => checkBrandAccess(...a),
}));
vi.mock("@/lib/rate-limit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/rate-limit")>(
      "@/lib/rate-limit",
    );
  return { ...actual, checkRateLimit: (p: unknown) => checkRateLimit(p) };
});
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  isStorageConfigured: () => true,
  getSignedUploadUrl: (k: string, m: string) => getSignedUploadUrl(k, m),
}));

import { POST } from "./route";

const USER = "11111111-1111-1111-1111-111111111111";
const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";

const PDF = "application/pdf";
const PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function call(body: Record<string, unknown>) {
  return POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ brandId: BRAND, ...body }),
    }),
  );
}

async function keyFrom(res: Response): Promise<string> {
  return ((await res.json()) as { key: string }).key;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ dbUser: { id: USER, role: "user" } });
  checkBrandAccess.mockResolvedValue({ ok: true });
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
  getSignedUploadUrl.mockResolvedValue("https://r2.example/put");
});

describe("who may presign", () => {
  it("refuses an anonymous caller", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await call({
      fileName: "a.png",
      mimeType: "image/png",
      sizeBytes: 10,
    });
    expect(res.status).toBe(401);
  });

  it("refuses someone without access to the brand", async () => {
    checkBrandAccess.mockResolvedValue({ ok: false, error: "No", status: 403 });
    const res = await call({
      fileName: "a.png",
      mimeType: "image/png",
      sizeBytes: 10,
    });
    expect(res.status).toBe(403);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });
});

/* The two kinds are different allow-lists, different caps and different key
   prefixes. Sharing any of the three breaks the other feature. */
describe("attachments and documents are presigned differently", () => {
  it("keeps attachments on the reference-images prefix", async () => {
    const res = await call({
      fileName: "logo.png",
      mimeType: "image/png",
      sizeBytes: 1000,
    });
    expect(res.status).toBe(200);
    expect(await keyFrom(res)).toMatch(
      new RegExp(`^reference-images/${USER}/`),
    );
  });

  /* The parse route reads bytes by key and pins THIS prefix. A document landing
     under reference-images would be refused by its own parser. */
  it("puts documents under the brand-docs prefix", async () => {
    const res = await call({
      fileName: "guidelines.pdf",
      mimeType: PDF,
      sizeBytes: 1000,
      kind: "document",
    });
    expect(res.status).toBe(200);
    expect(await keyFrom(res)).toMatch(new RegExp(`^brand-docs/${USER}/`));
  });

  it("keeps the file's extension on the key", async () => {
    const res = await call({
      fileName: "deck.pptx",
      mimeType: PPTX,
      sizeBytes: 1000,
      kind: "document",
    });
    expect(await keyFrom(res)).toMatch(/\.pptx$/);
  });

  /* Existing callers do not send `kind`. If the default flipped, every design
     attachment would be judged against the document allow-list and images
     would stop uploading. */
  it("treats an unspecified kind as an attachment", async () => {
    const res = await call({
      fileName: "logo.png",
      mimeType: "image/png",
      sizeBytes: 1000,
    });
    expect(res.status).toBe(200);
    expect(await keyFrom(res)).toContain("reference-images/");
  });
});

describe("each kind uses its own allow-list", () => {
  /* A .pptx is not in the attachment allow-list; asking for one WITHOUT
     kind:"document" must still be refused. */
  it("refuses a document type on the attachment path", async () => {
    const res = await call({
      fileName: "deck.pptx",
      mimeType: PPTX,
      sizeBytes: 1000,
    });
    expect(res.status).toBe(400);
  });

  it("accepts that same file as a document", async () => {
    const res = await call({
      fileName: "deck.pptx",
      mimeType: PPTX,
      sizeBytes: 1000,
      kind: "document",
    });
    expect(res.status).toBe(200);
  });

  /* An image is a valid attachment and NOT a valid brand document. */
  it("refuses an image on the document path", async () => {
    const res = await call({
      fileName: "logo.png",
      mimeType: "image/png",
      sizeBytes: 1000,
      kind: "document",
    });
    expect(res.status).toBe(400);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("names what it does accept when it refuses a document", async () => {
    const res = await call({
      fileName: "sheet.xlsx",
      mimeType: "application/vnd.ms-excel",
      sizeBytes: 1000,
      kind: "document",
    });
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/PDF, DOCX, PPTX or TXT/i);
  });
});

/* A document is capped at 25MB, well below the 100MB an attachment may be. */
describe("the document size cap", () => {
  const MB = 1024 * 1024;

  it("refuses a document over 25MB", async () => {
    const res = await call({
      fileName: "huge.pdf",
      mimeType: PDF,
      sizeBytes: 26 * MB,
      kind: "document",
    });
    expect(res.status).toBe(400);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("accepts a document just under the cap", async () => {
    const res = await call({
      fileName: "big.pdf",
      mimeType: PDF,
      sizeBytes: 24 * MB,
      kind: "document",
    });
    expect(res.status).toBe(200);
  });

  /* The document cap must not leak onto attachments, which legitimately carry
     video and deliverable zips. */
  it("still allows an attachment far above the document cap", async () => {
    const res = await call({
      fileName: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 60 * MB,
    });
    expect(res.status).toBe(200);
  });
});

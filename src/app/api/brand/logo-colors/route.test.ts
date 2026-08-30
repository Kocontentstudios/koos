import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const getObjectBytes = vi.fn();
const extractLogoColors = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (u: string, b: string, c: string) =>
    checkBrandAccess(u, b, c),
}));
/* Only the bucket read is mocked. storageKeyFrom is the guard these tests
   exist to exercise, so it runs for real. */
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (key: string) => getObjectBytes(key),
}));
vi.mock("@/lib/ai/logo-colors", () => ({
  extractLogoColors: (i: unknown) => extractLogoColors(i),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true, retryAfterSeconds: 0 }),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));

import { POST } from "./route";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const BASE = "https://cdn.example.com";
const LOGO = `${BASE}/logos/u1/logo.png`;

const post = (body: unknown) =>
  new Request("http://x/api/brand/logo-colors", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST /api/brand/logo-colors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.R2_PUBLIC_BASE_URL = BASE;
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: BRAND_ID } });
    getObjectBytes.mockResolvedValue(Buffer.from([1, 2, 3]));
    extractLogoColors.mockResolvedValue({
      primary: "#3A2A1F",
      secondary: null,
      accents: [],
    });
  });

  it("returns the palette read from the logo", async () => {
    const res = await POST(post({ brandId: BRAND_ID, logoUrl: LOGO }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      palette: { primary: "#3A2A1F", secondary: null, accents: [] },
    });
  });

  /* The logo is read out of our own bucket by key. logoUrl comes from the
     client, so following it verbatim would make this a request-forgery
     gadget pointed at anything the server can reach. */
  it("reads the object by key rather than fetching the URL", async () => {
    await POST(post({ brandId: BRAND_ID, logoUrl: LOGO }));
    expect(getObjectBytes).toHaveBeenCalledWith("logos/u1/logo.png");
  });

  it.each([
    ["another origin", "https://evil.example.com/logos/u1/logo.png"],
    ["a local address", "http://169.254.169.254/latest/meta-data/"],
    ["a file path", "file:///etc/passwd"],
    ["nonsense", "not-a-url"],
    // A host that merely begins with ours — the substring bypass.
    ["a lookalike host", `${BASE}.attacker.test/logos/u1/logo.png`],
    // Matching the origin alone would let this read another tenant's artwork.
    ["a key outside the logos prefix", `${BASE}/deliverables/other/final.png`],
  ])("refuses %s", async (_label, logoUrl) => {
    const res = await POST(post({ brandId: BRAND_ID, logoUrl }));

    expect(res.status).toBe(400);
    expect(getObjectBytes).not.toHaveBeenCalled();
    expect(extractLogoColors).not.toHaveBeenCalled();
  });

  it("refuses a missing logo", async () => {
    expect((await POST(post({ brandId: BRAND_ID }))).status).toBe(400);
  });

  it("requires a session", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect(
      (await POST(post({ brandId: BRAND_ID, logoUrl: LOGO }))).status,
    ).toBe(401);
  });

  it.each(["", "not-a-uuid"])("rejects brandId %j", async (brandId) => {
    expect((await POST(post({ brandId, logoUrl: LOGO }))).status).toBe(400);
    expect(checkBrandAccess).not.toHaveBeenCalled();
  });

  it("refuses a brand the caller cannot manage", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    expect(
      (await POST(post({ brandId: BRAND_ID, logoUrl: LOGO }))).status,
    ).toBe(403);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("404s when the object cannot be read", async () => {
    getObjectBytes.mockRejectedValue(new Error("no such key"));
    expect(
      (await POST(post({ brandId: BRAND_ID, logoUrl: LOGO }))).status,
    ).toBe(404);
  });

  it("rejects a malformed body", async () => {
    const res = await POST(
      new Request("http://x/api/brand/logo-colors", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  /* Extraction never throws — an empty palette is a valid answer and the user
     types the hexes instead. */
  it("returns an empty palette rather than an error when nothing is found", async () => {
    extractLogoColors.mockResolvedValue({
      primary: null,
      secondary: null,
      accents: [],
    });
    const res = await POST(post({ brandId: BRAND_ID, logoUrl: LOGO }));

    expect(res.status).toBe(200);
    expect((await res.json()).palette.primary).toBeNull();
  });
});

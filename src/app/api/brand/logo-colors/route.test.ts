import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const checkRateLimit = vi.fn();
const getObjectBytes = vi.fn();
const extractLogoColors = vi.fn();
const rasterizeSvg = vi.fn();

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
  getObjectBytes: (key: string) => getObjectBytes(key),
}));
vi.mock("@/lib/ai/logo-colors", () => ({
  extractLogoColors: (img: unknown) => extractLogoColors(img),
}));
vi.mock("@/lib/images/rasterize", () => ({
  rasterizeSvg: (bytes: Uint8Array) => rasterizeSvg(bytes),
}));

import { POST } from "./route";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const BASE = "https://cdn.example.com";
const LOGO_URL = `${BASE}/logos/u1/logo.png`;

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="x"><rect/></svg>');

const call = (logoUrl: string = LOGO_URL) =>
  POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ brandId: BRAND, logoUrl }),
    }),
  );

const sentImage = () =>
  extractLogoColors.mock.calls[0]?.[0] as {
    bytes: Uint8Array;
    contentType: string;
  };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.R2_PUBLIC_BASE_URL = BASE;
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1", role: "user" } });
  checkBrandAccess.mockResolvedValue({ ok: true });
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
  getObjectBytes.mockResolvedValue(Buffer.from(PNG));
  rasterizeSvg.mockResolvedValue(PNG);
  extractLogoColors.mockResolvedValue({
    primary: "#228B22",
    secondary: "#FFFDD0",
    accents: [],
    failed: false,
  });
});

/* The type is read from the BYTES. The route used to declare every logo as
   image/png regardless of what it actually was, and the model rejects the
   request outright when the declared type does not match what it decodes. */
describe("the declared type matches the bytes", () => {
  it("sends a PNG as image/png", async () => {
    await call();
    expect(sentImage().contentType).toBe("image/png");
  });

  it("sends a JPEG as image/jpeg, not image/png", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(JPEG));
    await call();
    expect(sentImage().contentType).toBe("image/jpeg");
  });

  it("refuses a file that is not an image at all", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from("just some text"));
    const res = await call();
    expect(res.status).toBe(415);
    expect(extractLogoColors).not.toHaveBeenCalled();
  });
});

/* The bug itself. /api/upload accepts image/svg+xml for logos, and vision
   rejects SVG in every form — so "Pick from logo" returned nothing for
   exactly the brands most likely to own a vector logo. */
describe("an SVG logo is rasterised before it is read", () => {
  beforeEach(() => getObjectBytes.mockResolvedValue(Buffer.from(SVG)));

  it("rasterises rather than sending the SVG on", async () => {
    await call();
    expect(rasterizeSvg).toHaveBeenCalled();
    expect(sentImage().contentType).toBe("image/png");
  });

  it("sends the rasterised bytes, not the original", async () => {
    const raster = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    rasterizeSvg.mockResolvedValue(raster);
    await call();
    expect(sentImage().bytes).toBe(raster);
  });

  it("never declares image/svg+xml, which the SDK refuses outright", async () => {
    await call();
    expect(sentImage().contentType).not.toContain("svg");
  });

  /* A failed rasterisation is a real error the user can act on, not another
     silent empty palette. */
  it("reports a rasterisation failure instead of returning nothing", async () => {
    rasterizeSvg.mockRejectedValue(new Error("resvg exploded"));
    const res = await call();
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/svg/i);
    expect(extractLogoColors).not.toHaveBeenCalled();
  });

  it("does not rasterise a raster format", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));
    await call();
    expect(rasterizeSvg).not.toHaveBeenCalled();
  });
});

describe("the palette says whether it failed", () => {
  it("passes the failed flag through to the client", async () => {
    extractLogoColors.mockResolvedValue({
      primary: null,
      secondary: null,
      accents: [],
      failed: true,
    });
    const body = (await (await call()).json()) as {
      palette: { failed: boolean };
    };
    expect(body.palette.failed).toBe(true);
  });
});

/* The logo is read out of our own bucket BY KEY. Following a caller-supplied
   URL would make this a server-side request forgery gadget. */
describe("the logo URL is not followed", () => {
  it.each([
    ["an external origin", "https://evil.example.com/logos/u1/a.png"],
    ["another storage prefix", `${BASE}/deliverables/u1/secret.png`],
    ["a traversal", `${BASE}/logos/../deliverables/secret.png`],
    ["not a url at all", "logos/u1/a.png"],
  ])("refuses %s", async (_label, url) => {
    const res = await call(url);
    expect(res.status).toBe(400);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await call()).status).toBe(401);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("refuses someone without access to the brand", async () => {
    checkBrandAccess.mockResolvedValue({ ok: false, error: "No", status: 403 });
    expect((await call()).status).toBe(403);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("rate limits, because each call is a vision call", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    expect((await call()).status).toBe(429);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("404s when the object is missing", async () => {
    getObjectBytes.mockRejectedValue(new Error("no such key"));
    expect((await call()).status).toBe(404);
  });
});

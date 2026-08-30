// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();
/* Only the bucket read is mocked. storageKeyFrom is the guard these tests
   exist to exercise, so it runs for real. */
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (key: string) => getObjectBytes(key),
}));

import { __resetFontCaches, isRenderableFont, loadBrandFonts } from "./fonts";

const BASE = "https://cdn.example.com";
const FONT_URL = `${BASE}/fonts/u1/brand.ttf`;

/** A buffer that opens with a signature satori accepts. */
function fontBytes(signature: number[]) {
  const bytes = new Uint8Array(64);
  bytes.set(signature, 0);
  return Buffer.from(bytes);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetFontCaches();
  process.env.R2_PUBLIC_BASE_URL = BASE;
});

afterEach(() => {
  __resetFontCaches();
});

describe("isRenderableFont", () => {
  it.each([
    ["TrueType", [0x00, 0x01, 0x00, 0x00]],
    ["a 'true' TrueType", [0x74, 0x72, 0x75, 0x65]],
    ["CFF OpenType", [0x4f, 0x54, 0x54, 0x4f]],
    ["a TrueType collection", [0x74, 0x74, 0x63, 0x66]],
  ])("accepts %s", (_label, signature) => {
    expect(isRenderableFont(new Uint8Array(signature))).toBe(true);
  });

  /* Satori rejects both with "Unsupported OpenType signature", so they must
     never reach it. */
  it.each([
    ["WOFF", [0x77, 0x4f, 0x46, 0x46]],
    ["WOFF2", [0x77, 0x4f, 0x46, 0x32]],
    ["a PNG", [0x89, 0x50, 0x4e, 0x47]],
    ["nothing", [0x00, 0x00, 0x00, 0x00]],
  ])("rejects %s", (_label, signature) => {
    expect(isRenderableFont(new Uint8Array(signature))).toBe(false);
  });
});

describe("loadBrandFonts", () => {
  it("uses the built-in families when the brand has no font", async () => {
    const fonts = await loadBrandFonts();

    expect(fonts.map((f) => f.name)).toContain("Display");
    expect(fonts.map((f) => f.name)).toContain("Body");
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("substitutes the uploaded face for the display family", async () => {
    getObjectBytes.mockResolvedValue(fontBytes([0x00, 0x01, 0x00, 0x00]));

    const fonts = await loadBrandFonts(FONT_URL);
    const display = fonts.filter((f) => f.name === "Display");

    expect(getObjectBytes).toHaveBeenCalledWith("fonts/u1/brand.ttf");
    expect(display).toHaveLength(1);
    // Body keeps its two weights, so the hierarchy the layouts rely on stands.
    expect(fonts.filter((f) => f.name === "Body")).toHaveLength(2);
  });

  /* A bad or missing font must cost the typeface, never the design. */
  it("falls back to the built-ins when the file is unreadable", async () => {
    getObjectBytes.mockRejectedValue(new Error("no such key"));

    const fonts = await loadBrandFonts(FONT_URL);
    expect(fonts.filter((f) => f.name === "Display")).toHaveLength(1);
    expect(fonts.length).toBeGreaterThan(1);
  });

  it("falls back when the file is not a font satori can parse", async () => {
    getObjectBytes.mockResolvedValue(fontBytes([0x77, 0x4f, 0x46, 0x32]));

    const fonts = await loadBrandFonts(FONT_URL);
    expect(fonts.filter((f) => f.name === "Display")).toHaveLength(1);
  });

  /* The brand row is user-writable, so the URL in it is not a fetch target. */
  it("refuses a URL outside our own storage", async () => {
    const fonts = await loadBrandFonts("https://evil.example.com/font.ttf");

    expect(getObjectBytes).not.toHaveBeenCalled();
    expect(fonts.filter((f) => f.name === "Display")).toHaveLength(1);
  });

  it("reads each font once and serves the rest from cache", async () => {
    getObjectBytes.mockResolvedValue(fontBytes([0x4f, 0x54, 0x54, 0x4f]));

    await loadBrandFonts(FONT_URL);
    await loadBrandFonts(FONT_URL);

    expect(getObjectBytes).toHaveBeenCalledTimes(1);
  });

  /* The cache is keyed rather than shared: one brand's face must never be
     served to another rendering at the same time. */
  it("keeps separate brands' fonts apart", async () => {
    getObjectBytes.mockImplementation(async (key: string) =>
      key.includes("good")
        ? fontBytes([0x00, 0x01, 0x00, 0x00])
        : fontBytes([0x77, 0x4f, 0x46, 0x32]),
    );

    const good = await loadBrandFonts(`${BASE}/fonts/u1/good.ttf`);
    const bad = await loadBrandFonts(`${BASE}/fonts/u2/bad.ttf`);

    expect(getObjectBytes).toHaveBeenCalledTimes(2);
    // Both render; only one is wearing the brand's own face.
    expect(good.filter((f) => f.name === "Display")).toHaveLength(1);
    expect(bad.filter((f) => f.name === "Display")).toHaveLength(1);
  });

  it("remembers a failure so a broken font is not re-fetched every render", async () => {
    getObjectBytes.mockRejectedValue(new Error("gone"));

    await loadBrandFonts(FONT_URL);
    await loadBrandFonts(FONT_URL);

    expect(getObjectBytes).toHaveBeenCalledTimes(1);
  });
});

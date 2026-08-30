// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();
vi.mock("@/lib/storage", () => ({
  getObjectBytes: (key: string) => getObjectBytes(key),
}));

import type { DesignSpec } from "@/lib/design/spec";
import { renderCompositeDesign } from "./composite";
import { __resetFontCaches, loadBrandFonts } from "./fonts";

const SPEC: DesignSpec = {
  layout: "hero-center",
  headline: "Lagos Launch Week",
  subheadline: "Free delivery for the first three days",
  cta: "Order now",
  palette: { background: "#0F172A", foreground: "#FFFFFF", accent: "#F97316" },
  logoPlacement: "bottom-right",
  backgroundPrompt: "warm city skyline at dusk",
  backgroundTreatment: "photographic",
  nativePrompt: "unused in the composite route",
  aspectRatio: "4:5",
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const BASE = "https://cdn.example.com";
const FONT_URL = `${BASE}/fonts/u1/brand.ttf`;

function render(brandFontUrl?: string | null) {
  return renderCompositeDesign({
    spec: SPEC,
    brand: { primaryColor: "#0F172A", brandFontUrl },
    plate: null,
    logo: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetFontCaches();
  process.env.R2_PUBLIC_BASE_URL = BASE;
});

afterEach(() => __resetFontCaches());

/* The point of the feature is that an uploaded face reaches satori. These
   render real PNGs rather than asserting on the font list, because the failure
   that matters is satori throwing on bytes it cannot parse. */
describe("renderCompositeDesign with a brand font", () => {
  it("renders a real PNG using an uploaded face", async () => {
    // Real, parseable font bytes: the display family the renderer already
    // loads, fed back in as though the brand had uploaded it. Avoids
    // committing a font fixture just to prove the path works.
    const [display] = (await loadBrandFonts()).filter(
      (f) => f.name === "Display",
    );
    expect(display).toBeTruthy();
    __resetFontCaches();
    getObjectBytes.mockResolvedValue(Buffer.from(display.data));

    const result = await render(FONT_URL);

    expect(getObjectBytes).toHaveBeenCalledWith("fonts/u1/brand.ttf");
    expect(Array.from(result.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
    expect(result.bytes.byteLength).toBeGreaterThan(5000);
  }, 120_000);

  /* The whole reason for the fallback: a brand row can outlive the file it
     points at, and a design must still come out. */
  it("still renders when the uploaded font has gone missing", async () => {
    getObjectBytes.mockRejectedValue(new Error("no such key"));

    const result = await render(FONT_URL);

    expect(Array.from(result.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
    expect(result.bytes.byteLength).toBeGreaterThan(5000);
  }, 120_000);

  it("still renders when the stored file is not a usable font", async () => {
    // A WOFF2 signature — satori rejects it outright.
    getObjectBytes.mockResolvedValue(
      Buffer.from(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0])),
    );

    const result = await render(FONT_URL);

    expect(Array.from(result.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
  }, 120_000);

  it("renders normally for a brand with no font of its own", async () => {
    const result = await render(null);

    expect(getObjectBytes).not.toHaveBeenCalled();
    expect(Array.from(result.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
  }, 120_000);
});

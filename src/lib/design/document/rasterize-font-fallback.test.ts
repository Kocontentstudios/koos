// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (key: string) => getObjectBytes(key),
}));

const arrayBuffer = vi.fn();
/* What is under test is what rasterizeDocument does when a render throws,
   which the real renderer will not do on demand. */
vi.mock("next/og", () => ({
  ImageResponse: class {
    arrayBuffer() {
      return arrayBuffer();
    }
  },
}));

import {
  buildFont,
  signatureOnlyFont,
} from "@/lib/design/render/font-fixtures";
import { __resetFontCaches } from "@/lib/design/render/fonts";
import { rasterizeDocument } from "./rasterize";
import type { DesignDocument } from "./schema";

const BASE = "https://cdn.example.com";
const FONT_URL = `${BASE}/fonts/u1/brand.ttf`;

const DOC: DesignDocument = {
  version: 1,
  width: 1080,
  height: 1080,
  background: "#123456",
  elements: [
    {
      id: "headline",
      name: "Headline",
      type: "text",
      x: 86,
      y: 400,
      width: 908,
      height: 120,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
      text: "Launch day",
      role: "headline",
      font: "heading",
      fontSize: 100,
      fontWeight: 700,
      lineHeight: 1.05,
      letterSpacing: 0,
      align: "center",
      italic: false,
      color: "#FFFFFF",
    },
  ],
};

const render = (heading: string | null) =>
  rasterizeDocument({
    doc: DOC,
    assets: {},
    brand: { heading, body: null },
  });

beforeEach(() => {
  vi.clearAllMocks();
  __resetFontCaches();
  process.env.R2_PUBLIC_BASE_URL = BASE;
  arrayBuffer.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
});

afterEach(() => {
  __resetFontCaches();
});

/* The composite's KOS-V1-BUG-018 guarantees, held for documents too: they
   share one rasterizer, and these pin that sharing. */
describe("rasterizeDocument with a brand font that cannot be used", () => {
  it("renders once and reports nothing for a good face", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(buildFont()));
    const result = await render(FONT_URL);
    expect(result.brandFontFault).toBeNull();
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("reports a stored font declined before it reached the renderer", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(signatureOnlyFont()));
    const result = await render(FONT_URL);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(result.brandFontFault).toMatch(/no font tables/);
  });

  it("re-renders in the bundled faces when satori refuses the brand face", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(buildFont()));
    arrayBuffer
      .mockRejectedValueOnce(new Error("lookupType: 7 is not yet supported"))
      .mockResolvedValueOnce(new Uint8Array([9, 9]).buffer);

    const result = await render(FONT_URL);
    expect(arrayBuffer).toHaveBeenCalledTimes(2);
    expect(Array.from(result.bytes)).toEqual([9, 9]);
    expect(result.brandFontFault).toBe("the design renderer could not use it");
  });

  it("does not retry, or blame the font, when no brand face was used", async () => {
    arrayBuffer.mockRejectedValue(new Error("resvg exploded"));
    await expect(render(null)).rejects.toThrow("resvg exploded");
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("rethrows the original error when the retry fails as well", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(buildFont()));
    arrayBuffer
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"));
    await expect(render(FONT_URL)).rejects.toThrow("first failure");
  });

  it("pays for a refused face once, not on every pass of a two-pass render", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(buildFont()));
    arrayBuffer
      .mockRejectedValueOnce(new Error("lookupType: 7 is not yet supported"))
      .mockResolvedValue(new Uint8Array([9, 9]).buffer);
    const result = await rasterizeDocument({
      doc: {
        ...DOC,
        elements: [
          ...DOC.elements,
          {
            id: "logo",
            name: "Logo",
            type: "logo",
            x: 760,
            y: 86,
            width: 234,
            height: 50,
            rotation: 0,
            opacity: 1,
            hidden: false,
            locked: false,
            asset: { key: "logos/u1/mark.png" },
            backing: null,
          },
        ],
      },
      assets: {
        "logos/u1/mark.png": {
          bytes: new Uint8Array([1]),
          contentType: "image/png",
        },
      },
      brand: { heading: FONT_URL, body: null },
      logoInk: { "logos/u1/mark.png": { darkest: 0, lightest: 0 } },
    });
    /* Ground pass: refused, then redrawn in the bundled faces. Final pass:
       the bundled faces straight away. */
    expect(arrayBuffer).toHaveBeenCalledTimes(3);
    expect(result.brandFontFault).toBe("the design renderer could not use it");
  });
});

/* The composite and the document share one rasterizer (render/rasterize.ts,
   must-fix 4): the same refused face is reported in the same words by both. */
describe("renderCompositeDesign with a brand font satori refuses", () => {
  it("falls back exactly as the document does", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(buildFont()));
    arrayBuffer
      .mockRejectedValueOnce(new Error("lookupType: 7 is not yet supported"))
      .mockResolvedValue(new Uint8Array([9, 9]).buffer);
    const { renderCompositeDesign } = await import(
      "@/lib/design/render/composite"
    );
    const result = await renderCompositeDesign({
      spec: {
        layout: "hero-center",
        headline: "Launch day",
        palette: {
          background: "#123456",
          foreground: "#FFFFFF",
          accent: "#F97316",
        },
        logoPlacement: "none",
        logoFree: true,
        logoFreeQuote: "",
        backgroundPrompt: "unused",
        backgroundTreatment: "photographic",
        nativePrompt: "unused",
        aspectRatio: "1:1",
        footerStyle: "none",
        footerLines: [],
      },
      brand: { brandFontUrl: FONT_URL },
      plate: null,
      logo: null,
    });
    expect(arrayBuffer).toHaveBeenCalledTimes(2);
    expect(result.brandFontFault).toBe("the design renderer could not use it");
  });
});

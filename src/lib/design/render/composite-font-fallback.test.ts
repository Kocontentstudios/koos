// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (key: string) => getObjectBytes(key),
}));

const arrayBuffer = vi.fn();
/* satori and resvg are the thing under test's dependency, not the thing under
   test: what matters here is what renderCompositeDesign does when a render
   throws, which a real renderer will not do on demand. */
vi.mock("next/og", () => ({
  ImageResponse: class {
    arrayBuffer() {
      return arrayBuffer();
    }
  },
}));

const readVendoredFace = vi.fn();
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = actual.readFile as (...args: unknown[]) => unknown;
  return {
    ...actual,
    readFile: (target: unknown, ...rest: unknown[]) =>
      typeof target === "string" && target.startsWith(FONT_DIR)
        ? readVendoredFace(target)
        : readFile(target, ...rest),
  };
});

import type { DesignSpec } from "@/lib/design/spec";
import { renderCompositeDesign } from "./composite";
import { buildFont, signatureOnlyFont } from "./font-fixtures";
import { __resetFontCaches, FONT_DIR } from "./fonts";

const BASE = "https://cdn.example.com";
const FONT_URL = `${BASE}/fonts/u1/brand.ttf`;

const SPEC = {
  aspectRatio: "1:1",
  headline: "Launch day",
  palette: "brand",
  layout: "centered",
} as unknown as DesignSpec;

const brandWith = (fontUrl: string | null) => ({
  primaryColor: "#123456",
  secondaryColor: "#654321",
  brandFontUrl: fontUrl,
  bodyFontUrl: null,
});

const render = (fontUrl: string | null) =>
  renderCompositeDesign({
    spec: SPEC,
    brand: brandWith(fontUrl),
    plate: null,
    logo: null,
  });

beforeEach(() => {
  vi.clearAllMocks();
  __resetFontCaches();
  process.env.R2_PUBLIC_BASE_URL = BASE;
  readVendoredFace.mockImplementation(async () => Buffer.from(buildFont()));
  arrayBuffer.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
});

afterEach(() => {
  __resetFontCaches();
});

/* KOS-V1-BUG-018. A brand font that cannot be used must cost the typeface and
   nothing else — not the design, and not the user's understanding of why their
   typeface never appears. Both halves are asserted here because the fallback
   is the load-bearing part of the fix: a structural check cannot predict every
   face satori refuses. */
describe("a brand font that cannot be used", () => {
  it("renders normally and reports no fault when the face is good", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(buildFont()));

    const result = await render(FONT_URL);

    expect(result.brandFontFault).toBeNull();
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  /* The ticket's own repro. The bytes are declined while being read, so satori
     never throws and the render succeeds first time — which is exactly why
     this needs reporting: nothing else about the result says the font was
     dropped, and it will be dropped again on every future generation. */
  it("reports the fault for a stored font that never reaches the renderer", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(signatureOnlyFont()));

    const result = await render(FONT_URL);

    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(result.brandFontFault).toMatch(/no font tables/);
  });

  /* A bucket blip says nothing about the font, so it must not be reported:
     telling a user their intact font is damaged, on every generation, is
     worse than saying nothing. The next render retries. */
  it("stays quiet when the file merely could not be read", async () => {
    getObjectBytes.mockRejectedValue(new Error("no such key"));

    expect((await render(FONT_URL)).brandFontFault).toBeNull();
  });

  /* The URL is a user-writable column, so a font pointing outside our own
     storage is refused — and the refusal has to carry a reason, because an
     empty one silently cancels the notification downstream. */
  it("reports a reason for a font stored outside our own bucket", async () => {
    const result = await renderCompositeDesign({
      spec: SPEC,
      brand: { ...brandWith("https://evil.example.com/font.ttf") },
      plate: null,
      logo: null,
    });

    expect(getObjectBytes).not.toHaveBeenCalled();
    expect(result.brandFontFault).toBeTruthy();
  });

  /* Both slots report, not just the heading one: a brand can upload a body
     face alone, and FEAT-020 made that a normal state rather than an edge. */
  it("reports a fault on the body slot as well as the heading slot", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(signatureOnlyFont()));

    const result = await renderCompositeDesign({
      spec: SPEC,
      brand: {
        primaryColor: "#123456",
        secondaryColor: "#654321",
        brandFontUrl: null,
        bodyFontUrl: FONT_URL,
      },
      plate: null,
      logo: null,
    });

    expect(result.brandFontFault).toMatch(/no font tables/);
  });

  /* Structure cannot predict an unsupported GSUB lookup or a variable-font
     axis table: 72 of 178 real fonts pass every table check and satori still
     refuses them. So the design is re-rendered without the brand face rather
     than lost. */
  it("re-renders with the bundled faces when satori refuses a valid face", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(buildFont()));
    arrayBuffer
      .mockRejectedValueOnce(new Error("lookupType: 7 is not yet supported"))
      .mockResolvedValueOnce(new Uint8Array([9, 9]).buffer);

    const result = await render(FONT_URL);

    expect(arrayBuffer).toHaveBeenCalledTimes(2);
    expect(Array.from(result.bytes)).toEqual([9, 9]);
    expect(result.brandFontFault).toBe("the design renderer could not use it");
  });

  /* satori's internals are not an explanation. Pasting them into the bell
     tells the user "Cannot read properties of undefined (reading '257')". */
  it("never surfaces the renderer's own exception text", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(buildFont()));
    arrayBuffer
      .mockRejectedValueOnce(
        new Error("Cannot read properties of undefined (reading '257')"),
      )
      .mockResolvedValueOnce(new Uint8Array([1]).buffer);

    const fault = (await render(FONT_URL)).brandFontFault ?? "";
    expect(fault).not.toMatch(/undefined|properties|257/);
  });

  /* A render that fails on the bundled faces alone is a renderer fault, and
     blaming the brand's font for it would send the user to replace a file that
     was never the problem. */
  it("does not retry, or blame the font, when no brand face was used", async () => {
    arrayBuffer.mockRejectedValue(new Error("resvg exploded"));

    await expect(render(null)).rejects.toThrow("resvg exploded");
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  /* The retry exists to save the design, not to hide a broken renderer: when
     it fails too, the ORIGINAL error is what gets reported. */
  it("rethrows the original error when the retry fails as well", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(buildFont()));
    arrayBuffer
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second, less useful failure"));

    await expect(render(FONT_URL)).rejects.toThrow("first failure");
    expect(arrayBuffer).toHaveBeenCalledTimes(2);
  });
});

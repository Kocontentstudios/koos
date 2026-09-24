// @vitest-environment node
import { describe, expect, it } from "vitest";
import { logoPng, SQUARE_MARK, WORDMARK } from "./logo-fixtures";
import { probeLogo } from "./logo-probe";

const png = (bytes: Uint8Array) => ({ bytes, contentType: "image/png" });

/**
 * The blocker this module exists for: resvg does not throw on an image node it
 * cannot decode. It skips the node and returns a valid PNG of everything else,
 * so the design renders, the logo is absent, and nothing anywhere knows.
 * Catching an exception was never going to work, because there is no
 * exception — the only honest test is to draw it and look.
 */
describe("probeLogo", () => {
  it("sees a real mark", async () => {
    const probe = await probeLogo(png(SQUARE_MARK()));
    expect(probe.drawable).toBe(true);
    expect(Number.isFinite(probe.darkest)).toBe(true);
    expect(Number.isFinite(probe.lightest)).toBe(true);
  }, 60_000);

  it("reads a light mark as light and a dark one as dark", async () => {
    const [light, dark] = await Promise.all([
      probeLogo(
        png(logoPng({ width: 128, height: 128, color: [250, 250, 250, 255] })),
      ),
      probeLogo(
        png(logoPng({ width: 128, height: 128, color: [10, 10, 12, 255] })),
      ),
    ]);
    expect(light.darkest).toBeGreaterThan(0.7);
    expect(dark.lightest).toBeLessThan(0.05);
  }, 60_000);

  /* Valid signature and IHDR, damaged IDAT — a partial upload, a bad byte
     range, a re-encode gone wrong. Every structural check passes. */
  it("catches a logo with a valid header and damaged data", async () => {
    const corrupt = new Uint8Array(SQUARE_MARK());
    for (let i = 60; i < Math.min(200, corrupt.length); i += 1) corrupt[i] = 0;

    expect((await probeLogo(png(corrupt))).drawable).toBe(false);
  }, 60_000);

  it("catches a truncated upload", async () => {
    expect((await probeLogo(png(SQUARE_MARK().slice(0, 40)))).drawable).toBe(
      false,
    );
  }, 60_000);

  it("catches bytes that are not an image at all", async () => {
    const text = new TextEncoder().encode("this was never a logo");
    expect((await probeLogo(png(text))).drawable).toBe(false);
  }, 60_000);

  /* A fully transparent file draws nothing and is nothing, however valid. */
  it("catches an entirely transparent mark", async () => {
    const blank = logoPng({ width: 128, height: 128, color: [0, 0, 0, 0] });
    expect((await probeLogo(png(blank))).drawable).toBe(false);
  }, 60_000);

  it("does not mistake a wide wordmark for an empty one", async () => {
    expect((await probeLogo(png(WORDMARK()))).drawable).toBe(true);
  }, 60_000);

  /* The first version of this module asked "did at least 1% of the frame get
     ink", which is not the same question. A very wide mark and a mark sitting
     inside a roomy artboard both draw perfectly and cover almost nothing, so
     the floor deleted real logos and told the user their file was damaged —
     the reported bug again, with a worse message. */
  it.each([
    ["20:1 wordmark", logoPng({ width: 1200, height: 60 })],
    ["40:1 wordmark", logoPng({ width: 2000, height: 50 })],
    ["1:20 vertical mark", logoPng({ width: 60, height: 1200 })],
    [
      "small mark on a large artboard",
      logoPng({
        width: 1000,
        height: 1000,
        shape: "block",
        transparentMargin: 460,
      }),
    ],
  ])(
    "accepts a %s",
    async (_label, bytes) => {
      const probe = await probeLogo(png(bytes));
      expect(probe.drawable).toBe(true);
      expect(Number.isFinite(probe.darkest)).toBe(true);
      expect(Number.isFinite(probe.lightest)).toBe(true);
    },
    60_000,
  );
});

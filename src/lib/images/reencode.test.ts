// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildJpeg, PNG_SIGNATURE, pngChunk } from "./image-fixtures";
import { reencodeImage, UndecodableImageError } from "./reencode";

const LIMITS = { maxInputPixels: 4096 * 4096 };

const solid = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp({
    create: {
      width,
      height,
      channels,
      background: { r: 200, g: 60, b: 20, alpha: 1 },
    },
  });

async function refusal(promise: Promise<unknown>) {
  const err = await promise.catch((e: unknown) => e);
  if (!(err instanceof UndecodableImageError)) {
    throw new Error(`expected an UndecodableImageError, got ${String(err)}`);
  }
  return err;
}

describe("reencodeImage", () => {
  it("writes a PNG as a fresh 8-bit PNG with the same pixels", async () => {
    const pixels = Buffer.alloc(5 * 3 * 4);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 37) % 256;
    const stored = await sharp(pixels, {
      raw: { width: 5, height: 3, channels: 4 },
    })
      .png({ progressive: true })
      .toBuffer();

    const clean = await reencodeImage(stored, "png", LIMITS);
    expect(clean).toMatchObject({ width: 5, height: 3, visible: true });
    expect(clean.bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(clean.bytes[24]).toBe(8);
    expect(clean.bytes[28]).toBe(0);
    expect((await sharp(clean.bytes).raw().toBuffer()).equals(pixels)).toBe(
      true,
    );
  });

  it.each([
    ["16-bit RGB", () => solid(9, 9).toColourspace("rgb16").png()],
    ["greyscale", () => solid(9, 9).toColourspace("b-w").png()],
    ["a 2-bit palette", () => solid(9, 9).png({ palette: true, colours: 4 })],
  ])("writes %s as 8-bit truecolour", async (_label, build) => {
    const clean = await reencodeImage(await build().toBuffer(), "png", LIMITS);
    expect(clean.bytes[24]).toBe(8);
    expect([2, 6]).toContain(clean.bytes[25]);
  });

  it("writes a JPEG as a baseline 4:4:4 JPEG", async () => {
    const stored = await solid(40, 24)
      .jpeg({ progressive: true, chromaSubsampling: "4:2:0" })
      .toBuffer();
    const clean = await reencodeImage(stored, "jpeg", LIMITS);
    const meta = await sharp(clean.bytes).metadata();
    expect(meta).toMatchObject({
      format: "jpeg",
      width: 40,
      height: 24,
      isProgressive: false,
      chromaSubsampling: "4:4:4",
    });
  });

  it("keeps a JPEG visually identical", async () => {
    const pixels = Buffer.alloc(64 * 64 * 3);
    for (let i = 0; i < pixels.length; i += 1) {
      pixels[i] = (Math.floor(i / 3) % 64) * 4;
    }
    const stored = await sharp(pixels, {
      raw: { width: 64, height: 64, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const before = await sharp(stored).raw().toBuffer();
    const after = await sharp(
      (await reencodeImage(stored, "jpeg", LIMITS)).bytes,
    )
      .raw()
      .toBuffer();
    let total = 0;
    for (let i = 0; i < before.length; i += 1) {
      total += Math.abs(before[i] - after[i]);
    }
    expect(total / before.length).toBeLessThan(1.5);
  });

  it("reports whether any pixel can be seen", async () => {
    const clear = await sharp(Buffer.alloc(4 * 4 * 4, 0), {
      raw: { width: 4, height: 4, channels: 4 },
    })
      .png()
      .toBuffer();
    expect((await reencodeImage(clear, "png", LIMITS)).visible).toBe(false);

    const onePixel = Buffer.alloc(4 * 4 * 4);
    onePixel[4 * 4 * 4 - 1] = 1;
    const faint = await sharp(onePixel, {
      raw: { width: 4, height: 4, channels: 4 },
    })
      .png()
      .toBuffer();
    expect((await reencodeImage(faint, "png", LIMITS)).visible).toBe(true);
    expect(
      (await reencodeImage(await solid(4, 4).png().toBuffer(), "png", LIMITS))
        .visible,
    ).toBe(true);
  });

  it("scales a large image to fit maxOutputSide, and leaves a small one", async () => {
    const wide = await solid(300, 100).png().toBuffer();
    const scaled = await reencodeImage(wide, "png", {
      ...LIMITS,
      maxOutputSide: 150,
    });
    expect([scaled.width, scaled.height]).toEqual([150, 50]);
    const small = await reencodeImage(wide, "png", {
      ...LIMITS,
      maxOutputSide: 1000,
    });
    expect([small.width, small.height]).toEqual([300, 100]);
  });

  it("refuses more pixels than allowed, from the header", async () => {
    const stored = await solid(100, 100).png().toBuffer();
    const err = await refusal(
      reencodeImage(stored, "png", { maxInputPixels: 100 * 99 }),
    );
    expect(err.message).toMatch(/pixel limit/i);
  });

  it("refuses bytes that decode as another format", async () => {
    const jpeg = await solid(8, 8).jpeg().toBuffer();
    expect((await refusal(reencodeImage(jpeg, "png", LIMITS))).message).toBe(
      "expected png, decoded as jpeg",
    );
  });

  /* librsvg decodes embedded PNGs with the crate that panics resvg, so an
     SVG must never be what sharp rasterises. */
  it("never rasterises an SVG", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
    );
    expect((await refusal(reencodeImage(svg, "png", LIMITS))).message).toBe(
      "expected png, decoded as svg",
    );
  });

  it("reads a PNG carrying an <svg> text chunk as a PNG", async () => {
    const stored = await solid(8, 8).png().toBuffer();
    const withText = Buffer.concat([
      stored.subarray(0, 33),
      pngChunk("tEXt", Buffer.from("Comment\0<svg xmlns='x'>")),
      stored.subarray(33),
    ]);
    const clean = await reencodeImage(withText, "png", LIMITS);
    expect(clean.width).toBe(8);
  });

  it.each([
    ["a JPEG cut short", buildJpeg(64, 48).subarray(0, -10)],
    ["text", Buffer.from("not an image")],
    ["nothing", Buffer.alloc(0)],
  ])("refuses %s, keeping the decoder's reason", async (_label, bytes) => {
    const err = await refusal(reencodeImage(bytes, "jpeg", LIMITS));
    expect(err.name).toBe("UndecodableImageError");
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("keeps the decoder's own error as the cause", async () => {
    const err = await refusal(
      reencodeImage(buildJpeg(64, 48).subarray(0, -10), "jpeg", LIMITS),
    );
    expect(err.cause).toBeInstanceOf(Error);
  });
});

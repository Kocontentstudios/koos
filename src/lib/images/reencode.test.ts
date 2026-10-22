// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildJpeg, PNG_SIGNATURE, pngChunk } from "./image-fixtures";
import {
  ImageOverBudgetError,
  RENDERER_IMAGE_BYTE_BUDGET,
  RENDERER_MAX_IMAGE_BYTES,
  reencodeImage,
  UndecodableImageError,
  UnsupportedJpegError,
} from "./reencode";

const LIMITS = { maxInputPixels: 4096 * 4096, minOutputSide: 1 };

/* Incompressible, so the encoded size is a known function of the pixel count
   and the budget below is crossed for certain. */
function noise(width: number, height: number, channels: 3 | 4): Buffer {
  const pixels = Buffer.alloc(width * height * channels);
  let seed = 7;
  for (let i = 0; i < pixels.length; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    pixels[i] = channels === 4 && i % 4 === 3 ? 255 : seed >>> 23;
  }
  return pixels;
}

const noisy = (width: number, height: number, channels: 3 | 4) =>
  sharp(noise(width, height, channels), {
    raw: { width, height, channels },
  });

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
      reencodeImage(stored, "png", { ...LIMITS, maxInputPixels: 100 * 99 }),
    );
    expect(err.message).toMatch(/pixel limit/i);
  });

  it("refuses bytes that decode as another format", async () => {
    const jpeg = await solid(8, 8).jpeg().toBuffer();
    expect((await refusal(reencodeImage(jpeg, "png", LIMITS))).message).toBe(
      "expected png, decoded as jpeg",
    );
  });

  /* librsvg decodes embedded PNGs with the Rust decoder that panics, so an
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

  /* The brand-logo path and SVG-embedded JPEGs meet this here rather than in
     the design-image loader. */
  it("refuses an arithmetic-coded frame before decoding it", async () => {
    const stored = await solid(64, 48).jpeg().toBuffer();
    const sof = stored.indexOf(Buffer.from([0xff, 0xc0]));
    stored[sof + 1] = 0xc9;
    const err = await reencodeImage(stored, "jpeg", LIMITS).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnsupportedJpegError);
    expect(err).toBeInstanceOf(UndecodableImageError);
  });

  it("keeps the decoder's own error as the cause", async () => {
    const err = await refusal(
      reencodeImage(buildJpeg(64, 48).subarray(0, -10), "jpeg", LIMITS),
    );
    expect(err.cause).toBeInstanceOf(Error);
  });
});

/* Round-3 critic B7: satori inlines each image as one base64 attribute and
   libxml2, inside sharp/librsvg, refuses an attribute over 10,000,000
   characters. Re-encodes had no output bound, so a 2560 px cutout passed the
   loader at 9.4 MB and then threw inside the render. */
describe("reencodeImage keeps the output under the renderer's limit", () => {
  it("sets the budget below the measured limit", () => {
    expect(RENDERER_MAX_IMAGE_BYTES).toBe(7_499_820);
    expect(Math.ceil(RENDERER_MAX_IMAGE_BYTES / 3) * 4).toBeLessThanOrEqual(
      10_000_000,
    );
    expect(RENDERER_IMAGE_BYTE_BUDGET).toBeLessThan(RENDERER_MAX_IMAGE_BYTES);
  });

  it("steps a PNG over budget down until it fits, keeping its shape", async () => {
    const stored = await noisy(400, 300, 4).png().toBuffer();
    expect(stored.length).toBeGreaterThan(400_000);
    const clean = await reencodeImage(stored, "png", {
      ...LIMITS,
      maxOutputBytes: 200_000,
    });
    expect(clean.bytes.length).toBeLessThanOrEqual(200_000);
    expect(clean.width).toBeLessThan(400);
    expect(clean.width / clean.height).toBeCloseTo(400 / 300, 1);
    const meta = await sharp(clean.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([clean.width, clean.height]);
  });

  it("leaves an image already under budget at full size", async () => {
    const stored = await solid(400, 300, 4).png().toBuffer();
    const clean = await reencodeImage(stored, "png", {
      ...LIMITS,
      maxOutputBytes: 200_000,
    });
    expect([clean.width, clean.height]).toEqual([400, 300]);
  });

  it("lowers a JPEG's quality before its size", async () => {
    const stored = await noisy(300, 300, 3).jpeg({ quality: 92 }).toBuffer();
    const atFull = (await reencodeImage(stored, "jpeg", LIMITS)).bytes.length;
    const clean = await reencodeImage(stored, "jpeg", {
      ...LIMITS,
      maxOutputBytes: Math.round(atFull * 0.8),
    });
    expect([clean.width, clean.height]).toEqual([300, 300]);
    expect(clean.bytes.length).toBeLessThanOrEqual(atFull * 0.8);
  });

  it("then shrinks a JPEG that no quality step fits", async () => {
    const stored = await noisy(300, 300, 3).jpeg({ quality: 92 }).toBuffer();
    const clean = await reencodeImage(stored, "jpeg", {
      ...LIMITS,
      maxOutputBytes: 30_000,
    });
    expect(clean.width).toBeLessThan(300);
    expect(clean.bytes.length).toBeLessThanOrEqual(30_000);
  });

  it("refuses rather than going below the floor", async () => {
    const stored = await noisy(400, 300, 4).png().toBuffer();
    const err = await reencodeImage(stored, "png", {
      ...LIMITS,
      minOutputSide: 380,
      maxOutputBytes: 200_000,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageOverBudgetError);
    expect(String(err)).toMatch(/the floor is 380/);
  });

  it("bounds the number of encodes a file can cost", async () => {
    const stored = await noisy(400, 300, 3).jpeg().toBuffer();
    const err = await reencodeImage(stored, "jpeg", {
      ...LIMITS,
      maxOutputBytes: 10,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageOverBudgetError);
    expect(String(err)).toMatch(/after 6 encodes/);
  });

  it("checks visibility on what is drawn", async () => {
    const stored = await noisy(400, 300, 4).png().toBuffer();
    const clean = await reencodeImage(stored, "png", {
      ...LIMITS,
      maxOutputBytes: 200_000,
    });
    expect(clean.visible).toBe(true);
  });
});

/* Round-3 critic C3: a JPEG logo with no end marker drew in every browser and
   on round 2, then faulted on round 3 as damaged. */
describe("reencodeImage with tolerateMissingJpegEnd", () => {
  const whole = () => buildJpeg(64, 48);
  const tolerant = { ...LIMITS, tolerateMissingJpegEnd: true };

  it("draws a JPEG whose only fault is the missing end marker", async () => {
    const noEnd = whole().subarray(0, -2);
    await expect(reencodeImage(noEnd, "jpeg", LIMITS)).rejects.toBeInstanceOf(
      UndecodableImageError,
    );
    const clean = await reencodeImage(noEnd, "jpeg", tolerant);
    expect([clean.width, clean.height]).toEqual([64, 48]);
  });

  it("still refuses a JPEG cut off inside its scan", async () => {
    const cut = whole().subarray(0, -10);
    const err = await refusal(reencodeImage(cut, "jpeg", tolerant));
    expect(err.message).toMatch(/premature end/i);
  });

  it("does not retry a complete JPEG that fails for another reason", async () => {
    const broken = whole();
    const sof = broken.indexOf(Buffer.from([0xff, 0xc0]));
    broken[sof + 4 + 6 + 2] = 3;
    await expect(
      reencodeImage(broken, "jpeg", tolerant),
    ).rejects.toBeInstanceOf(UndecodableImageError);
  });

  it("never applies to a PNG", async () => {
    const png = (await noisy(32, 32, 3).png().toBuffer()).subarray(0, -40);
    await expect(reencodeImage(png, "png", tolerant)).rejects.toBeInstanceOf(
      UndecodableImageError,
    );
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import {
  buildJpeg,
  buildPng,
  ihdrChunk,
  joinJpeg,
  jpegParts,
  PNG_SIGNATURE,
  pngChunk,
} from "@/lib/images/image-fixtures";
import { ObjectTooLargeError } from "@/lib/storage";
import {
  DesignImageError,
  type DesignImageFault,
  designImageKeyFor,
  isDesignImageKeyFor,
  loadDesignImage,
} from "./design-image";
import {
  IMAGE_NOT_USABLE_PREFIX,
  MAX_DESIGN_IMAGE_BYTES,
} from "./design-image-limits";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const OTHER_BRAND = "9b2e4c1d-0000-4000-8000-000000000001";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PNG_KEY = `design-images/${BRAND}/${ID}.png`;
const JPG_KEY = `design-images/${BRAND}/${ID}.jpg`;

/* 1-bit greyscale keeps a 4096 px fixture at 2 MB of scanlines; the decode
   proof inflates every byte the header promises. */
function png(width: number, height: number): Buffer {
  return buildPng(width, height, { colourType: 0, bitDepth: 1 });
}

const jpeg = buildJpeg;

const SVG = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
);
const HEIC = Buffer.from([
  0x00,
  0x00,
  0x00,
  0x18,
  ...Buffer.from("ftypheic"),
  0x00,
  0x00,
  0x00,
  0x00,
]);
const WEBP = Buffer.from([
  ...Buffer.from("RIFF"),
  0x24,
  0x00,
  0x00,
  0x00,
  ...Buffer.from("WEBPVP8 "),
]);
const TEXT = Buffer.from("definitely an image, trust me");

function storageError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

async function faultOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DesignImageError) return err.fault;
    throw err;
  }
  throw new Error("expected a DesignImageError");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("designImageKeyFor", () => {
  it("mints a key under design-images/{brandId}/ with a UUID name", () => {
    expect(designImageKeyFor(BRAND, "png")).toMatch(
      new RegExp(`^design-images/${BRAND}/[0-9a-f-]{36}\\.png$`),
    );
    expect(designImageKeyFor(BRAND, "jpg")).toMatch(/\.jpg$/);
  });

  it("never mints the same key twice", () => {
    expect(designImageKeyFor(BRAND, "png")).not.toBe(
      designImageKeyFor(BRAND, "png"),
    );
  });

  it("accepts every key it mints", () => {
    expect(isDesignImageKeyFor(designImageKeyFor(BRAND, "jpg"), BRAND)).toBe(
      true,
    );
  });

  /* The brand id becomes a path segment of a key the browser may then write. */
  it("refuses a brand id that is not a UUID", () => {
    for (const bad of ["../logos", "a/b", "", `${BRAND}/..`]) {
      expect(() => designImageKeyFor(bad, "png")).toThrow();
    }
  });
});

describe("isDesignImageKeyFor", () => {
  it("accepts this brand's PNG and JPG keys", () => {
    expect(isDesignImageKeyFor(PNG_KEY, BRAND)).toBe(true);
    expect(isDesignImageKeyFor(JPG_KEY, BRAND)).toBe(true);
  });

  it("refuses another brand's key", () => {
    expect(isDesignImageKeyFor(PNG_KEY, OTHER_BRAND)).toBe(false);
  });

  it("refuses keys under any other prefix", () => {
    for (const key of [
      `logos/${BRAND}/${ID}.png`,
      `generated/${BRAND}/${ID}.png`,
      `reference-images/${BRAND}/${ID}.png`,
      `design-images-x/${BRAND}/${ID}.png`,
      `/design-images/${BRAND}/${ID}.png`,
    ]) {
      expect(isDesignImageKeyFor(key, BRAND)).toBe(false);
    }
  });

  it("refuses traversal, nesting and encoded segments", () => {
    for (const key of [
      `design-images/${BRAND}/../${OTHER_BRAND}/${ID}.png`,
      `design-images/${BRAND}/x/../${ID}.png`,
      `design-images/${BRAND}/sub/${ID}.png`,
      `design-images/${BRAND}/%2e%2e/${ID}.png`,
      `design-images/${BRAND}/${ID}.png/..`,
      `design-images/${BRAND}//${ID}.png`,
    ]) {
      expect(isDesignImageKeyFor(key, BRAND)).toBe(false);
    }
  });

  it("refuses names this code never mints", () => {
    for (const key of [
      `design-images/${BRAND}/${ID}.webp`,
      `design-images/${BRAND}/${ID}.jpeg`,
      `design-images/${BRAND}/${ID}.svg`,
      `design-images/${BRAND}/${ID.toUpperCase()}.png`,
      `design-images/${BRAND}/photo.png`,
      `design-images/${BRAND}/${ID}.png.svg`,
      `design-images/${BRAND}/`,
    ]) {
      expect(isDesignImageKeyFor(key, BRAND)).toBe(false);
    }
  });

  it("refuses when the brand id itself is not a UUID", () => {
    expect(isDesignImageKeyFor(`design-images/x/${ID}.png`, "x")).toBe(false);
  });
});

/* Round-1 critic's hostile keys, kept as a regression list: every one must be
   refused as foreign before storage is touched. */
describe("loadDesignImage refuses hostile keys before reading", () => {
  it.each([
    `design-images/${BRAND}/../${OTHER_BRAND}/${ID}.png`,
    `design-images/${BRAND}/%2e%2e/${OTHER_BRAND}/${ID}.png`,
    `design-images/${BRAND}/..%2f${ID}.png`,
    `design-images//${BRAND}/${ID}.png`,
    `design-images/${BRAND}//${ID}.png`,
    `/design-images/${BRAND}/${ID}.png`,
    `design-images/${BRAND}/${ID}.png\n`,
    `design-images/${BRAND}/${ID}.png\u0000`,
    `design-images/${BRAND}/${ID}.png?x=1`,
    `design-images/${BRAND}/${ID}.PNG`,
    `design-images/${BRAND}/${ID.toUpperCase()}.png`,
    `design-images/${BRAND.toUpperCase()}/${ID}.png`,
    `design-images/${BRAND}/${ID}.png/`,
    `design-images/${BRAND}/${ID}.webp`,
    `design-images/${BRAND}/${ID}.svg`,
    `design-images/${BRAND}/${ID.replace("0", "０")}.png`,
    `design-images/${BRAND}/${ID.replace("a", "а")}.png`,
    `design-images/${BRAND.replace("a", "а")}/${ID}.png`,
    `design-images\\${BRAND}\\${ID}.png`,
    `design-images/${OTHER_BRAND}/${ID}.png`,
    `brand-docs/${BRAND}/${ID}.png`,
    `design-images/${BRAND}/${ID}.png.png`,
    ` design-images/${BRAND}/${ID}.png`,
  ])("refuses %j", async (key) => {
    getObjectBytes.mockResolvedValue(png(2, 2));
    expect(await faultOf(loadDesignImage(key, BRAND))).toBe("foreign_key");
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("refuses this brand's key asked for as another brand, or as uppercase", async () => {
    expect(await faultOf(loadDesignImage(PNG_KEY, OTHER_BRAND))).toBe(
      "foreign_key",
    );
    expect(await faultOf(loadDesignImage(PNG_KEY, BRAND.toUpperCase()))).toBe(
      "foreign_key",
    );
    expect(getObjectBytes).not.toHaveBeenCalled();
  });
});

describe("loadDesignImage refuses what is not a whole PNG or JPEG", () => {
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const headerOnly = (width: number, height: number, depth = 8, colour = 6) =>
    Buffer.concat([
      PNG_SIGNATURE,
      u32(13),
      Buffer.from("IHDR"),
      u32(width),
      u32(height),
      Buffer.from([depth, colour, 0, 0, 0]),
      u32(0),
    ]);

  it.each([
    ["a zero-byte body", Buffer.alloc(0)],
    ["WEBP", Buffer.concat([WEBP, Buffer.alloc(20)])],
    ["SVG", SVG],
    ["HEIC", HEIC],
    ["renamed text", TEXT],
    ["GIF89a", Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1")],
    ["HTML", Buffer.from("<!doctype html><script>alert(1)</script>")],
    ["a PNG 4097 wide", headerOnly(4097, 10)],
    ["a PNG of 0x0", headerOnly(0, 0)],
    ["a PNG 2^31 tall", headerOnly(10, 2 ** 31)],
    [
      "a 4096 x 4096 16-bit RGBA PNG header with no pixels",
      headerOnly(4096, 4096, 16, 6),
    ],
    [
      "a JPEG with no frame header",
      Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]),
    ],
    [
      "a JPEG of height 0 (DNL)",
      Buffer.from([
        0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 0, 0, 10, 1, 1, 0x11, 0,
      ]),
    ],
  ])("refuses %s with the user-facing message", async (_label, bytes) => {
    getObjectBytes.mockResolvedValue(bytes);
    const key = bytes[0] === 0xff ? JPG_KEY : PNG_KEY;
    await expect(loadDesignImage(key, BRAND)).rejects.toThrow(
      new RegExp(`^${IMAGE_NOT_USABLE_PREFIX}: `),
    );
  });
});

describe("loadDesignImage", () => {
  it("returns a PNG's type and size, with bytes it encoded itself", async () => {
    const stored = png(1200, 800);
    getObjectBytes.mockResolvedValue(stored);
    const image = await loadDesignImage(PNG_KEY, BRAND);
    expect(image).toMatchObject({
      contentType: "image/png",
      width: 1200,
      height: 800,
    });
    expect(image.bytes.equals(stored)).toBe(false);
    expect(await sharp(image.bytes).metadata()).toMatchObject({
      format: "png",
      width: 1200,
      height: 800,
      depth: "uchar",
    });
  });

  it("returns a JPEG's bytes, type and size", async () => {
    getObjectBytes.mockResolvedValue(jpeg(2560, 1440));
    const image = await loadDesignImage(JPG_KEY, BRAND);
    expect(image.contentType).toBe("image/jpeg");
    expect([image.width, image.height]).toEqual([2560, 1440]);
  });

  /* The cap is passed to storage so the read itself is bounded. */
  it("reads with the 20 MB cap", async () => {
    getObjectBytes.mockResolvedValue(png(10, 10));
    await loadDesignImage(PNG_KEY, BRAND);
    expect(getObjectBytes).toHaveBeenCalledWith(PNG_KEY, {
      maxBytes: MAX_DESIGN_IMAGE_BYTES,
    });
  });

  it("refuses another brand's key without reading it", async () => {
    expect(await faultOf(loadDesignImage(PNG_KEY, OTHER_BRAND))).toBe(
      "foreign_key",
    );
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("refuses a traversal key without reading it", async () => {
    const key = `design-images/${BRAND}/../../logos/${OTHER_BRAND}/x.png`;
    expect(await faultOf(loadDesignImage(key, BRAND))).toBe("foreign_key");
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it.each([
    ["SVG", SVG],
    ["HEIC", HEIC],
    ["WEBP", WEBP],
    ["text renamed as .png", TEXT],
    ["an empty file", Buffer.alloc(0)],
  ])("refuses %s", async (_label, bytes) => {
    getObjectBytes.mockResolvedValue(bytes);
    expect(await faultOf(loadDesignImage(PNG_KEY, BRAND))).toBe(
      "not_png_or_jpeg",
    );
  });

  it("refuses JPEG bytes stored under a .png key", async () => {
    getObjectBytes.mockResolvedValue(jpeg(100, 100));
    expect(await faultOf(loadDesignImage(PNG_KEY, BRAND))).toBe(
      "type_mismatch",
    );
  });

  it("refuses PNG bytes stored under a .jpg key", async () => {
    getObjectBytes.mockResolvedValue(png(100, 100));
    expect(await faultOf(loadDesignImage(JPG_KEY, BRAND))).toBe(
      "type_mismatch",
    );
  });

  it("refuses an object over the 20 MB cap", async () => {
    getObjectBytes.mockRejectedValue(
      new ObjectTooLargeError(PNG_KEY, MAX_DESIGN_IMAGE_BYTES),
    );
    expect(await faultOf(loadDesignImage(PNG_KEY, BRAND))).toBe("too_large");
  });

  it("refuses a side over 4096 px", async () => {
    getObjectBytes.mockResolvedValue(png(4097, 100));
    expect(await faultOf(loadDesignImage(PNG_KEY, BRAND))).toBe(
      "too_many_pixels",
    );
    getObjectBytes.mockResolvedValue(jpeg(100, 5000));
    expect(await faultOf(loadDesignImage(JPG_KEY, BRAND))).toBe(
      "too_many_pixels",
    );
  });

  it("accepts exactly 4096 px", async () => {
    getObjectBytes.mockResolvedValue(png(4096, 4096));
    await expect(loadDesignImage(PNG_KEY, BRAND)).resolves.toMatchObject({
      width: 4096,
      height: 4096,
    });
  });

  it("refuses a PNG whose header is cut short", async () => {
    getObjectBytes.mockResolvedValue(png(100, 100).subarray(0, 12));
    expect(await faultOf(loadDesignImage(PNG_KEY, BRAND))).toBe("unreadable");
  });

  it("refuses a JPEG with no frame header", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(await faultOf(loadDesignImage(JPG_KEY, BRAND))).toBe("unreadable");
  });

  it("reports a missing object as missing", async () => {
    getObjectBytes.mockRejectedValue(storageError("NoSuchKey"));
    expect(await faultOf(loadDesignImage(PNG_KEY, BRAND))).toBe("missing");
  });

  it("reports a zero-byte object refused by the ranged read as not an image", async () => {
    getObjectBytes.mockRejectedValue(storageError("InvalidRange"));
    expect(await faultOf(loadDesignImage(PNG_KEY, BRAND))).toBe(
      "not_png_or_jpeg",
    );
  });

  /* An outage is not the user's file. Blaming the image would send them to
     replace something that is fine. */
  it("rethrows a storage outage untouched", async () => {
    const outage = storageError("ServiceUnavailable");
    getObjectBytes.mockRejectedValue(outage);
    await expect(loadDesignImage(PNG_KEY, BRAND)).rejects.toBe(outage);
  });

  it("gives the user a message that starts the same way every time", async () => {
    getObjectBytes.mockResolvedValue(SVG);
    await expect(loadDesignImage(PNG_KEY, BRAND)).rejects.toThrow(
      /^This image can't be used: it is not a PNG or JPEG file\. Choose another image\.$/,
    );
  });

  it.each<DesignImageFault>([
    "foreign_key",
    "missing",
    "too_large",
    "not_png_or_jpeg",
    "type_mismatch",
    "unreadable",
    "too_many_pixels",
    "blank",
  ])("starts the %s message with IMAGE_NOT_USABLE_PREFIX", (fault) => {
    expect(new DesignImageError(fault).message).toMatch(
      new RegExp(`^${IMAGE_NOT_USABLE_PREFIX}: \\S`),
    );
  });
});

/* Round-1 critic B4: the loader judged only the first 24 bytes, and satori
   draws a PNG with missing or corrupt pixel data as nothing, byte-identical to
   a design with no image. Each of these reached the renderer and came out as a
   silently empty slot. */
describe("loadDesignImage proves the image decodes", () => {
  const IEND = pngChunk("IEND");
  const HEADER = ihdrChunk({
    width: 200,
    height: 200,
    bitDepth: 8,
    colourType: 6,
    interlaced: false,
  });

  async function refusal(key: string, bytes: Buffer) {
    getObjectBytes.mockResolvedValue(bytes);
    const err = await loadDesignImage(key, BRAND).catch((e: unknown) => e);
    if (!(err instanceof DesignImageError)) {
      throw new Error(`expected a DesignImageError, got ${String(err)}`);
    }
    return err;
  }

  it.each([
    [
      "header only (signature + IHDR, 33 bytes)",
      Buffer.concat([PNG_SIGNATURE, HEADER]),
    ],
    [
      "a garbage IDAT",
      Buffer.concat([
        PNG_SIGNATURE,
        HEADER,
        pngChunk("IDAT", Buffer.from("garbage garbage garbage")),
        IEND,
      ]),
    ],
    [
      "a PNG header followed by an HTML body",
      Buffer.concat([
        PNG_SIGNATURE,
        HEADER,
        Buffer.from("<html><script>alert(1)</script></html>"),
      ]),
    ],
    ["no IEND (a PUT cut short)", buildPng(200, 200).subarray(0, -12)],
    [
      "an IDAT that inflates short of the header's promise",
      Buffer.concat([
        PNG_SIGNATURE,
        HEADER,
        pngChunk("IDAT", deflateSync(Buffer.alloc(200 * 801 - 1))),
        IEND,
      ]),
    ],
  ])("refuses a PNG with %s as unreadable", async (_label, bytes) => {
    const err = await refusal(PNG_KEY, bytes);
    expect(err.fault).toBe("unreadable");
    expect(err.message).toBe(
      `${IMAGE_NOT_USABLE_PREFIX}: it could not be read and may be damaged. Choose another image.`,
    );
  });

  /* A truncated upload can stop anywhere. Every prefix of a real PNG long
     enough to carry its header must be refused, never drawn as nothing. */
  it("refuses a PNG truncated at any byte", async () => {
    const whole = buildPng(40, 30, { colourType: 2 });
    for (let end = 33; end < whole.length; end += 1) {
      const err = await refusal(PNG_KEY, whole.subarray(0, end));
      expect(err.fault, `cut at ${end} of ${whole.length}`).toBe("unreadable");
    }
  });

  it("refuses a JPEG truncated at any byte", async () => {
    const whole = buildJpeg(64, 48);
    for (let end = 3; end < whole.length; end += 1) {
      const err = await refusal(JPG_KEY, whole.subarray(0, end));
      expect(err.fault, `cut at ${end} of ${whole.length}`).toBe("unreadable");
    }
  });

  it("refuses a JPEG with a frame header but no scan", async () => {
    const parts = jpegParts(64, 48);
    const err = await refusal(
      JPG_KEY,
      joinJpeg({ ...parts, scanHeader: [], scan: [] }),
    );
    expect(err.fault).toBe("unreadable");
  });

  /* The header passes the 4096 px cap and promises 2 MB of scanlines; the
     stream inflates to 64 MB. The check stops at the promise rather than
     buffering the bomb. */
  it("refuses a decompression bomb inside the pixel cap, quickly", async () => {
    const header = { width: 4096, height: 4096, bitDepth: 1, colourType: 0 };
    const bomb = Buffer.concat([
      PNG_SIGNATURE,
      ihdrChunk({ ...header, interlaced: false }),
      pngChunk("IDAT", deflateSync(Buffer.alloc(64 * 1024 * 1024))),
      IEND,
    ]);
    const started = performance.now();
    const err = await refusal(PNG_KEY, bomb);
    expect(err.fault).toBe("unreadable");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("accepts an interlaced PNG and a multi-chunk IDAT", async () => {
    getObjectBytes.mockResolvedValue(
      buildPng(37, 23, { interlaced: true, colourType: 2 }),
    );
    await expect(loadDesignImage(PNG_KEY, BRAND)).resolves.toMatchObject({
      width: 37,
      height: 23,
    });

    const stream = deflateSync(Buffer.alloc(23 * (1 + 37 * 3)));
    const split = Buffer.concat([
      PNG_SIGNATURE,
      ihdrChunk({
        width: 37,
        height: 23,
        bitDepth: 8,
        colourType: 2,
        interlaced: false,
      }),
      pngChunk("IDAT", stream.subarray(0, 5)),
      pngChunk("IDAT", stream.subarray(5)),
      IEND,
    ]);
    getObjectBytes.mockResolvedValue(split);
    await expect(loadDesignImage(PNG_KEY, BRAND)).resolves.toBeTruthy();
  });
});

/* Round-2 critic B5/B6: a structural check cannot match resvg rule for rule,
   so what the loader returns is a fresh encode, never the stored bytes.
   design-image.render-gate.smoke.test.ts draws the whole hostile corpus. */
describe("loadDesignImage re-encodes what it accepts", () => {
  const opaque = (width: number, height: number) =>
    sharp({
      create: { width, height, channels: 3, background: "#2a6f97" },
    });

  async function refusal(key: string, bytes: Buffer) {
    getObjectBytes.mockResolvedValue(bytes);
    const err = await loadDesignImage(key, BRAND).catch((e: unknown) => e);
    if (!(err instanceof DesignImageError)) {
      throw new Error(`expected a DesignImageError, got ${String(err)}`);
    }
    return err;
  }

  /* The file that aborted the renderer: 16x16 indexed, a 4-byte PLTE, every
     CRC valid. It passes the structural check; libpng refuses it. */
  it("refuses a palette whose length is not a multiple of 3", async () => {
    const palette = Buffer.concat([
      PNG_SIGNATURE,
      ihdrChunk({
        width: 16,
        height: 16,
        bitDepth: 8,
        colourType: 3,
        interlaced: false,
      }),
      pngChunk("PLTE", Buffer.from([0, 0, 255, 9])),
      pngChunk("IDAT", deflateSync(Buffer.alloc(16 * 17))),
      pngChunk("IEND"),
    ]);
    const err = await refusal(PNG_KEY, palette);
    expect(err.fault).toBe("unreadable");
    expect(err.message.startsWith(`${IMAGE_NOT_USABLE_PREFIX}: `)).toBe(true);
    expect(err.cause).toBeInstanceOf(Error);
  });

  /* Well framed, so the marker-chain check passes, but the frame names a
     quantisation table that is never defined. resvg drew it as nothing. */
  it("refuses a JPEG that references a missing table", async () => {
    const whole = await opaque(64, 48).jpeg().toBuffer();
    const sof = whole.indexOf(Buffer.from([0xff, 0xc0]));
    whole[sof + 4 + 6 + 2] = 3;
    const err = await refusal(JPG_KEY, whole);
    expect(err.fault).toBe("unreadable");
  });

  it("refuses an image with no visible pixel as blank", async () => {
    const clear = await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const err = await refusal(PNG_KEY, clear);
    expect(err.fault).toBe("blank");
    expect(err.message).toBe(
      `${IMAGE_NOT_USABLE_PREFIX}: every pixel in it is transparent, so nothing would show. Choose another image.`,
    );
  });

  it("keeps a PNG's alpha and pixels", async () => {
    const pixels = Buffer.alloc(8 * 4 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels.set([i % 256, 40, 200, i < 64 ? 0 : 128], i);
    }
    const stored = await sharp(pixels, {
      raw: { width: 8, height: 4, channels: 4 },
    })
      .png()
      .toBuffer();
    getObjectBytes.mockResolvedValue(stored);
    const image = await loadDesignImage(PNG_KEY, BRAND);
    const back = await sharp(image.bytes).raw().toBuffer();
    expect(back.equals(pixels)).toBe(true);
  });

  it("returns a 16-bit PNG as 8-bit", async () => {
    const stored = await opaque(20, 10).toColourspace("rgb16").png().toBuffer();
    expect(stored[24]).toBe(16);
    getObjectBytes.mockResolvedValue(stored);
    const image = await loadDesignImage(PNG_KEY, BRAND);
    expect(image.bytes[24]).toBe(8);
  });

  it("returns a CMYK JPEG as an sRGB one", async () => {
    const stored = await opaque(32, 32).toColourspace("cmyk").jpeg().toBuffer();
    expect((await sharp(stored).metadata()).space).toBe("cmyk");
    getObjectBytes.mockResolvedValue(stored);
    const image = await loadDesignImage(JPG_KEY, BRAND);
    expect(image.contentType).toBe("image/jpeg");
    expect(await sharp(image.bytes).metadata()).toMatchObject({
      format: "jpeg",
      space: "srgb",
      channels: 3,
    });
  });

  /* resvg ignores EXIF orientation; the browser that showed the user their
     photo does not. The loader turns it the way the user saw it. */
  it("applies EXIF orientation and reports the turned size", async () => {
    const stored = await opaque(60, 20)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    getObjectBytes.mockResolvedValue(stored);
    const image = await loadDesignImage(JPG_KEY, BRAND);
    expect([image.width, image.height]).toEqual([20, 60]);
    const meta = await sharp(image.bytes).metadata();
    expect([meta.width, meta.height, meta.orientation]).toEqual([
      20,
      60,
      undefined,
    ]);
  });

  it("strips metadata", async () => {
    const stored = await opaque(16, 16)
      .withMetadata({ exif: { IFD0: { Copyright: "someone" } } })
      .jpeg()
      .toBuffer();
    getObjectBytes.mockResolvedValue(stored);
    const image = await loadDesignImage(JPG_KEY, BRAND);
    const meta = await sharp(image.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });
});

/* What the loader accepts must be what the renderer draws: the point of the
   decode proof is that "accepted" never means "silently dropped". */
describe("every image the loader accepts is drawn", () => {
  const SIZE = 64;

  async function render(dataUrl: string | null): Promise<Buffer> {
    const children = dataUrl
      ? { type: "img", props: { src: dataUrl, width: SIZE, height: SIZE } }
      : undefined;
    const element = {
      type: "div",
      props: {
        style: {
          display: "flex",
          width: SIZE,
          height: SIZE,
          background: "#f00",
        },
        children,
      },
    };
    const res = new ImageResponse(element as never, {
      width: SIZE,
      height: SIZE,
    });
    return Buffer.from(await res.arrayBuffer());
  }

  async function drawnThroughLoader(key: string, bytes: Buffer, blank: Buffer) {
    getObjectBytes.mockResolvedValue(bytes);
    const image = await loadDesignImage(key, BRAND);
    const out = await render(
      `data:${image.contentType};base64,${image.bytes.toString("base64")}`,
    );
    return !out.equals(blank);
  }

  it("draws the built PNG and JPEG fixtures", async () => {
    const blank = await render(null);
    expect(
      await drawnThroughLoader(
        PNG_KEY,
        buildPng(20, 20, { colourType: 2 }),
        blank,
      ),
    ).toBe(true);
    expect(await drawnThroughLoader(JPG_KEY, buildJpeg(20, 20), blank)).toBe(
      true,
    );
  });

  /* The Go standard library's image corpus: CMYK, progressive, restart
     markers, greyscale, chroma subsampling, a truncated progressive scan.
     Local only (no binaries in the repo); GO_IMAGE_TESTDATA overrides the
     path. Round-1 critic ran all 36 and every one was accepted and drawn. */
  const corpusDir =
    process.env.GO_IMAGE_TESTDATA ??
    join(process.env.HOME ?? "", ".local/go/src/image/testdata");
  const corpus = existsSync(corpusDir)
    ? readdirSync(corpusDir).filter((name) => /\.(png|jpe?g)$/.test(name))
    : [];

  it.skipIf(corpus.length === 0)(
    "accepts and draws every PNG and JPEG in the Go image corpus",
    async () => {
      const blank = await render(null);
      const failures: string[] = [];
      for (const name of corpus) {
        const key = name.endsWith(".png") ? PNG_KEY : JPG_KEY;
        try {
          const drawn = await drawnThroughLoader(
            key,
            readFileSync(join(corpusDir, name)),
            blank,
          );
          if (!drawn) failures.push(`${name}: not drawn`);
        } catch (err) {
          failures.push(`${name}: ${String(err)}`);
        }
      }
      expect(corpus.length).toBeGreaterThanOrEqual(36);
      expect(failures).toEqual([]);
    },
  );
});

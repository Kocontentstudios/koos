import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_NOT_USABLE_PREFIX,
  MAX_DESIGN_IMAGE_BYTES,
  TRANSPARENT_IMAGE_REASON,
} from "./design-image-limits";
import {
  fitWithinLongEdge,
  ImageNotUsableError,
  type ImageNotUsableReason,
  LIKELY_TOO_BIG_TO_DECODE,
  MAX_SOURCE_PIXELS,
  normalizeImageForUpload,
  readWebpDimensions,
} from "./normalize-image";

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_HEAD = [
  ...new TextEncoder().encode("RIFF"),
  0x24,
  0,
  0,
  0,
  ...new TextEncoder().encode("WEBPVP8 "),
];
const HEIC_HEAD = [0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")];

const bytesOf = (text: string) => [...new TextEncoder().encode(text)];
const u32be = (n: number) => [
  n >>> 24,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];
const u16le = (n: number) => [n & 0xff, n >>> 8];
const u24le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, n >>> 16];

function pngHead(width: number, height: number): number[] {
  return [
    ...PNG_HEAD,
    ...u32be(13),
    ...bytesOf("IHDR"),
    ...u32be(width),
    ...u32be(height),
    ...[8, 6, 0, 0, 0],
  ];
}

function jpegHead(width: number, height: number): number[] {
  return [
    ...[0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08],
    ...[height >> 8, height & 0xff, width >> 8, width & 0xff],
    0x03,
  ];
}

function webpHead(chunk: string, payload: number[]): number[] {
  return [
    ...bytesOf("RIFF"),
    ...[0x40, 0, 0, 0],
    ...bytesOf("WEBP"),
    ...bytesOf(chunk),
    ...[0x20, 0, 0, 0],
    ...payload,
    ...new Array(16).fill(0),
  ];
}

function webpLossyHead(width: number, height: number): number[] {
  return webpHead("VP8 ", [
    ...[0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a],
    ...u16le(width),
    ...u16le(height),
  ]);
}

function webpLosslessHead(width: number, height: number): number[] {
  const bits = ((width - 1) | ((height - 1) << 14)) >>> 0;
  return webpHead("VP8L", [0x2f, ...u32be(bits).reverse()]);
}

function webpExtendedHead(width: number, height: number): number[] {
  return webpHead("VP8X", [
    ...[0x10, 0, 0, 0],
    ...u24le(width - 1),
    ...u24le(height - 1),
  ]);
}
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

function fileOf(head: number[] | string, type: string, name = "x"): File {
  const bytes = typeof head === "string" ? head : new Uint8Array(head);
  return new File([bytes], name, { type });
}

/* A File whose reported size is huge without allocating it: only the first
   bytes are ever read, so slice is all that has to be real. */
function hugeFile(head: number[], size: number, type: string): File {
  const file = fileOf(head, type);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

interface FakeContext {
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillStyle: string;
  globalCompositeOperation: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  compositeAtFill: string[];
}

let ctx: FakeContext;
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let createImageBitmap: ReturnType<typeof vi.fn>;
let toBlob: ReturnType<typeof vi.spyOn>;
let alphaValue: number;
let fillValue: number;
let encodedSize: number | null;

function makeContext(): FakeContext {
  const fake: FakeContext = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(Math.min(w * h, 64) * 4).fill(
        fillValue,
      );
      data[data.length - 1] = alphaValue;
      return { data };
    }),
    fillRect: vi.fn(() => {
      fake.compositeAtFill.push(fake.globalCompositeOperation);
    }),
    fillStyle: "",
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    compositeAtFill: [],
  };
  return fake;
}

beforeEach(() => {
  alphaValue = 255;
  fillValue = 255;
  encodedSize = 1234;
  ctx = makeContext();
  bitmap = { width: 1000, height: 500, close: vi.fn() };
  createImageBitmap = vi.fn(async () => bitmap);
  vi.stubGlobal("createImageBitmap", createImageBitmap);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
  toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback, type) => {
      callback(
        encodedSize === null
          ? null
          : new Blob([new Uint8Array(encodedSize)], { type }),
      );
    });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ImageNotUsableError) return err.reason;
    throw err;
  }
  throw new Error("expected an ImageNotUsableError");
}

describe("fitWithinLongEdge", () => {
  it("scales a landscape phone photo to 2560 on the long edge", () => {
    expect(fitWithinLongEdge(7000, 3000, 2560)).toEqual({
      width: 2560,
      height: 1097,
    });
  });

  it("scales a portrait photo by its height", () => {
    expect(fitWithinLongEdge(3024, 4032, 2560)).toEqual({
      width: 1920,
      height: 2560,
    });
  });

  it("never scales up", () => {
    expect(fitWithinLongEdge(800, 600, 2560)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("keeps a sliver at least one pixel wide", () => {
    expect(fitWithinLongEdge(10000, 1, 2560)).toEqual({
      width: 2560,
      height: 1,
    });
  });
});

describe("normalizeImageForUpload: what it accepts", () => {
  it("re-encodes a JPEG as JPEG at quality 0.9", async () => {
    const out = await normalizeImageForUpload(fileOf(JPEG_HEAD, "image/jpeg"));
    expect(out.type).toBe("image/jpeg");
    expect(out.blob.type).toBe("image/jpeg");
    expect(toBlob.mock.calls[0].slice(1)).toEqual(["image/jpeg", 0.9]);
  });

  it("turns an opaque WEBP into JPEG", async () => {
    alphaValue = 255;
    const out = await normalizeImageForUpload(fileOf(WEBP_HEAD, "image/webp"));
    expect(out.type).toBe("image/jpeg");
  });

  /* Spec, Upload: any transparent pixel keeps PNG, whatever the source. A
     cut-out WEBP sticker flattened to JPEG would arrive on a white box. */
  it("turns a WEBP with transparency into PNG, unflattened", async () => {
    alphaValue = 0;
    const out = await normalizeImageForUpload(fileOf(WEBP_HEAD, "image/webp"));
    expect(out.type).toBe("image/png");
    expect(toBlob.mock.calls[0][1]).toBe("image/png");
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("keeps PNG for a single partly transparent pixel", async () => {
    alphaValue = 254;
    const out = await normalizeImageForUpload(fileOf(PNG_HEAD, "image/png"));
    expect(out.type).toBe("image/png");
  });

  it("keeps a PNG with transparency as PNG", async () => {
    alphaValue = 0;
    const out = await normalizeImageForUpload(fileOf(PNG_HEAD, "image/png"));
    expect(out.type).toBe("image/png");
    expect(toBlob.mock.calls[0][1]).toBe("image/png");
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  /* Opaque PNG pixels lose nothing as JPEG and get several times smaller. */
  it("turns an opaque PNG into JPEG", async () => {
    alphaValue = 255;
    const out = await normalizeImageForUpload(fileOf(PNG_HEAD, "image/png"));
    expect(out.type).toBe("image/jpeg");
  });

  /* Trusting file.type would let a JPEG named .png keep the PNG path. */
  it("judges by the bytes, not the declared type", async () => {
    const out = await normalizeImageForUpload(
      fileOf(JPEG_HEAD, "image/png", "photo.png"),
    );
    expect(out.type).toBe("image/jpeg");
    expect(ctx.getImageData).not.toHaveBeenCalled();
  });
});

describe("normalizeImageForUpload: what it refuses", () => {
  it.each([
    ["HEIC renamed to .png", fileOf(HEIC_HEAD, "image/png", "a.png")],
    ["SVG", fileOf(SVG_TEXT, "image/svg+xml", "a.svg")],
    ["SVG renamed to .png", fileOf(SVG_TEXT, "image/png", "a.png")],
    ["text renamed to .jpg", fileOf("hello there", "image/jpeg", "a.jpg")],
    ["GIF", fileOf([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], "image/gif")],
    ["an empty file", fileOf([], "image/png")],
  ])("refuses %s as the wrong type", async (_label, file) => {
    expect(await reasonOf(normalizeImageForUpload(file))).toBe("wrong_type");
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("refuses a file over 20 MB before decoding it", async () => {
    const file = hugeFile(JPEG_HEAD, MAX_DESIGN_IMAGE_BYTES + 1, "image/jpeg");
    expect(await reasonOf(normalizeImageForUpload(file))).toBe("too_large");
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at 20 MB", async () => {
    const file = hugeFile(JPEG_HEAD, MAX_DESIGN_IMAGE_BYTES, "image/jpeg");
    await expect(normalizeImageForUpload(file)).resolves.toBeTruthy();
  });

  it("refuses a file the browser cannot decode", async () => {
    createImageBitmap.mockRejectedValue(
      new DOMException("bad", "InvalidStateError"),
    );
    expect(
      await reasonOf(normalizeImageForUpload(fileOf(PNG_HEAD, "image/png"))),
    ).toBe("undecodable");
  });

  /* Round-1 critic C1: a 194 KB PNG declaring 40000 x 40000 was reported as
     "may be damaged". It is too large, and is refused before decoding. */
  it.each([
    ["a PNG", pngHead(40_000, 40_000)],
    ["a JPEG", jpegHead(30_000, 30_000)],
    ["a lossless WEBP", webpLosslessHead(16_384, 16_384)],
    ["an extended WEBP", webpExtendedHead(20_000, 20_000)],
  ])(
    "refuses %s declaring a decompression bomb as too large",
    async (_label, head) => {
      const out = normalizeImageForUpload(fileOf(head, "image/png"));
      const err = await out.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ImageNotUsableError);
      expect((err as ImageNotUsableError).reason).toBe("too_many_pixels");
      expect((err as Error).message).not.toMatch(/damaged/);
      expect(createImageBitmap).not.toHaveBeenCalled();
    },
  );

  it("decodes an image exactly at the pixel cap", async () => {
    const side = Math.sqrt(MAX_SOURCE_PIXELS);
    await normalizeImageForUpload(fileOf(pngHead(side, side), "image/png"));
    expect(createImageBitmap).toHaveBeenCalled();
  });

  /* Under the hard cap a failed decode of a huge photo is the browser running
     out of memory, not damage. */
  it("reports a very large image the browser fails to decode as too large", async () => {
    createImageBitmap.mockRejectedValue(
      new DOMException("oom", "InvalidStateError"),
    );
    const file = fileOf(jpegHead(8000, 6000), "image/jpeg");
    expect(await reasonOf(normalizeImageForUpload(file))).toBe(
      "too_many_pixels",
    );
    expect(48_000_000).toBeGreaterThan(LIKELY_TOO_BIG_TO_DECODE);
  });

  it("still calls an ordinary-size decode failure damage", async () => {
    createImageBitmap.mockRejectedValue(
      new DOMException("bad", "InvalidStateError"),
    );
    const file = fileOf(jpegHead(4000, 3000), "image/jpeg");
    expect(await reasonOf(normalizeImageForUpload(file))).toBe("undecodable");
  });

  it("reports an encoder that returns nothing", async () => {
    encodedSize = null;
    expect(
      await reasonOf(normalizeImageForUpload(fileOf(JPEG_HEAD, "image/jpeg"))),
    ).toBe("encode_failed");
    expect(bitmap.close).toHaveBeenCalled();
  });

  /* Round-3 critic C6: 4 of 232 browser outputs were fully transparent and
     were only refused at generation, after the upload. */
  it.each([
    ["PNG", PNG_HEAD, "image/png"],
    ["WEBP", WEBP_HEAD, "image/webp"],
  ])(
    "refuses a fully transparent %s before uploading it",
    async (_label, head, type) => {
      fillValue = 0;
      alphaValue = 0;
      expect(await reasonOf(normalizeImageForUpload(fileOf(head, type)))).toBe(
        "blank",
      );
      expect(toBlob).not.toHaveBeenCalled();
    },
  );

  it("uses the loader's own words for a transparent image", async () => {
    fillValue = 0;
    alphaValue = 0;
    await expect(
      normalizeImageForUpload(fileOf(PNG_HEAD, "image/png")),
    ).rejects.toThrow(
      `${IMAGE_NOT_USABLE_PREFIX}: ${TRANSPARENT_IMAGE_REASON}`,
    );
  });

  it("keeps an image whose only visible pixel is faint", async () => {
    fillValue = 0;
    alphaValue = 1;
    const out = await normalizeImageForUpload(fileOf(PNG_HEAD, "image/png"));
    expect(out.type).toBe("image/png");
  });

  it("refuses when the re-encoded file would still be over 20 MB", async () => {
    alphaValue = 0;
    encodedSize = MAX_DESIGN_IMAGE_BYTES + 1;
    expect(
      await reasonOf(normalizeImageForUpload(fileOf(PNG_HEAD, "image/png"))),
    ).toBe("too_large_after_encode");
  });

  it("gives every refusal a message the user can act on", async () => {
    await expect(
      normalizeImageForUpload(fileOf(HEIC_HEAD, "image/heic")),
    ).rejects.toThrow(
      "This image can't be used: it is not a PNG, JPEG or WEBP file. Choose another image.",
    );
    const file = hugeFile(JPEG_HEAD, MAX_DESIGN_IMAGE_BYTES + 1, "image/jpeg");
    await expect(normalizeImageForUpload(file)).rejects.toThrow(
      "This image can't be used: it is over 20 MB. Choose a smaller one.",
    );
  });

  /* The UI detects the unusable-image state by the shared constant, so a
     reason whose wording drifted from it would leave the user with no error
     state at all. */
  it.each<ImageNotUsableReason>([
    "wrong_type",
    "too_large",
    "too_many_pixels",
    "undecodable",
    "encode_failed",
    "too_large_after_encode",
    "blank",
  ])("starts the %s message with IMAGE_NOT_USABLE_PREFIX", (reason) => {
    expect(new ImageNotUsableError(reason).message).toMatch(
      new RegExp(`^${IMAGE_NOT_USABLE_PREFIX}: \\S`),
    );
  });
});

/* Round-1 critic C2: engines that predate imageOrientation "from-image" throw
   a TypeError on the option itself, which was caught as "undecodable" and so
   refused every image on those browsers. */
describe("normalizeImageForUpload: browsers without imageOrientation", () => {
  it("retries without the option when the option is the TypeError", async () => {
    createImageBitmap
      .mockRejectedValueOnce(new TypeError("bad enum value 'from-image'"))
      .mockResolvedValueOnce(bitmap);
    const file = fileOf(JPEG_HEAD, "image/jpeg");
    const out = await normalizeImageForUpload(file);
    expect(out.type).toBe("image/jpeg");
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    expect(createImageBitmap.mock.calls[1]).toEqual([file]);
  });

  it("still refuses a damaged file on such a browser", async () => {
    createImageBitmap
      .mockRejectedValueOnce(new TypeError("bad enum value"))
      .mockRejectedValueOnce(new DOMException("bad", "InvalidStateError"));
    expect(
      await reasonOf(normalizeImageForUpload(fileOf(JPEG_HEAD, "image/jpeg"))),
    ).toBe("undecodable");
  });

  it("does not retry a real decode failure", async () => {
    createImageBitmap.mockRejectedValue(
      new DOMException("bad", "InvalidStateError"),
    );
    await reasonOf(normalizeImageForUpload(fileOf(JPEG_HEAD, "image/jpeg")));
    expect(createImageBitmap).toHaveBeenCalledOnce();
  });
});

describe("readWebpDimensions", () => {
  it("reads a lossy (VP8) header", () => {
    expect(readWebpDimensions(new Uint8Array(webpLossyHead(640, 480)))).toEqual(
      { width: 640, height: 480 },
    );
  });

  it("reads a lossless (VP8L) header", () => {
    expect(
      readWebpDimensions(new Uint8Array(webpLosslessHead(1, 16_384))),
    ).toEqual({ width: 1, height: 16_384 });
  });

  it("reads an extended (VP8X) canvas", () => {
    expect(
      readWebpDimensions(new Uint8Array(webpExtendedHead(20_000, 3))),
    ).toEqual({ width: 20_000, height: 3 });
  });

  it("returns null for a header it does not know or cannot see", () => {
    expect(readWebpDimensions(new Uint8Array(WEBP_HEAD))).toBeNull();
  });
});

describe("normalizeImageForUpload: how it draws", () => {
  /* createImageBitmap is what applies EXIF orientation; without the option some
     engines hand back the sensor's raw rotation. */
  it("decodes with EXIF orientation applied", async () => {
    const file = fileOf(JPEG_HEAD, "image/jpeg");
    await normalizeImageForUpload(file);
    expect(createImageBitmap).toHaveBeenCalledWith(file, {
      imageOrientation: "from-image",
    });
  });

  it("downscales a large photo to 2560 on the long edge", async () => {
    bitmap.width = 6000;
    bitmap.height = 4000;
    const out = await normalizeImageForUpload(fileOf(JPEG_HEAD, "image/jpeg"));
    expect([out.width, out.height]).toEqual([2560, 1707]);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2560, 1707);
    expect(ctx.imageSmoothingQuality).toBe("high");
  });

  it("leaves a small image at its own size", async () => {
    bitmap.width = 640;
    bitmap.height = 480;
    const out = await normalizeImageForUpload(fileOf(JPEG_HEAD, "image/jpeg"));
    expect([out.width, out.height]).toEqual([640, 480]);
  });

  /* A canvas encodes transparent pixels as black in a JPEG. */
  it("paints white behind the image before encoding a JPEG", async () => {
    await normalizeImageForUpload(fileOf(WEBP_HEAD, "image/webp"));
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1000, 500);
    expect(ctx.compositeAtFill).toEqual(["destination-over"]);
    expect(ctx.fillStyle).toBe("#ffffff");
    expect(ctx.globalCompositeOperation).toBe("source-over");
  });

  it("releases the decoded bitmap", async () => {
    await normalizeImageForUpload(fileOf(JPEG_HEAD, "image/jpeg"));
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});

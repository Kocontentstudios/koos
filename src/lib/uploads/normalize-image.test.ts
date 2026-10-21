import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DESIGN_IMAGE_BYTES } from "./design-image-limits";
import {
  fitWithinLongEdge,
  ImageNotUsableError,
  normalizeImageForUpload,
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
let encodedSize: number | null;

function makeContext(): FakeContext {
  const fake: FakeContext = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(Math.min(w * h, 64) * 4).fill(255);
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

  it("turns WEBP into JPEG", async () => {
    const out = await normalizeImageForUpload(fileOf(WEBP_HEAD, "image/webp"));
    expect(out.type).toBe("image/jpeg");
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

  it("reports an encoder that returns nothing", async () => {
    encodedSize = null;
    expect(
      await reasonOf(normalizeImageForUpload(fileOf(JPEG_HEAD, "image/jpeg"))),
    ).toBe("encode_failed");
    expect(bitmap.close).toHaveBeenCalled();
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
      "This file can't be used. Choose a PNG, JPEG or WEBP image.",
    );
    const file = hugeFile(JPEG_HEAD, MAX_DESIGN_IMAGE_BYTES + 1, "image/jpeg");
    await expect(normalizeImageForUpload(file)).rejects.toThrow(
      "This image is over 20 MB. Choose a smaller one.",
    );
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

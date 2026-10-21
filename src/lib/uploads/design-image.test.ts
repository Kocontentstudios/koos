// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import { ObjectTooLargeError } from "@/lib/storage";
import {
  DesignImageError,
  designImageKeyFor,
  isDesignImageKeyFor,
  loadDesignImage,
} from "./design-image";
import { MAX_DESIGN_IMAGE_BYTES } from "./design-image-limits";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const OTHER_BRAND = "9b2e4c1d-0000-4000-8000-000000000001";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PNG_KEY = `design-images/${BRAND}/${ID}.png`;
const JPG_KEY = `design-images/${BRAND}/${ID}.jpg`;

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function png(width: number, height: number): Buffer {
  return Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    ...Buffer.from("IHDR"),
    ...u32(width),
    ...u32(height),
    8,
    6,
    0,
    0,
    0,
  ]);
}

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    // APP0, which the SOF walk has to step over
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
  ]);
}

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

describe("loadDesignImage", () => {
  it("returns a PNG's bytes, type and size", async () => {
    const bytes = png(1200, 800);
    getObjectBytes.mockResolvedValue(bytes);
    const image = await loadDesignImage(PNG_KEY, BRAND);
    expect(image).toEqual({
      bytes,
      contentType: "image/png",
      width: 1200,
      height: 800,
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
});

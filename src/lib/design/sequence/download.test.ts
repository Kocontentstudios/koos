// @vitest-environment node
import { unzipSync } from "fflate";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  frameFileName,
  isSetDownloadFormat,
  pdfFrames,
  pngSize,
  setDownloadKey,
  setFileName,
  zipFrames,
} from "./download";

async function png(
  width: number,
  height: number,
  r = 200,
): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 4, background: { r, g: 80, b: 40 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

describe("frameFileName", () => {
  it("numbers from 1 with the role after", () => {
    expect(frameFileName(0, "hook", 5)).toBe("01-hook.png");
    expect(frameFileName(2, "body", 5)).toBe("03-body.png");
    expect(frameFileName(4, "cta", 5)).toBe("05-cta.png");
  });

  /* "10-cta.png" must sort after "09-body.png" in a file browser. */
  it("pads to the width of the set so names sort in frame order", () => {
    const names = Array.from({ length: 12 }, (_, i) =>
      frameFileName(i, i === 0 ? "hook" : i === 11 ? "cta" : "body", 12),
    );
    expect(names[0]).toBe("01-hook.png");
    expect(names[9]).toBe("10-body.png");
    expect(names[11]).toBe("12-cta.png");
    expect([...names].sort()).toEqual(names);
  });

  it("widens past two digits when the set does", () => {
    expect(frameFileName(0, "hook", 100)).toBe("001-hook.png");
    expect(frameFileName(99, "cta", 100)).toBe("100-cta.png");
  });

  it.each([
    [-1, 5],
    [5, 5],
    [1.5, 5],
    [0, 0],
    [0, Number.NaN],
  ])("refuses index %s of a set of %s", (index, count) => {
    expect(() => frameFileName(index, "body", count)).toThrow(RangeError);
  });
});

describe("zipFrames", () => {
  it("writes every frame under its name, in the order given, byte for byte", async () => {
    const frames = [
      { name: "01-hook.png", bytes: await png(4, 5, 10) },
      { name: "02-body.png", bytes: await png(4, 5, 20) },
      { name: "03-cta.png", bytes: await png(4, 5, 30) },
    ];
    const unzipped = unzipSync(zipFrames(frames));
    expect(Object.keys(unzipped)).toEqual([
      "01-hook.png",
      "02-body.png",
      "03-cta.png",
    ]);
    for (const { name, bytes } of frames) {
      expect(unzipped[name]).toEqual(bytes);
    }
  });

  it("keeps the given order even when it is not alphabetical", async () => {
    const bytes = await png(2, 2);
    const unzipped = unzipSync(
      zipFrames([
        { name: "b.png", bytes },
        { name: "a.png", bytes },
      ]),
    );
    expect(Object.keys(unzipped)).toEqual(["b.png", "a.png"]);
  });

  /* A plain object would keep only the last of two same-named frames. */
  it("refuses two entries with one name rather than dropping a frame", async () => {
    const bytes = await png(2, 2);
    expect(() =>
      zipFrames([
        { name: "01-hook.png", bytes },
        { name: "01-hook.png", bytes },
      ]),
    ).toThrow(/share a zip entry name/);
  });

  it("refuses an empty set", () => {
    expect(() => zipFrames([])).toThrow();
  });

  /* PNGs are already deflated; a second pass only costs CPU. */
  it("stores entries rather than recompressing them", async () => {
    const bytes = await png(64, 64);
    const zip = zipFrames([{ name: "01-hook.png", bytes }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
  });
});

describe("pdfFrames", () => {
  it("writes one page per frame at the frame's pixel size, in order", async () => {
    const sizes = [
      [1080, 1350],
      [1080, 1080],
      [1920, 1080],
    ] as const;
    const frames = await Promise.all(
      sizes.map(async ([width, height]) => ({
        bytes: await png(width, height),
        width,
        height,
      })),
    );
    const doc = await PDFDocument.load(await pdfFrames(frames));
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual(
      sizes.map(([w, h]) => [w, h]),
    );
  });

  /* 1px = 1pt: the image on each page is the frame itself, not a
     resampled copy, and it is the only thing drawn. */
  it("embeds each frame's image at full resolution, once per page", async () => {
    const doc = await PDFDocument.load(
      await pdfFrames([
        { bytes: await png(1080, 1350), width: 1080, height: 1350 },
        { bytes: await png(1920, 1080), width: 1920, height: 1080 },
      ]),
    );
    const imageSizes = doc.getPages().map((page) => {
      const xObjects = page.node
        .Resources()
        ?.lookupMaybe(PDFName.of("XObject"), PDFDict);
      return (xObjects?.values() ?? []).map((ref) => {
        const image = doc.context.lookup(ref, PDFStream).dict;
        return [
          image.lookup(PDFName.of("Width"), PDFNumber).asNumber(),
          image.lookup(PDFName.of("Height"), PDFNumber).asNumber(),
        ];
      });
    });
    expect(imageSizes).toEqual([[[1080, 1350]], [[1920, 1080]]]);
  });

  it("refuses an empty set", async () => {
    await expect(pdfFrames([])).rejects.toThrow();
  });

  it("refuses a frame with no size rather than writing an empty page", async () => {
    await expect(
      pdfFrames([{ bytes: await png(2, 2), width: 0, height: 2 }]),
    ).rejects.toThrow(RangeError);
  });

  it("refuses bytes that are not a PNG", async () => {
    await expect(
      pdfFrames([{ bytes: new Uint8Array([1, 2, 3]), width: 2, height: 2 }]),
    ).rejects.toThrow();
  });
});

describe("pngSize", () => {
  it("reads the pixel size from the header", async () => {
    expect(pngSize(await png(1080, 1350))).toEqual({
      width: 1080,
      height: 1350,
    });
  });

  it("reads through a subarray offset", async () => {
    const bytes = await png(7, 9);
    const padded = new Uint8Array(bytes.length + 5);
    padded.set(bytes, 5);
    expect(pngSize(padded.subarray(5))).toEqual({ width: 7, height: 9 });
  });

  it("refuses a file that is not a PNG", async () => {
    const jpeg = new Uint8Array(
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: "#fff" },
      })
        .jpeg()
        .toBuffer(),
    );
    expect(() => pngSize(jpeg)).toThrow("Not a PNG");
    expect(() => pngSize(new Uint8Array(4))).toThrow("Not a PNG");
  });
});

describe("setFileName", () => {
  const SET = "1a2b3c4d-1111-4111-8111-111111111111";

  it("names the brand, the format and the size", () => {
    expect(
      setFileName(
        {
          setId: SET,
          brandName: "Acme Bakery",
          designType: "Instagram carousel",
          width: 1080,
          height: 1350,
        },
        "zip",
      ),
    ).toBe("acme-bakery-instagram-carousel-1080x1350-1a2b3c4d.zip");
  });

  it("swaps the extension for a PDF", () => {
    expect(
      setFileName(
        {
          setId: SET,
          brandName: "Acme",
          designType: "Presentation",
          width: 1920,
          height: 1080,
        },
        "pdf",
      ),
    ).toBe("acme-presentation-1920x1080-1a2b3c4d.pdf");
  });

  it("falls back when the brand or type is missing", () => {
    expect(
      setFileName(
        {
          setId: SET,
          brandName: "  ",
          designType: null,
          width: null,
          height: null,
        },
        "zip",
      ),
    ).toBe("design-1a2b3c4d.zip");
  });

  /* It lands inside a quoted Content-Disposition filename. */
  it("strips anything that would break a header", () => {
    const name = setFileName(
      {
        setId: SET,
        brandName: 'Café "Ünïcode"\r\n; x=1',
        designType: "carousel",
        width: 1080,
        height: 1080,
      },
      "pdf",
    );
    expect(name).toMatch(/^[a-z0-9-]+\.pdf$/);
    expect(name).toBe("cafe-unicode-x-1-carousel-1080x1080-1a2b3c4d.pdf");
  });
});

describe("setDownloadKey", () => {
  const base = {
    brandId: "b1",
    setId: "s1",
    frameIds: ["a", "b", "c"],
    format: "zip" as const,
  };

  it("sits under the brand's generated prefix, inside the set", () => {
    expect(setDownloadKey(base)).toMatch(
      /^generated\/b1\/sets\/s1\/[0-9a-f]{16}\.zip$/,
    );
  });

  it("is the same for the same live frames", () => {
    expect(setDownloadKey(base)).toBe(setDownloadKey({ ...base }));
  });

  /* A stale file under a reused key would hand back the frame the user
     just replaced. */
  it.each([
    ["a replaced frame", { frameIds: ["a", "b2", "c"] }],
    ["a reordering", { frameIds: ["b", "a", "c"] }],
    ["a missing frame", { frameIds: ["a", "c"] }],
    ["the other format", { format: "pdf" as const }],
  ])("changes with %s", (_, change) => {
    expect(setDownloadKey({ ...base, ...change })).not.toBe(
      setDownloadKey(base),
    );
  });
});

describe("isSetDownloadFormat", () => {
  it("accepts only zip and pdf", () => {
    expect(isSetDownloadFormat("zip")).toBe(true);
    expect(isSetDownloadFormat("pdf")).toBe(true);
    expect(isSetDownloadFormat("ZIP")).toBe(false);
    expect(isSetDownloadFormat(null)).toBe(false);
  });
});

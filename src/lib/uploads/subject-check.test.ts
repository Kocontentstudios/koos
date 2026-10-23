// @vitest-environment node
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BROWSER_MARGIN,
  browserLooksBlank,
  looksBlank,
  MIN_EDGE_ENERGY,
  MIN_LOCAL_CONTRAST,
  MIN_SUBJECT_COVERAGE,
  measureSubject,
  SUBJECT_DEVIATION,
  SUBJECT_THUMBNAIL_SIDE,
  subjectThumbnail,
  subjectThumbnailSize,
} from "./subject-check";
import { type SubjectFixture, subjectFixtures } from "./subject-fixtures";

const filled = (count: number, rgba: [number, number, number, number]) => {
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < out.length; i += 4) out.set(rgba, i);
  return out;
};

/* At thumbnail size the thumbnail is the image, so these read pixel for
   pixel. */
const measure = (rgba: Uint8Array, width: number, height: number) =>
  measureSubject(subjectThumbnail(rgba, width, height, 4));

describe("measureSubject", () => {
  it("finds nothing in a single flat colour, whatever the colour", () => {
    for (const colour of [
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [192, 57, 43, 255],
    ] as [number, number, number, number][]) {
      expect(measure(filled(64 * 48, colour), 64, 48)).toEqual({
        coverage: 0,
        edgeEnergy: 0,
        localContrast: 0,
      });
    }
  });

  it("counts the share of pixels far from the median colour", () => {
    const pixels = filled(100, [255, 255, 255, 255]);
    pixels.set([0, 0, 0, 255], 0);
    pixels.set([255, 255, 230, 255], 4);
    pixels.set([255, 255, 231, 255], 8);
    expect(measure(pixels, 10, 10).coverage).toBeCloseTo(0.02);
  });

  it("sees a change of hue at one brightness", () => {
    const pixels = filled(100, [200, 40, 40, 255]);
    for (let i = 0; i < 50; i += 1) pixels.set([40, 40, 200, 255], i * 4);
    expect(looksBlank(measure(pixels, 10, 10))).toBe(false);
  });

  /* A white disc cut out on transparency is white on white once flattened,
     and is plainly a subject on any other ground. */
  it("counts a silhouette by its alpha, whatever its colour", () => {
    const pixels = filled(100, [255, 255, 255, 0]);
    for (let i = 0; i < 30; i += 1) pixels.set([255, 255, 255, 255], i * 4);
    expect(measure(pixels, 10, 10).coverage).toBeCloseTo(0.3);
  });

  it("reports edge energy where nothing is far from the median", () => {
    const pixels = filled(64 * 64, [128, 128, 128, 255]);
    for (let i = 0; i < 64 * 64; i += 1) {
      const v = (i + Math.floor(i / 64)) % 2 ? 148 : 128;
      pixels.set([v, v, v, 255], i * 4);
    }
    const result = measure(pixels, 64, 64);
    expect(result.coverage).toBe(0);
    expect(result.edgeEnergy).toBeGreaterThan(MIN_EDGE_ENERGY);
    expect(looksBlank(result)).toBe(false);
  });

  it("is blank only when every measure is under its floor", () => {
    const blank = { coverage: 0, edgeEnergy: 0, localContrast: 0 };
    expect(looksBlank(blank)).toBe(true);
    expect(looksBlank({ ...blank, coverage: MIN_SUBJECT_COVERAGE })).toBe(
      false,
    );
    expect(looksBlank({ ...blank, edgeEnergy: MIN_EDGE_ENERGY })).toBe(false);
    expect(looksBlank({ ...blank, localContrast: MIN_LOCAL_CONTRAST })).toBe(
      false,
    );
  });

  it("treats an empty or short buffer as nothing to show", () => {
    expect(measure(new Uint8Array(0), 0, 0)).toEqual({
      coverage: 0,
      edgeEnergy: 0,
      localContrast: 0,
    });
    expect(looksBlank(measure(new Uint8Array(8), 4, 4))).toBe(true);
  });
});

describe("subjectThumbnailSize", () => {
  it("fits the long edge to the thumbnail side, keeping the shape", () => {
    expect(subjectThumbnailSize(2560, 1707)).toEqual({ width: 64, height: 43 });
    expect(subjectThumbnailSize(1280, 1920)).toEqual({ width: 43, height: 64 });
    expect(subjectThumbnailSize(2560, 1)).toEqual({ width: 64, height: 1 });
  });

  it("never enlarges", () => {
    expect(subjectThumbnailSize(3, 2)).toEqual({ width: 3, height: 2 });
    expect(SUBJECT_THUMBNAIL_SIDE).toBe(64);
  });
});

/* The thumbnail is an exact area average, drawn by this code on both sides,
   so the browser and the server measure the same numbers from the same
   pixels (round-5 review: canvas and libvips aliased differently on fine
   patterns). */
describe("subjectThumbnail", () => {
  const pixelAt = (
    thumb: ReturnType<typeof subjectThumbnail>,
    x: number,
    y: number,
  ) =>
    Array.from(
      thumb.pixels.subarray(
        (y * thumb.width + x) * 4,
        (y * thumb.width + x) * 4 + 4,
      ),
    );

  it("leaves an image at thumbnail size as it is", () => {
    const rgba = filled(10 * 10, [10, 20, 30, 255]);
    rgba.set([200, 100, 50, 255], 0);
    const thumb = subjectThumbnail(rgba, 10, 10, 4);
    expect(thumb).toMatchObject({ width: 10, height: 10 });
    expect(pixelAt(thumb, 0, 0)).toEqual([200, 100, 50, 255]);
    expect(pixelAt(thumb, 9, 9)).toEqual([10, 20, 30, 255]);
  });

  it("averages a 1 px checkerboard to flat grey, as any area average must", () => {
    const side = 1280;
    const rgba = new Uint8Array(side * side * 4);
    for (let i = 0; i < side * side; i += 1) {
      const v = (i % side) % 2 === Math.floor(i / side) % 2 ? 255 : 0;
      rgba.set([v, v, v, 255], i * 4);
    }
    const thumb = subjectThumbnail(rgba, side, side, 4);
    for (const v of thumb.pixels.filter((_, i) => i % 4 !== 3)) {
      expect(v).toBeCloseTo(127.5, 3);
    }
  });

  /* Round-6 review, B1: what the average throws away, the spread keeps. */
  it("keeps a 1 px checkerboard's full contrast in every cell's spread", () => {
    const side = 1280;
    const rgba = new Uint8Array(side * side * 4);
    for (let i = 0; i < side * side; i += 1) {
      const v = (i % side) % 2 === Math.floor(i / side) % 2 ? 255 : 0;
      rgba.set([v, v, v, 255], i * 4);
    }
    const thumb = subjectThumbnail(rgba, side, side, 4);
    expect(thumb.spread.length).toBe(64 * 64);
    for (const v of thumb.spread) expect(v).toBeCloseTo(127.5, 2);
    const result = measureSubject(thumb);
    expect(result).toMatchObject({ coverage: 0 });
    expect(result.edgeEnergy).toBeLessThan(MIN_EDGE_ENERGY);
    expect(result.localContrast).toBeCloseTo(127.5, 2);
    expect(looksBlank(result)).toBe(false);
  });

  /* In float32 a flat 40 px cell read as a spread of a few levels. */
  it("reads a flat image of any size and colour as no spread at all", () => {
    for (const [width, height] of [
      [2560, 1707],
      [4096, 4096],
      [333, 217],
    ]) {
      const thumb = subjectThumbnail(
        filled(width * height, [254, 251, 3, 255]),
        width,
        height,
        4,
      );
      expect(Math.max(...thumb.spread)).toBeLessThan(1e-3);
    }
  });

  it("measures the spread of a cell as the standard deviation of its pixels", () => {
    /* 128 x 128 into 64 x 64: each cell is 2 x 2, half 0 and half 200. */
    const rgba = filled(128 * 128, [200, 200, 200, 255]);
    for (let y = 0; y < 128; y += 1) {
      for (let x = 0; x < 128; x += 2)
        rgba.set([0, 0, 0, 255], (y * 128 + x) * 4);
    }
    const thumb = subjectThumbnail(rgba, 128, 128, 4);
    for (const v of thumb.spread) expect(v).toBeCloseTo(100, 3);
  });

  it("counts a fine alpha pattern's spread, whatever the colour", () => {
    const rgba = filled(640 * 640, [255, 255, 255, 255]);
    for (let i = 0; i < 640 * 640; i += 2) rgba[i * 4 + 3] = 0;
    const result = measureSubject(subjectThumbnail(rgba, 640, 640, 4));
    expect(result.localContrast).toBeCloseTo(127.5, 2);
  });

  /* 100 px into 64 cells: each cell is 1.5625 px, so most source pixels
     straddle two cells. */
  it("weights a pixel that straddles two cells by its share of each", () => {
    const rgba = filled(100, [0, 0, 0, 255]);
    rgba.set([255, 255, 255, 255], 1 * 4);
    const thumb = subjectThumbnail(rgba, 100, 1, 4);
    expect(thumb.width).toBe(64);
    expect(pixelAt(thumb, 0, 0)[0]).toBeCloseTo((0.5625 * 255) / 1.5625, 3);
    expect(pixelAt(thumb, 1, 0)[0]).toBeCloseTo((0.4375 * 255) / 1.5625, 3);
    expect(pixelAt(thumb, 2, 0)[0]).toBeCloseTo(0, 3);
  });

  it("keeps the mean of every channel", () => {
    const width = 333;
    const height = 217;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i += 1) rgba[i] = (i * 7919) % 256;
    const thumb = subjectThumbnail(rgba, width, height, 4);
    const mean = (values: ArrayLike<number>, c: number, count: number) => {
      let sum = 0;
      for (let i = 0; i < count; i += 1) sum += values[i * 4 + c];
      return sum / count;
    };
    expect(mean(thumb.pixels, 3, thumb.width * thumb.height)).toBeCloseTo(
      mean(rgba, 3, width * height),
      2,
    );
  });

  it("reads three channels as opaque four", () => {
    const rgb = new Uint8Array(300 * 200 * 3);
    const rgba = new Uint8Array(300 * 200 * 4);
    for (let i = 0; i < 300 * 200; i += 1) {
      const v = [(i * 13) % 256, (i * 29) % 256, (i * 31) % 256];
      rgb.set(v, i * 3);
      rgba.set([...v, 255], i * 4);
    }
    expect(subjectThumbnail(rgb, 300, 200, 3).pixels).toEqual(
      subjectThumbnail(rgba, 300, 200, 4).pixels,
    );
  });

  it("composites transparency onto mid grey before averaging", () => {
    const rgba = filled(128 * 128, [255, 255, 255, 0]);
    const thumb = subjectThumbnail(rgba, 128, 128, 4);
    expect(pixelAt(thumb, 5, 5)).toEqual([128, 128, 128, 0]);
  });
});

/* Round-5 review: the browser must never refuse what the server accepts. */
describe("browserLooksBlank", () => {
  const stripes = (contrast: number) => {
    const rgba = filled(64 * 64, [128, 128, 128, 255]);
    for (let i = 0; i < 64 * 64; i += 1) {
      const v = 128 + (i % 2 ? contrast : 0);
      rgba.set([v, v, v, 255], i * 4);
    }
    return subjectThumbnail(rgba, 64, 64, 4);
  };

  it("refuses only what the server refuses", () => {
    for (let contrast = 0; contrast <= 64; contrast += 1) {
      const thumb = stripes(contrast);
      if (browserLooksBlank(thumb)) {
        expect(looksBlank(measureSubject(thumb)), `contrast ${contrast}`).toBe(
          true,
        );
      }
    }
  });

  it("accepts inside the margin, where the server could go either way", () => {
    const thumb = stripes(MIN_EDGE_ENERGY - BROWSER_MARGIN.edgeEnergy / 2);
    const { edgeEnergy } = measureSubject(thumb);
    expect(edgeEnergy).toBeGreaterThanOrEqual(
      MIN_EDGE_ENERGY - BROWSER_MARGIN.edgeEnergy,
    );
    expect(looksBlank(measureSubject(thumb))).toBe(true);
    expect(browserLooksBlank(thumb)).toBe(false);
  });

  it("counts pixels the margin's width short of the deviation as far", () => {
    const rgba = filled(64 * 64, [200, 200, 200, 255]);
    const near = 200 - (SUBJECT_DEVIATION - BROWSER_MARGIN.deviation + 1);
    for (let row = 0; row < 40; row += 1) {
      rgba.set([near, near, near, 255], row * 64 * 4);
    }
    const thumb = subjectThumbnail(rgba, 64, 64, 4);
    expect(looksBlank(measureSubject(thumb))).toBe(true);
    expect(browserLooksBlank(thumb)).toBe(false);
  });

  /* A 1 px checker of two tones `contrast` apart has a spread of exactly
     half that in every cell, and nothing for the other two measures. */
  const fineChecker = (contrast: number) => {
    const side = 640;
    const rgba = filled(side * side, [100, 100, 100, 255]);
    for (let i = 0; i < side * side; i += 1) {
      if ((i % side) % 2 === Math.floor(i / side) % 2) {
        const v = 100 + contrast;
        rgba.set([v, v, v, 255], i * 4);
      }
    }
    return subjectThumbnail(rgba, side, side, 4);
  };

  it("refuses a fine pattern only where the server does", () => {
    for (let contrast = 0; contrast <= 48; contrast += 1) {
      const thumb = fineChecker(contrast);
      if (browserLooksBlank(thumb)) {
        expect(looksBlank(measureSubject(thumb)), `contrast ${contrast}`).toBe(
          true,
        );
      }
    }
  });

  it("accepts a fine pattern inside the local-contrast margin", () => {
    const thumb = fineChecker(
      2 * (MIN_LOCAL_CONTRAST - BROWSER_MARGIN.localContrast / 2),
    );
    expect(measureSubject(thumb).localContrast).toBeCloseTo(
      MIN_LOCAL_CONTRAST - BROWSER_MARGIN.localContrast / 2,
      3,
    );
    expect(looksBlank(measureSubject(thumb))).toBe(true);
    expect(browserLooksBlank(thumb)).toBe(false);
  });
});

/* FEAT-033 U3 live critic: a photo of a blank white sheet became the hero of
   a design. */
describe("looksBlank on whole images", () => {
  let fixtures: SubjectFixture[];
  beforeAll(async () => {
    fixtures = await subjectFixtures();
  }, 60_000);

  it("refuses the blank ones and keeps every minimal subject, on both sides", async () => {
    const wrong: string[] = [];
    for (const fixture of fixtures) {
      const { data, info } = await sharp(fixture.bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const thumb = subjectThumbnail(data, info.width, info.height, 4);
      const server = looksBlank(measureSubject(thumb));
      const browser = browserLooksBlank(thumb);
      if (server !== fixture.blank || browser !== fixture.blank) {
        wrong.push(`${fixture.name}: server ${server}, browser ${browser}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(fixtures.filter((f) => f.blank).length).toBeGreaterThanOrEqual(4);
    expect(fixtures.filter((f) => !f.blank).length).toBeGreaterThanOrEqual(6);
  }, 60_000);
});

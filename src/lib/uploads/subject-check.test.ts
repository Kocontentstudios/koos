// @vitest-environment node
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  looksBlank,
  MIN_EDGE_ENERGY,
  MIN_SUBJECT_COVERAGE,
  measureSubject,
  SUBJECT_THUMBNAIL_SIDE,
  subjectThumbnailSize,
} from "./subject-check";
import {
  boxThumbnail,
  type SubjectFixture,
  subjectFixtures,
} from "./subject-fixtures";

const filled = (count: number, rgba: [number, number, number, number]) => {
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < out.length; i += 4) out.set(rgba, i);
  return out;
};

describe("measureSubject", () => {
  it("finds nothing in a single flat colour, whatever the colour", () => {
    for (const colour of [
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [192, 57, 43, 255],
    ] as [number, number, number, number][]) {
      expect(measureSubject(filled(64 * 48, colour), 64, 48)).toEqual({
        coverage: 0,
        edgeEnergy: 0,
      });
    }
  });

  it("counts the share of pixels far from the median colour", () => {
    const pixels = filled(100, [255, 255, 255, 255]);
    pixels.set([0, 0, 0, 255], 0);
    pixels.set([255, 255, 230, 255], 4);
    pixels.set([255, 255, 231, 255], 8);
    expect(measureSubject(pixels, 10, 10).coverage).toBeCloseTo(0.02);
  });

  it("sees a change of hue at one brightness", () => {
    const pixels = filled(100, [200, 40, 40, 255]);
    for (let i = 0; i < 50; i += 1) pixels.set([40, 40, 200, 255], i * 4);
    expect(looksBlank(measureSubject(pixels, 10, 10))).toBe(false);
  });

  /* A white disc cut out on transparency is white on white once flattened,
     and is plainly a subject on any other ground. */
  it("counts a silhouette by its alpha, whatever its colour", () => {
    const pixels = filled(100, [255, 255, 255, 0]);
    for (let i = 0; i < 30; i += 1) pixels.set([255, 255, 255, 255], i * 4);
    expect(measureSubject(pixels, 10, 10).coverage).toBeCloseTo(0.3);
  });

  it("reports edge energy where nothing is far from the median", () => {
    const pixels = filled(64 * 64, [128, 128, 128, 255]);
    for (let i = 0; i < 64 * 64; i += 1) {
      const v = (i + Math.floor(i / 64)) % 2 ? 148 : 128;
      pixels.set([v, v, v, 255], i * 4);
    }
    const measure = measureSubject(pixels, 64, 64);
    expect(measure.coverage).toBe(0);
    expect(measure.edgeEnergy).toBeGreaterThan(MIN_EDGE_ENERGY);
    expect(looksBlank(measure)).toBe(false);
  });

  it("is blank only when both measures are under their floors", () => {
    expect(looksBlank({ coverage: 0, edgeEnergy: 0 })).toBe(true);
    expect(
      looksBlank({
        coverage: MIN_SUBJECT_COVERAGE,
        edgeEnergy: 0,
      }),
    ).toBe(false);
    expect(looksBlank({ coverage: 0, edgeEnergy: MIN_EDGE_ENERGY })).toBe(
      false,
    );
  });

  it("treats an empty or short buffer as nothing to show", () => {
    expect(measureSubject(new Uint8Array(0), 0, 0)).toEqual({
      coverage: 0,
      edgeEnergy: 0,
    });
    expect(looksBlank(measureSubject(new Uint8Array(8), 4, 4))).toBe(true);
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

/* FEAT-033 U3 live critic: a photo of a blank white sheet became the hero of
   a design. The same decision whichever resampler drew the thumbnail: libvips
   on the server, a canvas (area averaging) in the browser. */
describe("looksBlank on whole images", () => {
  let fixtures: SubjectFixture[];
  beforeAll(async () => {
    fixtures = await subjectFixtures();
  }, 60_000);

  async function verdicts(fixture: SubjectFixture) {
    const server = await sharp(fixture.bytes)
      .resize(SUBJECT_THUMBNAIL_SIDE, SUBJECT_THUMBNAIL_SIDE, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const full = await sharp(fixture.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const size = subjectThumbnailSize(full.info.width, full.info.height);
    const browser = boxThumbnail(
      full.data,
      full.info.width,
      full.info.height,
      size,
    );
    return {
      server: looksBlank(
        measureSubject(server.data, server.info.width, server.info.height),
      ),
      browser: looksBlank(measureSubject(browser, size.width, size.height)),
    };
  }

  it("refuses the blank ones and keeps every minimal subject", async () => {
    const wrong: string[] = [];
    for (const fixture of fixtures) {
      const { server, browser } = await verdicts(fixture);
      if (server !== fixture.blank || browser !== fixture.blank) {
        wrong.push(`${fixture.name}: server ${server}, browser ${browser}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(fixtures.filter((f) => f.blank).length).toBeGreaterThanOrEqual(4);
    expect(fixtures.filter((f) => !f.blank).length).toBeGreaterThanOrEqual(6);
  }, 60_000);
});

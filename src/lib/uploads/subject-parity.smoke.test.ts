// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SubjectMeasure, SubjectThumbnail } from "./subject-check";

const getObjectBytes = vi.fn();
const serverMeasured: {
  thumbnail: SubjectThumbnail;
  measure: SubjectMeasure;
}[] = [];

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

/* Records what the loader measured, so the browser's numbers can be set
   beside the server's for the same image. */
vi.mock("./subject-check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subject-check")>();
  return {
    ...actual,
    measureSubject: (thumbnail: SubjectThumbnail, limit?: number) => {
      const measure = actual.measureSubject(thumbnail, limit);
      serverMeasured.push({ thumbnail, measure });
      return measure;
    },
  };
});

import sharp from "sharp";
import { DesignImageError, loadDesignImage } from "./design-image";
import {
  BROWSER_MARGIN,
  browserLooksBlank,
  measureSubject,
  subjectThumbnail,
} from "./subject-check";
import {
  hasTransparency,
  type ParityPattern,
  parityPatterns,
} from "./subject-parity-fixtures";

/**
 * Round-5 review: the browser and the server blank checks could disagree on
 * fine patterns, because a canvas and libvips drew the thumbnail. The server
 * is authoritative, so the browser must never refuse what it accepts. Each
 * pattern goes through the browser's decision on the canvas pixels and
 * through the real loadDesignImage on the file the browser would upload:
 * JPEG at quality 0.9 with 4:2:0 chroma (what Chromium's toBlob writes), or
 * PNG when it has transparency.
 *
 * The real canvas is exercised by `corepack pnpm eval:subject-parity`, in
 * headless Chromium on the same patterns.
 */

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

interface Row {
  name: string;
  browserRefuses: boolean;
  server: string;
  browserMeasure: SubjectMeasure;
  serverMeasure: SubjectMeasure | null;
  maxPixelGap: number;
}

async function upload(pattern: ParityPattern) {
  const raw = sharp(Buffer.from(pattern.rgba), {
    raw: { width: pattern.width, height: pattern.height, channels: 4 },
  });
  if (hasTransparency(pattern)) {
    return { type: "png" as const, bytes: await raw.png().toBuffer() };
  }
  const bytes = await raw
    .removeAlpha()
    .jpeg({ quality: 90, chromaSubsampling: "4:2:0", quantisationTable: 0 })
    .toBuffer();
  return { type: "jpeg" as const, bytes };
}

async function serverOutcome(type: "png" | "jpeg", bytes: Buffer) {
  getObjectBytes.mockResolvedValue(bytes);
  const key = `design-images/${BRAND}/${ID}.${type === "png" ? "png" : "jpg"}`;
  try {
    await loadDesignImage(key, BRAND);
    return "accepted";
  } catch (err) {
    if (err instanceof DesignImageError) return err.fault;
    throw err;
  }
}

function maxGap(a: SubjectThumbnail, b: SubjectThumbnail): number {
  let gap = 0;
  for (let i = 0; i < a.pixels.length; i += 1) {
    gap = Math.max(gap, Math.abs(a.pixels[i] - b.pixels[i]));
  }
  return gap;
}

describe("the subject check, browser against server, on fine patterns", () => {
  const rows: Row[] = [];

  beforeAll(async () => {
    for await (const pattern of parityPatterns()) {
      const thumbnail = subjectThumbnail(
        pattern.rgba,
        pattern.width,
        pattern.height,
        4,
      );
      serverMeasured.length = 0;
      const { type, bytes } = await upload(pattern);
      const server = await serverOutcome(type, bytes);
      const measured = serverMeasured.at(-1);
      rows.push({
        name: pattern.name,
        browserRefuses: browserLooksBlank(thumbnail),
        server,
        browserMeasure: measureSubject(thumbnail),
        serverMeasure: measured?.measure ?? null,
        maxPixelGap: measured ? maxGap(thumbnail, measured.thumbnail) : 0,
      });
    }
  }, 600_000);

  it("covers checkerboards, stripes, halftone and noise, refused and accepted", () => {
    expect(rows.length).toBeGreaterThanOrEqual(120);
    for (const kind of ["checker", "stripes", "halftone", "noise", "alpha"]) {
      expect(
        rows.some((r) => r.name.startsWith(kind)),
        kind,
      ).toBe(true);
    }
    expect(rows.some((r) => r.server === "no_subject")).toBe(true);
    expect(rows.some((r) => r.server === "accepted")).toBe(true);
  });

  it("only ever accepts or refuses as no_subject", () => {
    expect(
      rows.filter((r) => r.server !== "accepted" && r.server !== "no_subject"),
    ).toEqual([]);
  });

  it("never refuses in the browser what the server accepts", () => {
    expect(
      rows
        .filter((r) => r.browserRefuses && r.server === "accepted")
        .map((r) => r.name),
    ).toEqual([]);
  });

  /* The margin is only safe while the two measures stay well inside it. */
  it("keeps the browser's numbers within half the margin of the server's", () => {
    const measured = rows.filter((r) => r.serverMeasure);
    expect(measured.length).toBe(rows.length);
    const worstPixel = Math.max(...measured.map((r) => r.maxPixelGap));
    const worstEdge = Math.max(
      ...measured.map((r) =>
        Math.abs(
          r.browserMeasure.edgeEnergy - (r.serverMeasure?.edgeEnergy ?? 0),
        ),
      ),
    );
    expect(worstPixel).toBeLessThanOrEqual(BROWSER_MARGIN.deviation / 2);
    expect(worstEdge).toBeLessThanOrEqual(BROWSER_MARGIN.edgeEnergy / 2);
  });
});

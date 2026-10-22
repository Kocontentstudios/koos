// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { DesignImageError, loadDesignImage } from "./design-image";
import {
  IMAGE_NOT_USABLE_PREFIX,
  NO_SUBJECT_REASON,
  NORMALISED_LONG_EDGE,
} from "./design-image-limits";
import { type SubjectFixture, subjectFixtures } from "./subject-fixtures";

/**
 * FEAT-033 U3 live critic: a near-blank photo was accepted and became a
 * design's hero. The loader refuses a blank or near-uniform image as
 * no_subject, on the real re-encode, and keeps every minimal subject.
 */

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const KEY = {
  png: `design-images/${BRAND}/${ID}.png`,
  jpeg: `design-images/${BRAND}/${ID}.jpg`,
};

async function outcome(type: "png" | "jpeg", bytes: Buffer) {
  getObjectBytes.mockResolvedValue(bytes);
  try {
    await loadDesignImage(KEY[type], BRAND);
    return "accepted";
  } catch (err) {
    if (err instanceof DesignImageError) return err.fault;
    throw err;
  }
}

describe("loadDesignImage refuses images with nothing to show", () => {
  let fixtures: SubjectFixture[];
  beforeAll(async () => {
    fixtures = await subjectFixtures();
  }, 60_000);

  it("refuses each blank one as no_subject and accepts each subject", async () => {
    const wrong: string[] = [];
    for (const { name, type, bytes, blank } of fixtures) {
      const got = await outcome(type, bytes);
      if (got !== (blank ? "no_subject" : "accepted")) {
        wrong.push(`${name}: ${got}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 60_000);

  it("says so in plain words, with the shared prefix", async () => {
    const [nearWhite] = fixtures;
    getObjectBytes.mockResolvedValue(nearWhite.bytes);
    await expect(loadDesignImage(KEY.jpeg, BRAND)).rejects.toThrow(
      `${IMAGE_NOT_USABLE_PREFIX}: ${NO_SUBJECT_REASON}`,
    );
    expect(NO_SUBJECT_REASON).toMatch(/^it looks blank/);
  });
});

/* The critic's own photos: royalty-free stock kept outside the repo, so this
   runs where they are present (the FEAT-033 review machine) and is skipped
   elsewhere; subjectFixtures covers the same ground in every run. Each is
   normalised first as the browser does (2560 px long edge, JPEG q0.9), since
   three are over the server's 4096 px cap on their own. */
const CRITIC_FIXTURES = "/tmp/feat-033/fixtures";

describe.skipIf(!existsSync(CRITIC_FIXTURES))(
  "loadDesignImage on the U3 critic's photos",
  () => {
    const expected: Record<string, string> = {
      "photo-a.jpg": "no_subject",
      "photo-b.jpg": "no_subject",
      "cutout.png": "accepted",
      "busy-cafe-espresso.jpg": "accepted",
      "busy-storefront-24mp.jpg": "accepted",
      "sky-over-stone.jpg": "accepted",
      "portrait-fashion.jpg": "accepted",
    };

    it.each(Object.entries(expected))(
      "%s is %s",
      async (file, want) => {
        const source = readFileSync(join(CRITIC_FIXTURES, file));
        const { hasAlpha } = await sharp(source).metadata();
        const fitted = sharp(source).autoOrient().resize({
          width: NORMALISED_LONG_EDGE,
          height: NORMALISED_LONG_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        });
        const stored = hasAlpha
          ? await fitted.png().toBuffer()
          : await fitted.jpeg({ quality: 90 }).toBuffer();
        expect(await outcome(hasAlpha ? "png" : "jpeg", stored)).toBe(want);
      },
      30_000,
    );
  },
);

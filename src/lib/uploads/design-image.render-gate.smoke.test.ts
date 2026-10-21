// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import {
  type HostileImage,
  hostileImageCorpus,
} from "@/lib/images/hostile-image-fixtures";
import { type ImageToDraw, renderInChild } from "@/lib/images/render-in-child";
import { DesignImageError, loadDesignImage } from "./design-image";
import { IMAGE_NOT_USABLE_PREFIX } from "./design-image-limits";

/**
 * FEAT-033 round-2 critic, B5 and B6: files that passed the loader's
 * structural check aborted the renderer process (an indexed PNG whose PLTE
 * length is not a multiple of 3 panics resvg with SIGABRT) or were drawn as an
 * empty slot. The gate: run the whole hostile corpus through the loader, then
 * draw everything it accepted through the real next/og in a child process.
 * Accepted means drawn; refused means the user-facing message.
 */

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const KEY = {
  png: `design-images/${BRAND}/${ID}.png`,
  jpeg: `design-images/${BRAND}/${ID}.jpg`,
};

/* Each of these passed the round-2 loader and then aborted the renderer,
   threw a TypeError, or drew nothing. */
const ROUND_2_BREAKS = [
  "c-plte_len_not_mult3.png",
  "p-pal8-plte-len4.png",
  "p-pal8-plte-len5.png",
  "p-pal8-plte-len7.png",
  "p-pal8-plte-len8.png",
  "c-idat_split_by_text.png",
  "c-unknown_critical_ABCD.png",
  "c-plte_twice.png",
  "c-plte_300_entries.png",
  "c-two_ihdr.png",
  "j-base-no-dqt.jpg",
  "j-base-sof-marker-c3-lossless.jpg",
  "j-base-sof-precision12.jpg",
  "j-base-sof-sampling0.jpg",
  "j-base-sos-component-id-99.jpg",
  "j-base-no-dht.jpg",
  "j-prog-dqt-precision16.jpg",
  "j-prog-sos-ah-al-15.jpg",
  "s-1x1-transparent.png",
];

/* Every pixel transparent: drawn, indistinguishable from no image. */
const BLANK = [
  "s-1x1-transparent.png",
  "s-1x1-transparent-interlaced.png",
  "m-max-4096-rgba16-transparent.png",
];

interface Outcome {
  image: HostileImage;
  accepted?: ImageToDraw & { width: number; height: number };
  refused?: unknown;
}

describe("loadDesignImage against the hostile corpus", () => {
  let outcomes: Outcome[];

  beforeAll(async () => {
    const corpus = await hostileImageCorpus();
    outcomes = [];
    for (const image of corpus) {
      getObjectBytes.mockResolvedValue(image.bytes);
      try {
        const loaded = await loadDesignImage(KEY[image.type], BRAND);
        outcomes.push({
          image,
          accepted: {
            name: image.name,
            contentType: loaded.contentType,
            bytes: loaded.bytes,
            width: loaded.width,
            height: loaded.height,
          },
        });
      } catch (refused) {
        outcomes.push({ image, refused });
      }
    }
  }, 120_000);

  const byName = (name: string) => {
    const found = outcomes.find((o) => o.image.name === name);
    if (!found) throw new Error(`${name} is not in the corpus`);
    return found;
  };

  it("covers the corpus the critic ran", () => {
    expect(outcomes.length).toBeGreaterThanOrEqual(169);
    for (const name of [...ROUND_2_BREAKS, ...BLANK]) byName(name);
  });

  it("refuses every file with the user-facing message", () => {
    const wrong = outcomes
      .filter(({ refused }) => refused !== undefined)
      .filter(
        ({ refused }) =>
          !(refused instanceof DesignImageError) ||
          !refused.message.startsWith(`${IMAGE_NOT_USABLE_PREFIX}: `),
      )
      .map(({ image, refused }) => `${image.name}: ${String(refused)}`);
    expect(wrong).toEqual([]);
  });

  it("refuses every file that broke the round-2 loader", () => {
    const accepted = ROUND_2_BREAKS.filter((name) => byName(name).accepted);
    expect(accepted).toEqual([]);
  });

  it("refuses a fully transparent image as blank", () => {
    for (const name of BLANK) {
      const { refused } = byName(name);
      expect(refused, name).toBeInstanceOf(DesignImageError);
      expect((refused as DesignImageError).fault, name).toBe("blank");
    }
  });

  /* The other side of the bar: the gate is worthless if it passes by refusing
     everything. Every file libvips encoded itself is a real image. */
  it("accepts every valid image it was given", () => {
    const valid = outcomes.filter(
      ({ image }) => image.name.startsWith("s-") && !BLANK.includes(image.name),
    );
    expect(valid.length).toBeGreaterThanOrEqual(23);
    const refused = valid
      .filter(({ refused }) => refused)
      .map(({ image, refused }) => `${image.name}: ${String(refused)}`);
    expect(refused).toEqual([]);
  });

  it("hands on only a plain 8-bit PNG or a baseline JPEG", () => {
    for (const { accepted } of outcomes) {
      if (!accepted) continue;
      const { bytes, contentType, name } = accepted;
      if (contentType === "image/png") {
        expect(bytes[24], `${name} bit depth`).toBe(8);
        expect([2, 6], `${name} colour type`).toContain(bytes[25]);
        expect(bytes[28], `${name} interlace`).toBe(0);
      } else {
        expect(
          Buffer.from(bytes).indexOf(Buffer.from([0xff, 0xc0])),
          name,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("draws everything it accepted, and the renderer survives it", () => {
    const accepted = outcomes.flatMap(({ accepted }) =>
      accepted ? [accepted] : [],
    );
    expect(accepted.length).toBeGreaterThan(60);

    const run = renderInChild(accepted);
    expect(
      { status: run.status, signal: run.signal, last: run.lastStarted },
      run.stderr.slice(-2000),
    ).toEqual({ status: 0, signal: null, last: accepted.at(-1)?.name });
    const notDrawn = Object.entries(run.verdicts).filter(
      ([, verdict]) => verdict !== "drawn",
    );
    expect(notDrawn).toEqual([]);
    expect(Object.keys(run.verdicts)).toHaveLength(accepted.length);
  }, 120_000);
});

/* Proof the gate can fail: the same harness, handed the stored bytes the
   loader now refuses, sees the abort and the empty slot it exists to catch. */
describe("the child-process render gate", () => {
  it("reports the round-2 abort when given the raw palette file", async () => {
    const corpus = await hostileImageCorpus();
    const crash = corpus.find((i) => i.name === "p-pal8-plte-len4.png");
    const control = corpus.find((i) => i.name === "s-rgb8.png");
    if (!crash || !control) throw new Error("fixture missing");

    const run = renderInChild([
      { name: "control", contentType: "image/png", bytes: control.bytes },
      { name: "crash", contentType: "image/png", bytes: crash.bytes },
    ]);
    expect(run.status).not.toBe(0);
    expect(run.lastStarted).toBe("crash");
    expect(run.stderr).toMatch(/panicked/);
  }, 60_000);

  it("reports a transparent image as empty, not drawn", async () => {
    const corpus = await hostileImageCorpus();
    const blank = corpus.find((i) => i.name === "s-1x1-transparent.png");
    if (!blank) throw new Error("fixture missing");
    const run = renderInChild([
      { name: "blank", contentType: "image/png", bytes: blank.bytes },
    ]);
    expect(run.verdicts).toEqual({ blank: "empty" });
  }, 60_000);
});

// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import sharp from "sharp";
import {
  type HostileImage,
  hostileImageCorpus,
} from "@/lib/images/hostile-image-fixtures";
import { pngChunk } from "@/lib/images/image-fixtures";
import {
  attackerSizedImages,
  photographicCutoutPng,
  photographicJpeg,
} from "@/lib/images/large-image-fixtures";
import {
  RENDERER_IMAGE_BYTE_BUDGET,
  RENDERER_MAX_IMAGE_BYTES,
} from "@/lib/images/reencode";
import { type ImageToDraw, renderInChild } from "@/lib/images/render-in-child";
import { DesignImageError, loadDesignImage } from "./design-image";
import {
  IMAGE_NOT_USABLE_PREFIX,
  MAX_DESIGN_IMAGE_BYTES,
  NORMALISED_LONG_EDGE,
} from "./design-image-limits";

/**
 * FEAT-033 round-2 critic, B5 and B6: files that passed the loader's
 * structural check aborted the renderer process (an indexed PNG whose PLTE
 * length is not a multiple of 3 panics the rasteriser's PNG decoder with
 * SIGABRT) or were drawn as an empty slot. Round 3, B7: an accepted image over
 * 7,499,820 bytes throws inside the render. The gate: run the hostile corpus
 * and images at the size limits through the loader, then draw everything it
 * accepted through the real next/og (sharp/librsvg here) in a child process.
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

/* Round-3 critic B7. next/og rasterises with sharp, so libxml2 parses the
   satori SVG, and it refuses an attribute over 10,000,000 characters: an
   image over 7,499,820 bytes, inlined as base64, throws. The loader fitted
   pixels but not bytes, so the normaliser's own 2560 px cutout passed it and
   then threw inside renderCompositeDesign. */
describe("loadDesignImage keeps images at the size limits drawable", () => {
  interface Sized {
    name: string;
    type: "png" | "jpeg";
    bytes: Buffer;
  }
  let inputs: Sized[];
  let loaded: Map<string, Awaited<ReturnType<typeof loadDesignImage>>>;
  let unbounded: Buffer;

  const loadedAs = (name: string) => {
    const image = loaded.get(name);
    if (!image) throw new Error(`${name} was not loaded`);
    return image;
  };

  beforeAll(async () => {
    const cutout = await photographicCutoutPng(NORMALISED_LONG_EDGE);
    /* What round 3 handed the renderer for the same file: a plain re-encode
       at full size, with no byte bound. */
    unbounded = await sharp(cutout).png().toBuffer();
    inputs = [
      { name: "photo-cutout-2560.png", type: "png", bytes: cutout },
      {
        name: "photo-2560.jpg",
        type: "jpeg",
        bytes: await photographicJpeg(NORMALISED_LONG_EDGE),
      },
      ...(await attackerSizedImages()),
    ];
    loaded = new Map();
    for (const input of inputs) {
      getObjectBytes.mockResolvedValue(input.bytes);
      loaded.set(input.name, await loadDesignImage(KEY[input.type], BRAND));
    }
  }, 120_000);

  it("reproduces the round-3 break: unbounded, the cutout is over the limit", () => {
    expect(unbounded.length).toBeGreaterThan(RENDERER_MAX_IMAGE_BYTES);
  });

  /* Storage enforces the cap and is mocked here, so a fixture over it would
     test a file no member can store. */
  it("feeds only files a member can store", () => {
    for (const { name, bytes } of inputs) {
      expect(bytes.length, name).toBeLessThanOrEqual(MAX_DESIGN_IMAGE_BYTES);
    }
  });

  it("accepts every one, within the byte budget and the normaliser's bound", () => {
    for (const { name } of inputs) {
      const image = loadedAs(name);
      expect(image.bytes.length, name).toBeLessThanOrEqual(
        RENDERER_IMAGE_BYTE_BUDGET,
      );
      const longEdge = Math.max(image.width, image.height);
      expect(longEdge, name).toBeLessThanOrEqual(NORMALISED_LONG_EDGE);
      expect(longEdge, name).toBeGreaterThanOrEqual(1080);
    }
  });

  it("draws every one, and the renderer survives", () => {
    const drawn = inputs.map(({ name }) => {
      const { contentType, bytes } = loadedAs(name);
      return { name, contentType, bytes };
    });
    const run = renderInChild(drawn);
    expect(
      { status: run.status, signal: run.signal, last: run.lastStarted },
      run.stderr.slice(-2000),
    ).toEqual({ status: 0, signal: null, last: drawn.at(-1)?.name });
    expect(run.verdicts).toEqual(
      Object.fromEntries(drawn.map(({ name }) => [name, "drawn"])),
    );
  }, 120_000);

  /* The production path end to end: each accepted image is the plate of a
     full 1080 x 1350 design through renderCompositeDesign, in a child
     process, so an abort fails this test rather than killing the worker. */
  it("composes every one into a real design, in a child process", () => {
    const plates = inputs.map(({ name }) => {
      const { contentType, bytes } = loadedAs(name);
      return { name, contentType, bytes };
    });
    const run = renderInChild(plates, { via: "composite" });
    expect(
      { status: run.status, signal: run.signal, last: run.lastStarted },
      run.stderr.slice(-2000),
    ).toEqual({ status: 0, signal: null, last: plates.at(-1)?.name });
    expect(run.verdicts).toEqual(
      Object.fromEntries(plates.map(({ name }) => [name, "drawn"])),
    );
  }, 300_000);

  /* Proof this gate can fail: the bytes round 3 returned for the same cutout
     throw in the same composite. */
  it("sees the unbounded re-encode throw in the composite", () => {
    const run = renderInChild(
      [{ name: "unbounded", contentType: "image/png", bytes: unbounded }],
      { via: "composite" },
    );
    expect(run.status, run.stderr.slice(-2000)).toBe(0);
    expect(run.verdicts.unbounded).toMatch(
      /^threw .*XML parse error: Error domain 1 code 114 /,
    );
  }, 120_000);
});

/* The byte budget is derived from libxml2's limit, which only binds when
   next/og rasterises with sharp. Should sharp ever stop resolving, next/og
   falls back to resvg-wasm, the one-over image draws, and this fails. */
describe("the renderer the gate exercises", () => {
  async function paddedPng(total: number): Promise<Buffer> {
    const base = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#0a0" },
    })
      .png()
      .toBuffer();
    const filler = pngChunk("zzZz", Buffer.alloc(total - base.length - 12, 65));
    return Buffer.concat([base.subarray(0, 33), filler, base.subarray(33)]);
  }

  it("draws an image at the measured limit and throws one byte over it", async () => {
    const run = renderInChild([
      {
        name: "at-limit",
        contentType: "image/png",
        bytes: await paddedPng(RENDERER_MAX_IMAGE_BYTES),
      },
      {
        name: "one-over",
        contentType: "image/png",
        bytes: await paddedPng(RENDERER_MAX_IMAGE_BYTES + 1),
      },
    ]);
    expect(run.status, run.stderr.slice(-2000)).toBe(0);
    expect(run.verdicts["at-limit"]).toBe("drawn");
    expect(run.verdicts["one-over"]).toMatch(
      /^threw .*XML parse error: Error domain 1 code 114 /,
    );
  }, 120_000);
});

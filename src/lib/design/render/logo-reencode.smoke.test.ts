// @vitest-environment node
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();
const probed: { bytes: Uint8Array; contentType: string }[] = [];

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

/* Captures exactly what would reach next/og, so it can be drawn in a child
   process. The real probe in this worker would take the worker down with the
   process it is meant to protect. */
vi.mock("@/lib/design/render/logo-probe", () => ({
  probeLogo: async (logo: { bytes: Uint8Array; contentType: string }) => {
    probed.push(logo);
    return { drawable: true, darkest: 0.5, lightest: 0.5, aspect: 1 };
  },
}));

import {
  type HostileImage,
  hostileImageCorpus,
} from "@/lib/images/hostile-image-fixtures";
import { photographicCutoutPng } from "@/lib/images/large-image-fixtures";
import { reencodeImage } from "@/lib/images/reencode";
import { type ImageToDraw, renderInChild } from "@/lib/images/render-in-child";
import { LOGO_FILE_FAULTS, LOGO_REENCODE, loadBrandLogo } from "./logo";

/**
 * FEAT-033 round-2 critic: loadBrandLogo handed the stored bytes straight to
 * probeLogo (next/og), and an indexed PNG with a 4-byte PLTE aborted the
 * process there (upload-r2-logo-path.log). Logos have no browser normaliser
 * at all, so this is the path an ordinary logo upload reaches.
 */

const BASE = "https://cdn.example.test";
const LOGO_URL = `${BASE}/logos/u1/a.png`;

/* Every pixel transparent. They reach the probe, which is what reports them
   ("could not decode it"); they cannot reach a design. The overflow bomb is
   one of them: libpng stops at the 100x100 the header promises, and those
   rows are all zero. */
const BLANK = new Set([
  "s-1x1-transparent.png",
  "s-1x1-transparent-interlaced.png",
  "m-max-4096-rgba16-transparent.png",
  "m-bomb-overflow-100x100.png",
]);

interface Outcome {
  image: HostileImage;
  probedAs?: ImageToDraw;
  fault: string | null;
}

describe("loadBrandLogo against the hostile corpus", () => {
  let outcomes: Outcome[];

  beforeAll(async () => {
    process.env.R2_PUBLIC_BASE_URL = BASE;
    vi.spyOn(console, "error").mockImplementation(() => {});
    outcomes = [];
    for (const image of await hostileImageCorpus()) {
      getObjectBytes.mockResolvedValue(image.bytes);
      probed.length = 0;
      const { fault } = await loadBrandLogo(LOGO_URL);
      const [reached] = probed;
      outcomes.push({
        image,
        fault,
        probedAs: reached && {
          name: image.name,
          contentType: reached.contentType,
          bytes: reached.bytes,
        },
      });
    }
    vi.mocked(console.error).mockRestore();
  }, 120_000);

  /* A file libvips encoded itself can come back byte-identical, which is
     fine: it is the same encoder. A hostile file never can. */
  it("never hands the probe a hostile file's stored bytes", () => {
    const raw = outcomes.filter(
      ({ image, probedAs }) =>
        !image.name.startsWith("s-") &&
        probedAs &&
        Buffer.from(probedAs.bytes).equals(image.bytes),
    );
    expect(raw.map(({ image }) => image.name)).toEqual([]);
  });

  it("hands the probe only a plain 8-bit PNG or a baseline JPEG", () => {
    for (const { probedAs } of outcomes) {
      if (!probedAs) continue;
      const { bytes, contentType, name } = probedAs;
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

  it("stops the round-2 crash before the renderer", () => {
    for (const name of [
      "c-plte_len_not_mult3.png",
      "p-pal8-plte-len4.png",
      "p-pal8-plte-len8.png",
    ]) {
      const outcome = outcomes.find(({ image }) => image.name === name);
      expect(outcome?.probedAs, name).toBeUndefined();
      expect(outcome?.fault, name).toMatch(/could not decode it/);
    }
  });

  it("reports every refusal as the file's fault, with its remedy", () => {
    const unexplained = outcomes
      .filter(({ fault }) => fault !== null)
      .filter(
        ({ fault }) =>
          !LOGO_FILE_FAULTS.includes(
            fault as (typeof LOGO_FILE_FAULTS)[number],
          ),
      )
      .map(({ image, fault }) => `${image.name}: ${fault}`);
    expect(unexplained).toEqual([]);
  });

  it("loads every valid logo it was given", () => {
    const refused = outcomes
      .filter(({ image }) => image.name.startsWith("s-"))
      .filter(({ fault }) => fault !== null)
      .map(({ image, fault }) => `${image.name}: ${fault}`);
    expect(refused).toEqual([]);
  });

  it("draws everything that reaches the probe, and the renderer survives", () => {
    const reached = outcomes.flatMap(({ probedAs }) =>
      probedAs ? [probedAs] : [],
    );
    expect(reached.length).toBeGreaterThan(60);

    const run = renderInChild(reached);
    expect(
      { status: run.status, signal: run.signal, last: run.lastStarted },
      run.stderr.slice(-2000),
    ).toEqual({ status: 0, signal: null, last: reached.at(-1)?.name });
    const notDrawn = Object.entries(run.verdicts)
      .filter(([name]) => !BLANK.has(name))
      .filter(([, verdict]) => verdict !== "drawn");
    expect(notDrawn).toEqual([]);
    for (const name of BLANK) expect(run.verdicts[name]).toBe("empty");
  }, 120_000);
});

/* The re-encode is a safety step, not a restyle. Drawn where the design draws
   a logo, a valid file looks the same before and after. */
describe("a valid logo looks the same after the re-encode", () => {
  const SIZE = 96;

  async function draw(bytes: Uint8Array, contentType: string) {
    const response = new ImageResponse(
      {
        type: "div",
        props: {
          style: { display: "flex", width: SIZE, height: SIZE },
          children: {
            type: "img",
            props: {
              src: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
              width: SIZE,
              height: SIZE,
              style: { objectFit: "contain" },
            },
          },
        },
      } as never,
      { width: SIZE, height: SIZE },
    );
    return sharp(Buffer.from(await response.arrayBuffer()))
      .ensureAlpha()
      .raw()
      .toBuffer();
  }

  async function meanDifference(image: HostileImage) {
    const contentType = image.type === "png" ? "image/png" : "image/jpeg";
    const clean = await reencodeImage(image.bytes, image.type, LOGO_REENCODE);
    const [before, after] = await Promise.all([
      draw(image.bytes, contentType),
      draw(clean.bytes, contentType),
    ]);
    let total = 0;
    for (let i = 0; i < before.length; i += 1) {
      total += Math.abs(before[i] - after[i]);
    }
    return total / before.length;
  }

  /* 8-bit sRGB PNGs, which is what design tools export: not one value
     changes. */
  it.each([
    "s-rgba8.png",
    "s-rgba8-interlaced.png",
    "s-rgb8.png",
    "s-palette8.png",
    "s-palette4.png",
    "s-palette1.png",
    "s-gray8.png",
    "s-grayalpha8.png",
  ])(
    "%s draws identically",
    async (name) => {
      const image = (await hostileImageCorpus()).find((i) => i.name === name);
      if (!image) throw new Error(`${name} missing`);
      expect(await meanDifference(image)).toBe(0);
    },
    60_000,
  );

  /* Rounded to 8 bits, or re-encoded at quality 92: within a level of one
     channel value on average, which no one can see. */
  it.each([
    "s-rgba16.png",
    "s-gray16.png",
    "s-baseline.jpg",
    "s-progressive.jpg",
    "s-444.jpg",
    "s-gray.jpg",
  ])(
    "%s draws within one level",
    async (name) => {
      const image = (await hostileImageCorpus()).find((i) => i.name === name);
      if (!image) throw new Error(`${name} missing`);
      expect(await meanDifference(image)).toBeLessThan(1);
    },
    60_000,
  );
});

/* Round-3 critic C4 and C3, both regressions against round 2: a valid 2560 px
   cutout logo re-encoded at 4096 px to 9.4 MB, past what the renderer parses,
   and a JPEG logo whose end marker is missing (every browser draws one) was
   refused. Both were reported to the brand as damaged. */
describe("logos round 3 reported as damaged", () => {
  beforeAll(() => {
    process.env.R2_PUBLIC_BASE_URL = BASE;
  });

  async function probedFor(bytes: Buffer, url = LOGO_URL) {
    getObjectBytes.mockResolvedValue(bytes);
    probed.length = 0;
    const { fault } = await loadBrandLogo(url);
    return { fault, reached: probed[0] };
  }

  it("loads and draws a 2560 px photographic cutout", async () => {
    const { fault, reached } = await probedFor(
      await photographicCutoutPng(2560),
    );
    expect(fault).toBeNull();
    const meta = await sharp(Buffer.from(reached.bytes)).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(
      1024,
    );
    const run = renderInChild([
      {
        name: "cutout",
        contentType: reached.contentType,
        bytes: reached.bytes,
      },
    ]);
    expect(run.verdicts).toEqual({ cutout: "drawn" });
  }, 60_000);

  it("loads and draws a JPEG logo with no end marker", async () => {
    const corpus = await hostileImageCorpus();
    const whole = corpus.find((i) => i.name === "s-baseline.jpg");
    if (!whole) throw new Error("fixture missing");
    const { fault, reached } = await probedFor(
      whole.bytes.subarray(0, -2),
      `${BASE}/logos/u1/a.jpg`,
    );
    expect(fault).toBeNull();
    const run = renderInChild([
      {
        name: "no-eoi",
        contentType: reached.contentType,
        bytes: reached.bytes,
      },
    ]);
    expect(run.verdicts).toEqual({ "no-eoi": "drawn" });
  }, 60_000);

  it("still refuses a JPEG logo cut off inside its scan", async () => {
    const corpus = await hostileImageCorpus();
    const whole = corpus.find((i) => i.name === "s-baseline.jpg");
    if (!whole) throw new Error("fixture missing");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fault, reached } = await probedFor(
      whole.bytes.subarray(0, Math.floor(whole.bytes.length * 0.6)),
      `${BASE}/logos/u1/a.jpg`,
    );
    vi.mocked(console.error).mockRestore();
    expect(reached).toBeUndefined();
    expect(fault).toMatch(/could not decode it/);
  });
});

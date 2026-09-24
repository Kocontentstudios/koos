// @vitest-environment node
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  groundLuminanceUnderLogo,
  logoBackingFor,
} from "@/lib/design/logo-contrast";
import { relativeLuminance } from "@/lib/design/palette";
import { logoPng } from "@/lib/design/render/logo-fixtures";
import { decodePngRgba } from "@/lib/images/png-pixels";

const lum = relativeLuminance;
/** A mark whose ink is all one tone. */
const flat = (hex: string) => ({ darkest: lum(hex), lightest: lum(hex) });

describe("logoBackingFor", () => {
  it("leaves a light mark on a dark ground alone", () => {
    expect(
      logoBackingFor({ ink: flat("#FFFFFF"), ground: lum("#0F172A") }).backing,
    ).toBeNull();
  });

  it("leaves a dark mark on a light ground alone", () => {
    expect(
      logoBackingFor({ ink: flat("#111111"), ground: lum("#FFFFFF") }).backing,
    ).toBeNull();
  });

  /* The failure the renderer could not see: the mark is drawn, every check
     passes, and it is invisible. */
  it("backs a navy mark on a navy ground", () => {
    expect(
      logoBackingFor({ ink: flat("#0F172A"), ground: lum("#0F172A") }).backing,
    ).toBe("#ffffff");
  });

  it("backs a white mark on a white ground", () => {
    expect(
      logoBackingFor({ ink: flat("#FFFFFF"), ground: lum("#FAFAFA") }).backing,
    ).toBe("#000000");
  });

  /* A mark carrying both dark and light ink reads on far more grounds than
     its mean suggests. Judging the mean put a plate behind a two-tone mark
     that was sitting at 4:1 unaided, and the plate then matched one half of
     it at 1.04:1 — a rescue that destroyed the thing it rescued. */
  describe("a two-tone mark", () => {
    const twoTone = { darkest: lum("#101830"), lightest: lum("#FFFFFF") };

    it("is left alone on a mid-tone ground its light half reads on", () => {
      expect(
        logoBackingFor({ ink: twoTone, ground: lum("#787878") }).backing,
      ).toBeNull();
    });

    /* On a dark ground the mark's dark half disappears; on a light ground its
       light half does. Half a logo is not a logo, so both are rescued. */
    it.each(["#0F172A", "#FFFFFF"])("is rescued on %s", (ground) => {
      expect(
        logoBackingFor({ ink: twoTone, ground: lum(ground) }).backing,
      ).not.toBeNull();
    });

    /* Its mean would have demanded a plate on every one of those. */
    it("would have been backed if the mean decided", () => {
      const mean = (twoTone.darkest + twoTone.lightest) / 2;
      expect(
        logoBackingFor({
          ink: { darkest: mean, lightest: mean },
          ground: lum("#787878"),
        }).backing,
      ).not.toBeNull();
    });
  });

  /* An unmeasurable mark or ground must not get an unrequested plate. */
  it.each([
    ["the mark could not be read", { darkest: Number.NaN, lightest: 0.5 }, 0.5],
    ["the ground could not be read", flat("#0F172A"), Number.NaN],
  ])("does nothing when %s", (_label, ink, ground) => {
    const decision = logoBackingFor({ ink, ground });
    expect(decision.backing).toBeNull();
    // Unmeasured is not the same as illegible: it must not raise a fault.
    expect(decision.legible).toBe(true);
  });

  it("never returns a backing that fails the bar itself", () => {
    for (const tone of [0, 0.1, 0.25, 0.4, 0.5, 0.7, 1]) {
      const { backing } = logoBackingFor({
        ink: { darkest: tone, lightest: tone },
        ground: tone,
      });
      if (!backing) continue;
      const b = lum(backing);
      const ratio = (Math.max(tone, b) + 0.05) / (Math.min(tone, b) + 0.05);
      expect(ratio).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("groundLuminanceUnderLogo", () => {
  const solid = (color: [number, number, number, number]) =>
    logoPng({ width: 200, height: 200, shape: "block", color });

  it("reads the picture where the mark will land", async () => {
    expect(
      (
        await groundLuminanceUnderLogo({
          image: { bytes: solid([10, 10, 14, 255]), contentType: "image/png" },
          placement: "top-right",
          layout: "hero-center",
          aspect: 1,
        })
      ).darkest,
    ).toBeLessThan(0.05);
    expect(
      (
        await groundLuminanceUnderLogo({
          image: {
            bytes: solid([250, 250, 250, 255]),
            contentType: "image/png",
          },
          placement: "top-right",
          layout: "hero-center",
          aspect: 1,
        })
      ).lightest,
    ).toBeGreaterThan(0.9);
  });

  /* NaN means "leave it alone", and every caller must honour that rather than
     substitute a colour that is not in the picture. */
  it.each([
    ["there is no picture", null],
    [
      "the picture cannot be decoded",
      {
        bytes: new TextEncoder().encode("not an image"),
        contentType: "image/png",
      },
    ],
    [
      "the picture is a JPEG",
      {
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]),
        contentType: "image/jpeg",
      },
    ],
  ])("reports NaN when %s", async (_label, image) => {
    const ground = await groundLuminanceUnderLogo({
      image,
      placement: "top-right",
      layout: "hero-center",
      aspect: 1,
    });
    expect(Number.isNaN(ground.darkest)).toBe(true);
    expect(Number.isNaN(ground.lightest)).toBe(true);
  });

  it("reports NaN when no logo is being placed", async () => {
    const ground = await groundLuminanceUnderLogo({
      image: { bytes: solid([10, 10, 14, 255]), contentType: "image/png" },
      placement: "none",
      layout: "hero-center",
    });
    expect(Number.isNaN(ground.darkest)).toBe(true);
  });
});

/* The ground has to be read as a RANGE for the same reason the ink is. A
   corner that is half bright sky and half dark silhouette averages to a
   mid-tone appearing on neither half, so a black mark laid across it was
   judged legible and was invisible over half its area. */
describe("a ground that is not one tone", () => {
  const split = { darkest: 0, lightest: 1 };

  it.each([
    ["a black mark", { darkest: 0, lightest: 0 }],
    ["a white mark", { darkest: 1, lightest: 1 }],
  ])("rescues %s laid across it", (_label, ink) => {
    expect(logoBackingFor({ ink, ground: split })).not.toBeNull();
  });

  /* The mean of that ground is 0.5, which reads as ample contrast for both. */
  it("would have withheld the plate if the mean decided", () => {
    expect(
      logoBackingFor({ ink: { darkest: 0, lightest: 0 }, ground: 0.5 }).backing,
    ).toBeNull();
  });

  it("still leaves a mark alone on a uniform ground it reads on", () => {
    expect(
      logoBackingFor({
        ink: { darkest: 0.02, lightest: 0.02 },
        ground: { darkest: 1, lightest: 1 },
      }).backing,
    ).toBeNull();
  });
});

/* The fallback decode path: a picture the decoder refuses but resvg renders
   fine. Leaving it unmeasured means no contrast check on a whole delivery
   route — a native model may answer in JPEG, and a dark mark would be stamped
   invisible onto a dark composition with nothing to say so.

   Exercised with a 16-bit PNG rather than a JPEG because the decoder refuses
   both for the same reason and this one can be built in the test — no binary
   fixture in the repo. */
describe("a ground we cannot decode directly", () => {
  function png16(width: number, height: number, value: number): Uint8Array {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    const crc = (b: Buffer) => {
      let x = 0xffffffff;
      for (const byte of b) x = table[(x ^ byte) & 0xff] ^ (x >>> 8);
      return (x ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, "ascii");
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
      return Buffer.concat([head, data, tail]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 16; // bit depth our decoder refuses
    ihdr[9] = 2; // RGB
    const stride = width * 6;
    const raw = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = y * (stride + 1) + 1 + x * 6;
        for (let c = 0; c < 3; c += 1) {
          raw[at + c * 2] = value;
          raw[at + c * 2 + 1] = value;
        }
      }
    }
    return new Uint8Array(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
      ]),
    );
  }

  it("is refused by the direct decoder", () => {
    expect(decodePngRgba(png16(64, 80, 12))).toBeNull();
  });

  it.each([
    ["a dark picture", 12, 0.05, "below"],
    ["a light picture", 250, 0.9, "above"],
  ])(
    "re-renders %s rather than giving up",
    async (_label, value, bound, side) => {
      const ground = await groundLuminanceUnderLogo({
        image: { bytes: png16(64, 80, value), contentType: "image/png" },
        placement: "top-right",
        layout: "hero-center",
        aspect: 1,
      });

      expect(Number.isFinite(ground.darkest)).toBe(true);
      if (side === "below") expect(ground.lightest).toBeLessThan(bound);
      else expect(ground.darkest).toBeGreaterThan(bound);
    },
    60_000,
  );
});

describe("a plate has to actually rescue the mark", () => {
  /* Returning the best candidate regardless is decoration, not a rescue —
     it puts a slab behind a mark that is still unreadable on it. */
  it("returns nothing when no candidate clears the bar", () => {
    // Ink spanning the full range cannot be rescued on a ground already in the
    // only window that works, so no candidate improves on it.
    const { backing } = logoBackingFor({
      ink: { darkest: 0, lightest: 1 },
      ground: { darkest: 0, lightest: 1 },
    });
    if (backing) {
      const g = lum(backing);
      const r = (a: number, b: number) =>
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      expect(Math.min(r(0, g), r(1, g))).toBeGreaterThanOrEqual(3);
    }
  });

  it("never hands back a candidate weaker than the bar", () => {
    for (const darkest of [0, 0.2, 0.45, 0.5, 0.55, 0.8, 1]) {
      for (const lightest of [darkest, Math.min(1, darkest + 0.5)]) {
        const { backing } = logoBackingFor({
          ink: { darkest, lightest },
          ground: { darkest: 0.45, lightest: 0.55 },
        });
        if (!backing) continue;
        const g = lum(backing);
        const r = (a: number, b: number) =>
          (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        expect(Math.min(r(darkest, g), r(lightest, g))).toBeGreaterThanOrEqual(
          3,
        );
      }
    }
  });
});

/* Some marks cannot be made fully readable on any single colour — a near-black
   glyph beside a mid-orange one tops out below the bar whatever sits behind
   it. The best available plate is still applied, because it is a large
   improvement on nothing, and the shortfall is reported rather than swallowed:
   a design carrying half a legible logo is what this ticket is about. */
describe("a mark no plate can fully rescue", () => {
  const impossible = [
    ["near-black beside orange, on orange", "#0B1220", "#F97316", "#F97316"],
  ] as const;

  it.each(impossible)("%s", (_label, dark, light, ground) => {
    const decision = logoBackingFor({
      ink: { darkest: lum(dark), lightest: lum(light) },
      ground: lum(ground),
    });

    // Still improved — 1.0 unplated is far worse than what this achieves.
    expect(decision.backing).not.toBeNull();
    // But the user is told, because part of the mark still will not read.
    expect(decision.legible).toBe(false);
  });

  it("reports legible once the mark can actually be read", () => {
    expect(
      logoBackingFor({ ink: flat("#0F172A"), ground: lum("#0F172A") }).legible,
    ).toBe(true);
  });

  /* The derived optimum beats a hand-picked swatch list, which is why it is
     derived: ink spanning the full range is rescued by a specific mid-tone
     that no short list of blacks and whites contains. */
  it("finds a mid-tone that a black/white shortlist would miss", () => {
    const decision = logoBackingFor({
      ink: { darkest: 0, lightest: 1 },
      ground: 0.5,
    });
    expect(decision.legible).toBe(true);
    expect(decision.backing).not.toBe("#ffffff");
    expect(decision.backing).not.toBe("#000000");
  });
});

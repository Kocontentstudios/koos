// @vitest-environment node
import { describe, expect, it } from "vitest";
import { logoBoxIn } from "@/lib/design/logo-placement";
import { decodePngRgba } from "@/lib/images/png-pixels";
import { diffBounds, logoPng, SQUARE_MARK, WORDMARK } from "./logo-fixtures";
import { type LogoOverlayInput, overlayLogo } from "./logo-overlay";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const canvas = { width: 512, height: 512 };

/** Stands in for the model's finished design. */
const composed = () =>
  logoPng({ width: 512, height: 512, color: [20, 30, 60, 255] });

const stamp = (over: Partial<LogoOverlayInput> = {}) =>
  overlayLogo({
    image: { bytes: composed(), contentType: "image/png" },
    logo: {
      bytes: SQUARE_MARK(),
      contentType: "image/png",
      darkest: 0.185,
      lightest: 0.185,
      aspect: 1,
    },
    placement: "top-right",
    layout: "hero-center",
    canvas,
    ...over,
  }).then((r) => r.bytes);

describe("overlayLogo", () => {
  it("returns a real PNG at the canvas size", async () => {
    const bytes = await stamp();
    expect(Array.from(bytes.slice(0, 4))).toEqual(PNG_MAGIC);
    expect(bytes.byteLength).toBeGreaterThan(500);
  }, 60_000);

  /* The point of the overlay: the mark on the output is OUR file, in OUR
     corner, not whatever the model drew. Corner-sensitivity is what proves it
     was actually composited rather than passed through. */
  it("puts the mark where the placement says", async () => {
    const [left, right] = await Promise.all([
      stamp({ placement: "top-left" }),
      stamp({ placement: "top-right" }),
    ]);
    expect(Buffer.from(left).equals(Buffer.from(right))).toBe(false);
  }, 60_000);

  it("changes the design it was given", async () => {
    const stamped = await stamp();
    expect(Buffer.from(stamped).equals(Buffer.from(composed()))).toBe(false);
  }, 60_000);

  /* A design the user asked to keep logo-free must come back untouched — not
     re-encoded through satori for nothing. */
  it("returns the original bytes untouched when placement is none", async () => {
    const original = composed();
    const { bytes: out } = await overlayLogo({
      image: { bytes: original, contentType: "image/png" },
      logo: {
        bytes: SQUARE_MARK(),
        contentType: "image/png",
        darkest: 0.185,
        lightest: 0.185,
        aspect: 1,
      },
      placement: "none",
      layout: "hero-center",
      canvas,
    });
    expect(out).toBe(original);
  });

  /* The criterion is that the supplied file's proportions survive. Comparing
     bytes proves nothing — both marks stretched to fill the box would also
     differ — so the drawn box is measured against the file's own ratio. */
  it.each([
    { label: "square mark", mark: SQUARE_MARK, natural: 1 },
    { label: "wordmark", mark: WORDMARK, natural: 3 },
  ])(
    "keeps a $label at its own proportions",
    async ({ mark, natural }) => {
      const base = composed();
      const { bytes: stamped } = await overlayLogo({
        image: { bytes: base, contentType: "image/png" },
        logo: {
          bytes: mark(),
          contentType: "image/png",
          darkest: 0.185,
          lightest: 0.185,
          aspect: natural,
        },
        placement: "top-right",
        layout: "hero-center",
        canvas,
      });

      const after = decodePngRgba(stamped);
      const before = decodePngRgba(
        (
          await overlayLogo({
            image: { bytes: base, contentType: "image/png" },
            logo: {
              bytes: mark(),
              contentType: "image/png",
              darkest: 0.185,
              lightest: 0.185,
              aspect: natural,
            },
            placement: "none",
            layout: "hero-center",
            canvas,
          })
        ).bytes,
      );
      expect(after).not.toBeNull();
      expect(before).not.toBeNull();
      if (!after || !before) return;

      // The two differ only by the stamp, so the diff is the mark itself.
      const box = diffBounds(after, before);
      expect(box).not.toBeNull();
      if (!box) return;

      expect(box.ratio).toBeCloseTo(natural, 1);
      // Top-right, inside the 8% safe area.
      expect(box.left).toBeGreaterThan(canvas.width / 2);
      expect(box.top).toBeLessThan(canvas.height / 2);
      expect(canvas.width - 1 - box.right).toBeCloseTo(canvas.width * 0.08, -1);
    },
    120_000,
  );
});

/* The native route's whole contrast mechanism. Deleting the ground reading
   used to leave the suite green: nothing asserted that the overlay looks at
   the picture it is stamping. */
describe("overlayLogo reads the design it is stamping", () => {
  const solid = (value: number) =>
    logoPng({
      width: 256,
      height: 320,
      shape: "block",
      color: [value, value, value, 255],
    });

  const stampOn = (design: Uint8Array, darkest: number, lightest = darkest) =>
    overlayLogo({
      image: { bytes: design, contentType: "image/png" },
      logo: {
        bytes: SQUARE_MARK(),
        contentType: "image/png",
        darkest,
        lightest,
        aspect: 1,
      },
      placement: "top-right",
      layout: "hero-center",
      canvas: { width: 256, height: 320 },
    }).then((r) => r.bytes);

  /* Same mark, same placement, two grounds. Only the picture differs, so any
     difference in output is the contrast decision reading it. */
  it("backs a dark mark on a dark design but not on a light one", async () => {
    const [onDark, onLight] = await Promise.all([
      stampOn(solid(8), 0.01),
      stampOn(solid(250), 0.01),
    ]);

    expect(Buffer.from(onDark).equals(Buffer.from(onLight))).toBe(false);

    const dark = decodePngRgba(onDark);
    const light = decodePngRgba(onLight);
    expect(dark).not.toBeNull();
    expect(light).not.toBeNull();
    if (!dark || !light) return;

    const box = logoBoxIn({
      placement: "top-right",
      layout: "hero-center",
      width: 256,
      height: 320,
      aspect: 1,
    });
    if (!box) throw new Error("no box");

    /* On the dark design the mark needs a light plate, so its box carries
       bright pixels the light design's does not need. */
    const brightShare = (image: NonNullable<typeof dark>) => {
      let bright = 0;
      let total = 0;
      for (
        let y = Math.round(box.top);
        y < Math.round(box.top + box.height);
        y += 1
      ) {
        for (
          let x = Math.round(box.left);
          x < Math.round(box.left + box.width);
          x += 1
        ) {
          total += 1;
          if (image.pixels[(y * image.width + x) * 4] > 160) bright += 1;
        }
      }
      return bright / total;
    };

    expect(brightShare(dark)).toBeGreaterThan(0.05);
  }, 120_000);

  /* A two-tone mark carries its own contrast and must not be plated. */
  it("leaves a two-tone mark alone on a mid-tone design", async () => {
    const [twoTone, flat] = await Promise.all([
      stampOn(solid(128), 0.01, 0.95),
      stampOn(solid(128), 0.2, 0.2),
    ]);
    expect(Buffer.from(twoTone).equals(Buffer.from(flat))).toBe(false);
  }, 120_000);
});

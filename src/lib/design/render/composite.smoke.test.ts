// @vitest-environment node
import { describe, expect, it } from "vitest";
import { logoBoxIn } from "@/lib/design/logo-placement";
import type { DesignSpec } from "@/lib/design/spec";
import { decodePngRgba, encodePngRgba } from "@/lib/images/png-pixels";
import { renderCompositeDesign } from "./composite";
import {
  diffBounds,
  inkBounds,
  logoPng,
  SQUARE_MARK,
  TRANSPARENT_MARK,
  WORDMARK,
} from "./logo-fixtures";

const SPEC: DesignSpec = {
  layout: "hero-center",
  headline: "Lagos Launch Week",
  subheadline: "Free delivery for the first three days",
  cta: "Order now",
  palette: {
    background: "#0F172A",
    foreground: "#FFFFFF",
    accent: "#F97316",
  },
  logoPlacement: "bottom-right",
  logoFree: false,
  logoFreeQuote: "",
  backgroundPrompt: "warm city skyline at dusk",
  backgroundTreatment: "photographic",
  nativePrompt: "unused in the composite route",
  aspectRatio: "4:5",
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

const LAYOUTS: DesignSpec["layout"][] = [
  "hero-center",
  "split-left",
  "banner-bottom",
  "quote-card",
  "stat-highlight",
];

describe("renderCompositeDesign", () => {
  it("renders a real PNG at the canvas size without a plate or logo", async () => {
    const result = await renderCompositeDesign({
      spec: SPEC,
      brand: { primaryColor: "#0F172A", secondaryColor: "#F97316" },
      plate: null,
      logo: null,
    });

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1350);
    expect(Array.from(result.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
    // A blank canvas compresses to almost nothing; real typography does not.
    expect(result.bytes.byteLength).toBeGreaterThan(5000);
  }, 60_000);

  it("renders every layout without throwing", async () => {
    for (const layout of LAYOUTS) {
      const result = await renderCompositeDesign({
        spec: { ...SPEC, layout },
        brand: {},
        plate: null,
        logo: null,
      });
      expect(Array.from(result.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
    }
  }, 120_000);

  /* The only ratio rendered here was 4:5 — the one this change did NOT touch.
     Landscape moved from 1200x675 to 1344x756, and nothing else in the suite
     rasterizes at that size, so a regression there would be invisible. */
  it("renders landscape at its changed canvas size", async () => {
    const result = await renderCompositeDesign({
      spec: { ...SPEC, aspectRatio: "16:9" },
      brand: { primaryColor: "#0F172A", secondaryColor: "#F97316" },
      plate: null,
      logo: null,
    });

    expect(result.width).toBe(1344);
    expect(result.height).toBe(756);
    expect(Array.from(result.bytes.subarray(0, 4))).toEqual(PNG_MAGIC);
  }, 30_000);
});

/* Every case above passes `logo: null`, so "the logo is drawn" was never
   pinned by anything — the renderer could silently drop it and the suite
   stayed green (KOOS-BUG-022). */
describe("renderCompositeDesign draws the logo", () => {
  const brand = { primaryColor: "#0F172A", secondaryColor: "#F97316" };
  /* SPEC's palette background, which resolvePalette passes through. */
  const GROUND: [number, number, number] = [0x0f, 0x17, 0x2a];
  /* The aspect the loader would have measured. Passing 1 for a wide mark
     centres it in a square box and every inset assertion moves. */
  const render = (
    over: Partial<DesignSpec>,
    logo: Uint8Array | null,
    aspect = 1,
  ) =>
    renderCompositeDesign({
      spec: { ...SPEC, ...over },
      brand,
      plate: null,
      logo: logo
        ? {
            bytes: logo,
            contentType: "image/png",
            darkest: 0.185,
            lightest: 0.185,
            aspect,
          }
        : null,
    });

  /* Placement-sensitivity is the assertion that a stub cannot fake: if the
     mark were dropped, the two corners would produce identical bytes. */
  it("puts the mark where the placement says", async () => {
    const [left, right, absent] = await Promise.all([
      render({ logoPlacement: "top-left" }, SQUARE_MARK()),
      render({ logoPlacement: "top-right" }, SQUARE_MARK()),
      render({ logoPlacement: "none" }, SQUARE_MARK()),
    ]);

    expect(Buffer.from(left.bytes).equals(Buffer.from(right.bytes))).toBe(
      false,
    );
    expect(Buffer.from(left.bytes).equals(Buffer.from(absent.bytes))).toBe(
      false,
    );
  }, 120_000);

  /* The criteria are geometric: original aspect ratio preserved, no
     stretching, safe-area padding maintained. "The bytes differ" holds with
     the mark squashed flat, so the box is measured instead. */
  it("places both mark shapes at their own proportions", async () => {
    const cases = [
      { mark: SQUARE_MARK(), natural: 1, label: "square" },
      { mark: WORDMARK(), natural: 3, label: "wordmark" },
    ];

    for (const { mark, natural, label } of cases) {
      const result = await render(
        { logoPlacement: "top-right" },
        mark,
        natural,
      );
      const decoded = decodePngRgba(result.bytes);
      expect(decoded, label).not.toBeNull();
      if (!decoded) continue;

      // Top strip only, so the headline is not in the measured region.
      const box = inkBounds(decoded, GROUND, {
        left: 0,
        top: 0,
        right: decoded.width,
        bottom: Math.round(decoded.height * 0.2),
      });
      expect(box, label).not.toBeNull();
      if (!box) continue;

      expect(box.ratio, `${label} aspect`).toBeCloseTo(natural, 1);
      // Inset matches the 8% the copy uses, measured from the right edge.
      expect(decoded.width - 1 - box.right, `${label} inset`).toBeCloseTo(
        decoded.width * 0.08,
        -1,
      );
      expect(box.top, `${label} top inset`).toBeCloseTo(
        decoded.width * 0.08,
        -1,
      );
    }
  }, 180_000);

  /* Transparency is the criterion; a flattened alpha still changes the bytes,
     so the margin is read back against the exact background colour. */
  it("keeps a transparent logo transparent over the background", async () => {
    const result = await render(
      { logoPlacement: "top-right" },
      TRANSPARENT_MARK(),
    );
    const decoded = decodePngRgba(result.bytes);
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    const box = inkBounds(decoded, GROUND, {
      left: 0,
      top: 0,
      right: decoded.width,
      bottom: Math.round(decoded.height * 0.2),
    });
    expect(box).not.toBeNull();
    if (!box) return;

    /* TRANSPARENT_MARK is a block with a transparent border, so its drawn box
       is the inner block: a flattened alpha would draw the border too and the
       box would be 2x wider. */
    const drawnShare = box.pixels / (box.width * box.height);
    expect(drawnShare).toBeGreaterThan(0.9);
    expect(box.ratio).toBeCloseTo(1, 1);
  }, 120_000);

  /* The two card layouts drew the mark straight onto the centred copy: the
     panel starts 8% in and the logo was inset 5%, so it straddled the edge. */
  it("keeps the mark clear of the copy on every layout", async () => {
    for (const layout of LAYOUTS) {
      const [withLogo, withoutLogo] = await Promise.all([
        render({ layout, logoPlacement: "bottom-right" }, SQUARE_MARK()),
        render({ layout, logoPlacement: "none" }, SQUARE_MARK()),
      ]);
      const a = decodePngRgba(withLogo.bytes);
      const b = decodePngRgba(withoutLogo.bytes);
      expect(a, layout).not.toBeNull();
      expect(b, layout).not.toBeNull();
      if (!a || !b) continue;

      // The two renders differ only by the logo, so the diff IS the mark.
      const mark = diffBounds(a, b);
      expect(mark, `${layout} mark drawn`).not.toBeNull();
      if (!mark) continue;

      // It landed in the corner it was placed in.
      expect(mark.left, `${layout} horizontal half`).toBeGreaterThan(
        a.width / 2,
      );
      expect(mark.top, `${layout} vertical half`).toBeGreaterThan(a.height / 2);

      /* Nothing the layout draws is underneath it. Measured on the logo-free
         render inside the mark's own box, so a border or scrim elsewhere in
         the corner is not mistaken for copy. */
      const underneath = inkBounds(b, GROUND, mark);
      expect(underneath?.pixels ?? 0, `${layout} ink under the mark`).toBe(0);
    }
  }, 240_000);

  it("renders every layout with a logo without throwing", async () => {
    for (const layout of LAYOUTS) {
      const result = await render(
        { layout, logoPlacement: "bottom-right" },
        WORDMARK(),
        3,
      );
      expect(Array.from(result.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
    }
  }, 180_000);
});

/* The rescue for a mark the ground would swallow. Deleting it entirely used to
   leave the whole suite green, because nothing rendered a low-contrast logo
   and looked at what came back.

   Each case renders the SAME mark twice and changes only the luminance it
   reports, so the only thing that can move the pixels is the contrast
   decision itself. */
describe("renderCompositeDesign rescues a mark the ground would swallow", () => {
  const brand = { primaryColor: "#0F172A", secondaryColor: "#F97316" };
  const darkMark = () =>
    logoPng({
      width: 128,
      height: 128,
      shape: "block",
      color: [8, 8, 10, 255],
    });

  const renderWith = (
    luminance: number,
    plate: { bytes: Uint8Array; contentType: string } | null = null,
  ) =>
    renderCompositeDesign({
      spec: { ...SPEC, layout: "hero-center", logoPlacement: "bottom-right" },
      brand,
      plate,
      logo: {
        bytes: darkMark(),
        contentType: "image/png",
        darkest: luminance,
        lightest: luminance,
        aspect: 1,
      },
    });

  /* Counting how BRIGHT the slot is was the wrong measure and it hid a real
     bug: a plate with no mark on it is brighter than a plate with one, so the
     assertion was satisfied more strongly by the failure. Count the mark's own
     ink instead — the thing that actually has to be on the page. */
  const markPixels = (bytes: Uint8Array, colour: [number, number, number]) => {
    const decoded = decodePngRgba(bytes);
    if (!decoded) return 0;
    let found = 0;
    for (let i = 0; i < decoded.width * decoded.height; i += 1) {
      const at = i * 4;
      if (
        Math.abs(decoded.pixels[at] - colour[0]) < 12 &&
        Math.abs(decoded.pixels[at + 1] - colour[1]) < 12 &&
        Math.abs(decoded.pixels[at + 2] - colour[2]) < 12
      ) {
        found += 1;
      }
    }
    return found;
  };

  /** Share of the logo slot that is bright — the signature of a light plate. */
  const brightShare = (bytes: Uint8Array) => {
    const decoded = decodePngRgba(bytes);
    if (!decoded) return Number.NaN;
    const box = logoBoxIn({
      placement: "bottom-right",
      layout: "hero-center",
      width: decoded.width,
      height: decoded.height,
    });
    if (!box) return Number.NaN;
    let bright = 0;
    let total = 0;
    for (let y = box.top; y < box.top + box.height; y += 1) {
      for (let x = box.left; x < box.left + box.width; x += 1) {
        const at = (y * decoded.width + x) * 4;
        total += 1;
        if (decoded.pixels[at] > 160) bright += 1;
      }
    }
    return bright / total;
  };

  /* SPEC's background is #0F172A — near-black. A near-black mark on it is
     drawn perfectly and is invisible. */
  it("backs a dark mark on a dark ground", async () => {
    const [rescued, untouched] = await Promise.all([
      renderWith(0.012).then((r) => r.bytes),
      renderWith(0.95).then((r) => r.bytes),
    ]);

    /* The plate sits behind the mark, so what shows is the padding ring
       around it — small in absolute terms, and enormous next to the nothing
       an unrescued dark mark on a dark ground produces. */
    expect(brightShare(untouched)).toBeLessThan(0.02);
    expect(brightShare(rescued)).toBeGreaterThan(brightShare(untouched) + 0.1);
  }, 180_000);

  /* The measurement has to come from the finished picture. Reading the raw
     plate missed the Scrim drawn over it and reported 5.04 where the render
     was 1.53 — success declared over an invisible mark. */
  it("measures the scrim, not the plate it sits on", async () => {
    const brightPlate = {
      bytes: logoPng({
        width: 400,
        height: 500,
        shape: "block",
        color: [140, 140, 140, 255],
      }),
      contentType: "image/png",
    };
    const [rescued, untouched] = await Promise.all([
      renderWith(0.012, brightPlate).then((r) => r.bytes),
      renderWith(0.95, brightPlate).then((r) => r.bytes),
    ]);

    // A mid-grey plate looks like enough contrast for a dark mark until the
    // scrim darkens it. The finished render must still get a backing.
    expect(brightShare(rescued)).toBeGreaterThan(brightShare(untouched) + 0.15);
    expect(markPixels(rescued, [8, 8, 10])).toBeGreaterThan(1000);
  }, 180_000);

  it("does nothing when the mark's luminance could not be measured", async () => {
    const [unmeasured, untouched] = await Promise.all([
      renderWith(Number.NaN).then((r) => r.bytes),
      renderWith(0.95).then((r) => r.bytes),
    ]);
    expect(Buffer.from(unmeasured).equals(Buffer.from(untouched))).toBe(true);
  }, 180_000);
});

/* The blocker that survived a first fix: the contrast check read the SLOT
   while the renderer drew the fitted MARK, so up to 45% of the measured pixels
   were ground the mark never covers. A uniform ground cannot tell the two
   apart — this plate is dark exactly where the mark lands and bright across
   the rest of the slot, so a slot-wide average says "plenty of contrast" while
   the mark is invisible. */
describe("renderCompositeDesign measures the mark, not the slot around it", () => {
  const brand = { primaryColor: "#0F172A", secondaryColor: "#F97316" };

  /* A 4:5 plate maps 1:1 onto the 1080x1350 canvas under object-fit: cover at
     exactly 2x, so a rectangle here lands at twice these coordinates. */
  const PLATE = { width: 540, height: 675 };

  function platePaintedUnderTheMark(): Uint8Array {
    const { width, height } = PLATE;
    const pixels = new Uint8Array(width * height * 4);
    const box = logoBoxIn({
      placement: "top-right",
      layout: "hero-center",
      width: 1080,
      height: 1350,
      aspect: 1,
    });
    if (!box) throw new Error("no box");

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        // Dark only where the MARK goes, in the plate's own half-scale coords.
        const underMark =
          x >= box.left / 2 &&
          x < (box.left + box.width) / 2 &&
          y >= box.top / 2 &&
          y < (box.top + box.height) / 2;
        const value = underMark ? 4 : 250;
        pixels[at] = value;
        pixels[at + 1] = value;
        pixels[at + 2] = value;
        pixels[at + 3] = 255;
      }
    }
    return encodePngRgba({ width, height, pixels });
  }

  it("backs a dark mark on a dark patch inside a bright slot", async () => {
    const plate = {
      bytes: platePaintedUnderTheMark(),
      contentType: "image/png",
    };
    const darkMark = logoPng({
      width: 128,
      height: 128,
      shape: "block",
      color: [6, 6, 8, 255],
    });

    const render = (luminance: number) =>
      renderCompositeDesign({
        spec: { ...SPEC, layout: "hero-center", logoPlacement: "top-right" },
        brand,
        plate,
        logo: {
          bytes: darkMark,
          contentType: "image/png",
          darkest: luminance,
          lightest: luminance,
          aspect: 1,
        },
      }).then((r) => r.bytes);

    const rescued = await render(0.008);
    const decoded = decodePngRgba(rescued);
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    const box = logoBoxIn({
      placement: "top-right",
      layout: "hero-center",
      width: decoded.width,
      height: decoded.height,
      aspect: 1,
    });
    if (!box) throw new Error("no box");

    /* Direction matters, not just difference. Averaging the slot makes this
       corner look bright enough and withholds the plate, so the dark mark on
       the dark patch stays invisible — and a bare "these two renders differ"
       assertion passes either way, because the slot reading simply moves the
       backing onto the other case. */
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
        if (decoded.pixels[(y * decoded.width + x) * 4] > 160) bright += 1;
      }
    }
    expect(bright / total).toBeGreaterThan(0.05);
  }, 180_000);
});

/* The second render, which is the most expensive thing in this file. Replacing
   it with the flat palette colour used to pass everything, because every other
   case here uses a dark palette AND a dark plate — where the two methods agree
   and the test proves nothing. This one sets them against each other. */
describe("renderCompositeDesign judges the plate, not the palette", () => {
  const LIGHT_PALETTE = {
    background: "#FFFFFF",
    foreground: "#111111",
    accent: "#F97316",
  };

  it("backs a dark mark on a dark plate under a light palette", async () => {
    const darkPlate = {
      bytes: logoPng({
        width: 540,
        height: 675,
        shape: "block",
        color: [6, 6, 8, 255],
      }),
      contentType: "image/png",
    };
    const darkMark = logoPng({
      width: 128,
      height: 128,
      shape: "block",
      color: [8, 8, 10, 255],
    });

    const result = await renderCompositeDesign({
      spec: {
        ...SPEC,
        palette: LIGHT_PALETTE,
        layout: "hero-center",
        logoPlacement: "top-right",
      },
      brand: { primaryColor: "#FFFFFF", secondaryColor: "#111111" },
      plate: darkPlate,
      logo: {
        bytes: darkMark,
        contentType: "image/png",
        darkest: 0.008,
        lightest: 0.008,
        aspect: 1,
      },
    });

    const decoded = decodePngRgba(result.bytes);
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    const box = logoBoxIn({
      placement: "top-right",
      layout: "hero-center",
      width: decoded.width,
      height: decoded.height,
      aspect: 1,
    });
    if (!box) throw new Error("no box");

    /* The palette says white — plenty of contrast for a dark mark, so a
       palette-based check withholds the plate. The plate is near-black, so the
       mark needs one. Bright pixels in the box can only be that plate. */
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
        if (decoded.pixels[(y * decoded.width + x) * 4] > 160) bright += 1;
      }
    }
    expect(bright / total).toBeGreaterThan(0.05);
  }, 180_000);
});

/* The geometry was only ever tested with a square mark, which is how a wide
   one came to render as a solid coloured rectangle with no logo in it.
   Satori sizes with border-box, so padding on the mark was subtracted from it:
   past about 5:1 the content box collapsed entirely. */
describe("renderCompositeDesign draws a wide mark that needs a plate", () => {
  const INK: [number, number, number] = [8, 8, 10];

  const wideMark = (aspect: number) => {
    const width = aspect >= 1 ? 240 : Math.round(240 * aspect);
    const height = aspect >= 1 ? Math.round(240 / aspect) : 240;
    return logoPng({ width, height, shape: "block", color: [...INK, 255] });
  };

  const render = (aspect: number, aspectRatio: DesignSpec["aspectRatio"]) =>
    renderCompositeDesign({
      spec: {
        ...SPEC,
        aspectRatio,
        layout: "hero-center",
        logoPlacement: "top-right",
      },
      brand: {},
      plate: null,
      logo: {
        bytes: wideMark(aspect),
        contentType: "image/png",
        // Dark ink on SPEC's dark ground, so a plate is always applied.
        darkest: 0.008,
        lightest: 0.008,
        aspect,
      },
    }).then((r) => r.bytes);

  const countInk = (bytes: Uint8Array) => {
    const decoded = decodePngRgba(bytes);
    if (!decoded) return 0;
    let found = 0;
    for (let i = 0; i < decoded.width * decoded.height; i += 1) {
      const at = i * 4;
      if (
        Math.abs(decoded.pixels[at] - INK[0]) < 12 &&
        Math.abs(decoded.pixels[at + 1] - INK[1]) < 12 &&
        Math.abs(decoded.pixels[at + 2] - INK[2]) < 12
      ) {
        found += 1;
      }
    }
    return found;
  };

  it.each([
    ["16:9", 1],
    ["16:9", 3],
    ["16:9", 6],
    ["16:9", 10],
    ["16:9", 0.4],
    ["4:5", 6],
    ["4:5", 10],
  ] as const)(
    "puts real ink on a %s design for a %s:1 mark",
    async (aspectRatio, aspect) => {
      const ink = countInk(await render(aspect, aspectRatio));
      expect(ink).toBeGreaterThan(500);
    },
    180_000,
  );
});

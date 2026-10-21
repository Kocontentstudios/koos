// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import {
  LOGO_NOT_LEGIBLE,
  logoBackingFor,
  type MarkInk,
} from "@/lib/design/logo-contrast";
import { type ResolvedPalette, resolvePalette } from "@/lib/design/palette";
import { renderCompositeDesign } from "@/lib/design/render/composite";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { logoPng } from "@/lib/design/render/logo-fixtures";
import { rasterize } from "@/lib/design/render/rasterize";
import type { DesignSpec } from "@/lib/design/spec";
import { decodePngRgba, regionInk } from "@/lib/images/png-pixels";
import { LAYOUTS, LOGO, LOGO_ASPECT, specFor } from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { prepareDocumentFonts, rasterizeDocument } from "./rasterize";
import { documentElement } from "./render";
import type { DesignDocument } from "./schema";

/**
 * Acceptance 5: the two-pass logo backing measurement still runs on the
 * document path, and LOGO_NOT_LEGIBLE fires in the same cases as on the
 * flex composite.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

let measurer: RendererMeasurer;
beforeAll(async () => {
  measurer = createRendererMeasurer({ fonts: await loadBrandFonts(null) });
});

const NAVY = {
  background: "#0F172A",
  foreground: "#F8FAFC",
  accent: "#F97316",
};
const CREAM = {
  background: "#FFF4E6",
  foreground: "#3B2416",
  accent: "#C2410C",
};
const WHITE = {
  background: "#FFFFFF",
  foreground: "#111111",
  accent: "#2563EB",
};

/* A dark navy mark, a white mark, and one no single colour can rescue: its
   near-black and mid-tone halves cannot both clear 3:1 on any ground. */
const MARKS: Record<string, { ink: MarkInk; rgb: [number, number, number] }> = {
  navy: { ink: { darkest: 0.008, lightest: 0.008 }, rgb: [15, 23, 42] },
  white: { ink: { darkest: 1, lightest: 1 }, rgb: [255, 255, 255] },
  unrescuable: { ink: { darkest: 0, lightest: 0.35 }, rgb: [230, 120, 20] },
};

function logoBytes(rgb: [number, number, number]) {
  return logoPng({
    width: 200,
    height: 50,
    color: [...rgb, 255],
    shape: "block",
  });
}

async function both(
  layout: DesignSpec["layout"],
  colors: typeof NAVY,
  mark: (typeof MARKS)[string],
) {
  const spec: DesignSpec = {
    ...specFor(layout, "4:5"),
    palette: colors,
    footerStyle: "none",
    footerLines: [],
  };
  const palette: ResolvedPalette = resolvePalette(spec.palette, {});
  const bytes = logoBytes(mark.rgb);
  const doc = await documentFromSpec({
    spec,
    palette,
    canvas: canvasFor("4:5"),
    image: null,
    logo: { asset: LOGO, aspect: LOGO_ASPECT },
    measurer,
  });
  const fromDocument = await rasterizeDocument({
    doc,
    assets: { [LOGO.key]: { bytes, contentType: "image/png" } },
    brand: {},
    logoInk: { [LOGO.key]: mark.ink },
  });
  const fromFlex = await renderCompositeDesign({
    spec,
    brand: {},
    plate: null,
    logo: {
      bytes,
      contentType: "image/png",
      ...mark.ink,
      aspect: LOGO_ASPECT,
    },
  });
  return { doc, fromDocument, fromFlex };
}

function logoOf(doc: DesignDocument) {
  const logo = doc.elements.find((e) => e.type === "logo");
  if (logo?.type !== "logo") throw new Error("no logo element");
  return logo;
}

describe("rasterizeDocument", () => {
  it("renders a PNG at the document's size", async () => {
    const { fromDocument } = await both("hero-center", CREAM, MARKS.navy);
    expect(Array.from(fromDocument.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
    expect(fromDocument.width).toBe(1080);
    expect(fromDocument.height).toBe(1350);
    expect(fromDocument.brandFontFault).toBeNull();
  });

  it.each(LAYOUTS)(
    "reports an unrescuable mark exactly as the composite does (%s)",
    async (layout) => {
      const { fromDocument, fromFlex } = await both(
        layout,
        CREAM,
        MARKS.unrescuable,
      );
      expect(fromFlex.logoFault).toBe(LOGO_NOT_LEGIBLE);
      expect(fromDocument.logoFault).toBe(LOGO_NOT_LEGIBLE);
    },
    60_000,
  );

  it.each([
    ["a navy mark on navy", NAVY, MARKS.navy],
    ["a white mark on white", WHITE, MARKS.white],
    ["a navy mark on cream", CREAM, MARKS.navy],
    ["a white mark on navy", NAVY, MARKS.white],
  ] as const)(
    "agrees with the composite on %s",
    async (_name, colors, mark) => {
      const { fromDocument, fromFlex } = await both(
        "hero-center",
        colors,
        mark,
      );
      expect(fromDocument.logoFault).toBe(fromFlex.logoFault);
      expect(fromDocument.logoFault).toBeNull();
    },
    60_000,
  );

  it("backs a mark that would vanish into its ground, and writes the backing back", async () => {
    const { fromDocument, doc } = await both("hero-center", NAVY, MARKS.navy);
    expect(logoOf(doc).backing).toBeNull();
    const backing = logoOf(fromDocument.document).backing;
    expect(backing).not.toBeNull();
    // A navy mark needs a light plate.
    expect(Number.parseInt(backing?.slice(1, 3) ?? "00", 16)).toBeGreaterThan(
      128,
    );
  });

  it("leaves a mark that already reads alone", async () => {
    const { fromDocument } = await both("hero-center", CREAM, MARKS.navy);
    expect(logoOf(fromDocument.document).backing).toBeNull();
  });

  it("decides from the finished picture under the mark, not from the palette", async () => {
    /* split-left puts its top-right mark on the accent panel, not on the
       background colour the palette names. The decision must match a reading
       of the rendered ground at the mark's box. */
    const { fromDocument, doc } = await both("split-left", CREAM, MARKS.navy);
    const logo = logoOf(doc);
    const ground = decodePngRgba(
      await rasterize(
        documentElement(
          {
            ...doc,
            elements: doc.elements.filter((e) => e.type !== "logo"),
          },
          {},
        ),
        { width: doc.width, height: doc.height },
        await loadBrandFonts(null),
      ),
    );
    if (!ground) throw new Error("ground did not decode");
    const expected = logoBackingFor({
      ink: MARKS.navy.ink,
      ground: regionInk(ground, {
        left: logo.x,
        top: logo.y,
        width: logo.width,
        height: logo.height,
      }),
    });
    expect(logoOf(fromDocument.document).backing).toBe(expected.backing);
    /* The accent panel is orange, the mark navy: that pairing is readable, so
       a palette-based guess and the measurement must not be confused. */
    expect(fromDocument.logoFault).toBeNull();
  });

  it("gives a mark with no ink reading no backing and no complaint", async () => {
    const { doc } = await both("hero-center", NAVY, MARKS.navy);
    const result = await rasterizeDocument({
      doc,
      assets: {
        [LOGO.key]: {
          bytes: logoBytes(MARKS.navy.rgb),
          contentType: "image/png",
        },
      },
      brand: {},
    });
    expect(logoOf(result.document).backing).toBeNull();
    expect(result.logoFault).toBeNull();
  });

  it("falls back to the bundled faces and says why when the brand font is unusable", async () => {
    const { doc } = await both("hero-center", CREAM, MARKS.navy);
    const result = await rasterizeDocument({
      doc,
      assets: {},
      brand: { brandFontUrl: "https://elsewhere.example/fonts/brand.ttf" },
    });
    expect(Array.from(result.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
    expect(result.brandFontFault).not.toBeNull();
  });
});

describe("prepareDocumentFonts", () => {
  it("settles on the bundled faces with no fault when the brand has none", async () => {
    const { fonts, fault } = await prepareDocumentFonts({}, "Fresh croissants");
    expect(fault).toBeNull();
    expect(fonts.map((f) => f.name)).toEqual(
      expect.arrayContaining(["Display", "Body"]),
    );
  });
});

import { describe, expect, it } from "vitest";
import { SUPPORTED_ASPECT_RATIOS } from "@/lib/ai/image/types";
import { canvasFor } from "@/lib/design/canvas";
import {
  type DesignDocument,
  designDocumentSchema,
  isDocumentColor,
  isDocumentGradient,
  MAX_CANVAS_EDGE,
} from "./schema";

const DOC: DesignDocument = {
  version: 1,
  width: 1080,
  height: 1350,
  background: "#FFF4E6",
  elements: [
    {
      id: "image",
      name: "Image",
      type: "image",
      x: 0,
      y: 0,
      width: 1080,
      height: 1350,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
      asset: { key: "design-images/b1/photo.png" },
      fit: "cover",
      crop: { zoom: 1, focusX: 0.5, focusY: 0.5 },
      radius: 0,
    },
    {
      id: "scrim",
      name: "Scrim",
      type: "shape",
      x: 0,
      y: 0,
      width: 1080,
      height: 1350,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
      fill: "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.56) 40.5%, #000000 100%)",
      borderColor: "transparent",
      borderWidth: 0,
      radius: 0,
    },
    {
      id: "headline",
      name: "Headline",
      type: "text",
      x: 86,
      y: 400,
      width: 908,
      height: 300,
      rotation: -4,
      opacity: 1,
      hidden: false,
      locked: false,
      text: "Fresh croissants",
      role: "headline",
      font: "heading",
      fontSize: 110,
      fontWeight: 700,
      lineHeight: 1.05,
      letterSpacing: -0.01,
      align: "center",
      italic: false,
      color: "#FFFFFF",
    },
    {
      id: "cta",
      name: "Call to action",
      type: "button",
      x: 340,
      y: 900,
      width: 400,
      height: 90,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
      label: "Order now",
      fill: "#C2410C",
      color: "#FFFFFF",
      radius: 45,
      fontSize: 35,
      fontWeight: 600,
    },
    {
      id: "logo",
      name: "Logo",
      type: "logo",
      x: 760,
      y: 86,
      width: 234,
      height: 50,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
      asset: { key: "logos/b1/mark.png" },
      backing: null,
    },
  ],
};

function withElement(index: number, patch: Record<string, unknown>) {
  return {
    ...DOC,
    elements: DOC.elements.map((element, i) =>
      i === index ? { ...element, ...patch } : element,
    ),
  };
}

describe("designDocumentSchema", () => {
  it("accepts a well-formed document of every element type", () => {
    expect(designDocumentSchema.safeParse(DOC).success).toBe(true);
  });

  it("accepts a plate stored under generated/", () => {
    const doc = withElement(0, { asset: { key: "generated/b1/plates/p.png" } });
    expect(designDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects an unknown element type", () => {
    const doc = withElement(1, { type: "video" });
    expect(designDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects a field that is not in the contract", () => {
    const doc = withElement(2, { html: "<b>hi</b>" });
    expect(designDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it.each([
    ["deliverables/b2/final.png"],
    ["fonts/b1/brand.ttf"],
    ["reference-images/b1/x.png"],
    ["logos-private/b1/x.png"],
    ["logos/../deliverables/b2/final.png"],
    ["/logos/b1/x.png"],
    ["logos/b1/a b.png"],
    ["logos/b1/a\nb.png"],
    [""],
  ])("rejects asset key %j", (key) => {
    expect(
      designDocumentSchema.safeParse(withElement(0, { asset: { key } }))
        .success,
    ).toBe(false);
    expect(
      designDocumentSchema.safeParse(withElement(4, { asset: { key } }))
        .success,
    ).toBe(false);
  });

  it.each([
    ["https://cdn.example.com/logos/b1/x.png"],
    ["http://evil.test/logos/b1/x.png"],
    ["data:image/png;base64,AAAA"],
    ["//evil.test/logos/x.png"],
  ])("rejects a URL in an asset field: %s", (key) => {
    expect(
      designDocumentSchema.safeParse(withElement(0, { asset: { key } }))
        .success,
    ).toBe(false);
  });

  /* B2 (round 1): every one of these passed a "no whitespace, no `..`" check
     and then meant something else to whatever turned the key into a URL.
     `logos/%2e%2e/deliverables/u1/x.zip` resolves to /deliverables/u1/x.zip
     through `new URL(publicUrl(key))`. */
  it.each([
    ["logos/%2e%2e/deliverables/u1/x.zip"],
    ["logos/%2E%2E%2Fdeliverables/x.png"],
    ["logos/"],
    ["logos//evil.example/x.png"],
    ["logos/https://evil.example/x.png"],
    ["logos/a?x=1#y"],
    ["logos/b1/x.png#frag"],
    ["logos/a‮b.png"],
    ["logos/b1/​x.png"],
    ["logos/./x.png"],
    ["logos/b1/./x.png"],
    ["logos/.../x.png"],
    ["logos\\..\\deliverables\\x"],
    [" logos/b1/x.png"],
    ["design-images/b1/x.png "],
  ])("rejects key %j, which a URL would read as something else", (key) => {
    expect(
      designDocumentSchema.safeParse(withElement(0, { asset: { key } }))
        .success,
    ).toBe(false);
  });

  it.each([
    ["logos/u1/1729500000000-a1b2c3d4e5f6.png"],
    ["design-images/0b7c6a5e-1d2f-4a3b-9c8d-7e6f5a4b3c2d/f00d.jpg"],
    ["generated/0b7c6a5e-1d2f-4a3b-9c8d-7e6f5a4b3c2d/plates/p_1.png"],
  ])("accepts %s, a key in the shape the app mints", (key) => {
    expect(
      designDocumentSchema.safeParse(withElement(0, { asset: { key } }))
        .success,
    ).toBe(true);
  });

  it("rejects an asset ref with a url field alongside the key", () => {
    const doc = withElement(0, {
      asset: { key: "logos/b1/x.png", url: "https://evil.test/x.png" },
    });
    expect(designDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it.each([
    ["width", Number.NaN],
    ["width", -10],
    ["width", 0],
    ["height", Number.NaN],
    ["height", -1],
    ["x", Number.NaN],
    ["y", Number.POSITIVE_INFINITY],
    ["opacity", 1.5],
    ["opacity", -0.1],
    ["rotation", Number.NaN],
  ])("rejects %s = %s", (field, value) => {
    expect(
      designDocumentSchema.safeParse(withElement(2, { [field]: value }))
        .success,
    ).toBe(false);
  });

  it.each([
    ["fontSize", Number.NaN],
    ["fontSize", -12],
    ["lineHeight", Number.NaN],
    ["fontWeight", 650],
  ])("rejects text %s = %s", (field, value) => {
    expect(
      designDocumentSchema.safeParse(withElement(2, { [field]: value }))
        .success,
    ).toBe(false);
  });

  it("rejects NaN or negative canvas sizes", () => {
    expect(
      designDocumentSchema.safeParse({ ...DOC, width: Number.NaN }).success,
    ).toBe(false);
    expect(designDocumentSchema.safeParse({ ...DOC, height: -1 }).success).toBe(
      false,
    );
  });

  /* B3 (round 1): a 10000x10000 canvas was schema-valid and took 54s and
     1.9GB to rasterize. A canvas is one of the sizes the app renders. */
  it.each(SUPPORTED_ASPECT_RATIOS)("accepts the %s canvas", (ratio) => {
    const canvas = canvasFor(ratio);
    expect(designDocumentSchema.safeParse({ ...DOC, ...canvas }).success).toBe(
      true,
    );
  });

  it.each([
    [10_000, 10_000],
    [4096, 4096],
    [1080, 1351],
    [1350, 1080],
    [500, 500],
  ])("rejects a %sx%s canvas", (width, height) => {
    expect(
      designDocumentSchema.safeParse({ ...DOC, width, height }).success,
    ).toBe(false);
  });

  it.each([
    ["x", 1e308],
    ["x", -1e308],
    ["width", 1e308],
    ["width", MAX_CANVAS_EDGE * 2 + 1],
    ["y", MAX_CANVAS_EDGE * 2 + 1],
  ])("rejects element %s = %s", (field, value) => {
    expect(
      designDocumentSchema.safeParse(withElement(1, { [field]: value }))
        .success,
    ).toBe(false);
  });

  it("bounds radius, border and type size", () => {
    for (const patch of [
      { radius: 1e308 },
      { borderWidth: 1e308 },
      { radius: MAX_CANVAS_EDGE + 1 },
    ]) {
      expect(
        designDocumentSchema.safeParse(withElement(1, patch)).success,
        JSON.stringify(patch),
      ).toBe(false);
    }
    expect(
      designDocumentSchema.safeParse(withElement(2, { fontSize: 10_000 }))
        .success,
    ).toBe(false);
    expect(
      designDocumentSchema.safeParse(withElement(3, { fontSize: 10_000 }))
        .success,
    ).toBe(false);
  });

  it("still lets an element hang off the canvas, as a zoomed photo does", () => {
    const doc = withElement(0, { x: -540, width: 2160, height: 2700 });
    expect(designDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects a crop zoom below 1 or a focus outside the frame", () => {
    for (const crop of [
      { zoom: 0.5, focusX: 0.5, focusY: 0.5 },
      { zoom: 1, focusX: 1.2, focusY: 0.5 },
      { zoom: 1, focusX: 0.5, focusY: Number.NaN },
    ]) {
      expect(
        designDocumentSchema.safeParse(withElement(0, { crop })).success,
      ).toBe(false);
    }
  });

  it("rejects duplicate element ids", () => {
    const doc = { ...DOC, elements: [...DOC.elements, DOC.elements[1]] };
    expect(designDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects a version it does not know", () => {
    expect(designDocumentSchema.safeParse({ ...DOC, version: 2 }).success).toBe(
      false,
    );
  });
});

describe("document colours", () => {
  it.each([
    "#fff",
    "#FFF4E6",
    "#00000080",
    "rgb(1, 2, 3)",
    "rgba(0,0,0,0.56)",
    "transparent",
  ])("accepts %s", (value) => {
    expect(isDocumentColor(value)).toBe(true);
  });

  it.each([
    "red",
    "url(https://evil.test/x.png)",
    "#12345",
    "rgba(0,0,0,2)",
    "var(--brand)",
    "#fff; background: url(x)",
    "",
  ])("rejects %s", (value) => {
    expect(isDocumentColor(value)).toBe(false);
  });

  it("accepts a linear gradient made of colours and percentages", () => {
    expect(
      isDocumentGradient(
        "linear-gradient(160deg, #C2410C 0%, rgba(0,0,0,0.5) 100%)",
      ),
    ).toBe(true);
  });

  it.each([
    "linear-gradient(180deg, url(https://evil.test/a.png) 0%, #000 100%)",
    "linear-gradient(180deg, #000 0%, #fff 100%), url(https://evil.test/a.png)",
    "radial-gradient(#000, #fff)",
    "linear-gradient(#000)",
    "linear-gradient(to right, #000 0%, #fff 100%)",
    "linear-gradient(180deg, #000 0%, #fff calc(100% - 1px))",
  ])("rejects %s", (value) => {
    expect(isDocumentGradient(value)).toBe(false);
  });

  /* B1 (round 1's rival): a bare colour word passed the schema and then made
     satori throw `Failed to parse declaration "borderColor: zzzzzz"`. */
  it.each([
    { borderWidth: 2, borderColor: "zzzzzz" },
    { fill: "zzzzzz" },
    { fill: "linear-gradient(180deg, zzzzzz 0%, qqqqqq 100%)" },
    { borderWidth: 2, borderColor: "hsl(deg)" },
    { borderWidth: 2, borderColor: "rgb(,,,)" },
  ])("rejects a colour satori cannot parse: %j", (patch) => {
    expect(designDocumentSchema.safeParse(withElement(1, patch)).success).toBe(
      false,
    );
  });

  it("rejects an injected fill on a shape", () => {
    const doc = withElement(1, {
      fill: "linear-gradient(180deg, #000 0%, #fff 100%), url(https://evil.test/a.png)",
    });
    expect(designDocumentSchema.safeParse(doc).success).toBe(false);
  });
});

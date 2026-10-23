// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const rasterizeDocument = vi.fn();
const judgeAndCorrect = vi.fn();

vi.mock("@/lib/design/document/rasterize", () => ({
  rasterizeDocument: (input: unknown) => rasterizeDocument(input),
}));
vi.mock("@/lib/design/document/measure", async () => {
  const { monospaceMeasurer } = await import("@/lib/design/document/fixtures");
  return { createRendererMeasurer: () => monospaceMeasurer() };
});
vi.mock("@/lib/design/quality/judge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  judgeAndCorrect: (args: unknown) => judgeAndCorrect(args),
}));

const { LOGO_NOT_LEGIBLE } = await import("@/lib/design/logo-contrast");
const { LOGO_UNDECODABLE_IN_RENDER } = await import("@/lib/design/render/logo");
const { designDocumentSchema } = await import("@/lib/design/document/schema");
const { documentRenderer, drawsDifferently, renderDirectionGuarded } =
  await import("./render");
const { designSpecOf } = await import("./schema");
const { designPng, directionsContext, draftOf } = await import("./fixtures");

const spec = designSpecOf(draftOf() as Parameters<typeof designSpecOf>[0]);
const context = directionsContext();
const fonts = { fonts: [], fault: null };
const photo = {
  ref: { key: "design-images/b/photo.png" },
  asset: { bytes: designPng(64, 64), contentType: "image/png" },
};
const mark = {
  placed: {
    ref: { key: "generated/b/marks/abc.png" },
    asset: { bytes: designPng(200, 50), contentType: "image/png" },
  },
  loaded: {
    bytes: designPng(200, 50),
    contentType: "image/png",
    darkest: 0.02,
    lightest: 0.1,
    aspect: 4,
  },
};

function rasterized(over: Record<string, unknown> = {}) {
  return (input: { doc: unknown }) =>
    Promise.resolve({
      bytes: designPng(1080, 1350),
      contentType: "image/png",
      width: 1080,
      height: 1350,
      document: input.doc,
      logoFault: null,
      brandFontFault: null,
      ...over,
    });
}

beforeEach(() => {
  rasterizeDocument.mockReset();
  judgeAndCorrect.mockReset();
  rasterizeDocument.mockImplementation(rasterized());
});

describe("documentRenderer", () => {
  it("draws a valid document over the photograph and the stored mark", async () => {
    const out = await documentRenderer(
      context,
      { image: photo, logo: mark },
      fonts,
    )(spec);
    expect(designDocumentSchema.safeParse(out.document).success).toBe(true);
    const types = out.document.elements.map((e) => e.type);
    expect(types).toContain("image");
    expect(types).toContain("logo");
    const { assets, logoInk } = rasterizeDocument.mock.calls[0][0];
    expect(Object.keys(assets).sort()).toEqual(
      [mark.placed.ref.key, photo.ref.key].sort(),
    );
    expect(logoInk[mark.placed.ref.key]).toEqual({
      darkest: 0.02,
      lightest: 0.1,
    });
  });

  it("draws on a flat ground when there is no image", async () => {
    const out = await documentRenderer(
      context,
      { image: null, logo: null },
      fonts,
    )(spec);
    expect(out.document.elements.some((e) => e.type === "image")).toBe(false);
  });

  it("keeps the design and names the mark when satori cannot draw it", async () => {
    rasterizeDocument.mockImplementation((input: { assets: object }) =>
      mark.placed.ref.key in input.assets
        ? Promise.reject(new Error("u2 is not iterable"))
        : rasterized()(input as never),
    );
    const out = await documentRenderer(
      context,
      { image: photo, logo: mark },
      fonts,
    )(spec);
    expect(out.logoFault).toBe(LOGO_UNDECODABLE_IN_RENDER);
    expect(out.logoUnplaced).toBe(true);
    expect(out.document.elements.some((e) => e.type === "logo")).toBe(false);
  });

  it("reports the original failure when the mark was not the cause", async () => {
    rasterizeDocument.mockRejectedValue(new Error("resvg out of memory"));
    await expect(
      documentRenderer(context, { image: photo, logo: mark }, fonts)(spec),
    ).rejects.toThrow("resvg out of memory");
  });
});

describe("drawsDifferently", () => {
  it("ignores fields a document does not draw", () => {
    expect(
      drawsDifferently(spec, { ...spec, backgroundPrompt: "another scene" }),
    ).toBe(false);
    expect(drawsDifferently(spec, { ...spec, nativePrompt: "x" })).toBe(false);
  });

  it("sees copy, palette and corner changes", () => {
    expect(drawsDifferently(spec, { ...spec, headline: "New" })).toBe(true);
    expect(
      drawsDifferently(spec, {
        ...spec,
        palette: { ...spec.palette, accent: "#000000" },
      }),
    ).toBe(true);
    expect(
      drawsDifferently(spec, { ...spec, logoPlacement: "bottom-left" }),
    ).toBe(true);
  });
});

describe("renderDirectionGuarded", () => {
  const verdict = {
    scores: {},
    weakest: "integration",
    seriousFailure: false,
    symptom: "weak-hierarchy",
    change: { field: "layout", value: "split-left" },
    reason: "x",
    sawImage: true,
  };

  function guarded(onFirstRender = vi.fn()) {
    return renderDirectionGuarded({
      id: "row-1",
      spec,
      context,
      assets: { image: photo, logo: mark },
      fonts,
      outOfTime: () => false,
      onFirstRender,
    });
  }

  it("delivers a passing design with one render and no judge call", async () => {
    const onFirstRender = vi.fn();
    const out = await guarded(onFirstRender);
    expect(out.fault).toBeUndefined();
    expect(rasterizeDocument).toHaveBeenCalledTimes(1);
    expect(judgeAndCorrect).not.toHaveBeenCalled();
    expect(onFirstRender).toHaveBeenCalledTimes(1);
  });

  it("renders the judge's correction once when the mark does not read", async () => {
    rasterizeDocument
      .mockImplementationOnce(rasterized({ logoFault: LOGO_NOT_LEGIBLE }))
      .mockImplementation(rasterized());
    judgeAndCorrect.mockResolvedValue({
      corrected: true,
      spec: { ...spec, logoPlacement: "bottom-left" },
      verdict: {
        ...verdict,
        change: { field: "logoPlacement", value: "bottom-left" },
      },
      applied: { field: "logoPlacement", from: "top-right", to: "bottom-left" },
    });
    const out = await guarded();
    expect(judgeAndCorrect).toHaveBeenCalledWith(
      expect.objectContaining({ renderer: "composite", hasLogo: true }),
    );
    expect(rasterizeDocument).toHaveBeenCalledTimes(2);
    expect(out.spec.logoPlacement).toBe("bottom-left");
    expect(out.correctionKept).toBe(true);
    expect(out.fault).toBeUndefined();
  });

  it("refuses a correction that would move the layout the pair settled", async () => {
    rasterizeDocument.mockImplementation(
      rasterized({ logoFault: LOGO_NOT_LEGIBLE }),
    );
    judgeAndCorrect.mockResolvedValue({
      corrected: true,
      spec: { ...spec, layout: "split-left" },
      verdict,
      applied: { field: "layout", from: "hero-center", to: "split-left" },
    });
    const out = await guarded();
    expect(rasterizeDocument).toHaveBeenCalledTimes(1);
    expect(out.spec.layout).toBe(spec.layout);
    expect(out.fault).toBeDefined();
  });

  it("refuses a correction the document would not draw", async () => {
    rasterizeDocument.mockImplementation(
      rasterized({ logoFault: LOGO_NOT_LEGIBLE }),
    );
    judgeAndCorrect.mockResolvedValue({
      corrected: true,
      spec: { ...spec, backgroundPrompt: "a calmer corner" },
      verdict,
      applied: null,
    });
    await guarded();
    expect(rasterizeDocument).toHaveBeenCalledTimes(1);
  });

  it("does not re-roll a deterministic render of the same spec", async () => {
    rasterizeDocument.mockImplementation(
      rasterized({ bytes: designPng(1080, 1350).slice(0, 80) }),
    );
    judgeAndCorrect.mockResolvedValue({
      corrected: false,
      spec,
      verdict: null,
      applied: null,
    });
    const out = await guarded();
    expect(rasterizeDocument).toHaveBeenCalledTimes(1);
    expect(out.fault).toMatch(/flat/);
  });

  /* Round-3 code critic: the gate kept a correction on the pixel checks
     alone. The second render is held to the rules the first layout was
     chosen by. */
  it("discards a corrected render that draws its headline under other copy", async () => {
    rasterizeDocument
      .mockImplementationOnce(rasterized({ logoFault: LOGO_NOT_LEGIBLE }))
      .mockImplementation((input: { doc: { elements: { id: string }[] } }) =>
        rasterized()({
          doc: {
            ...input.doc,
            elements: input.doc.elements.map((e) =>
              e.id === "headline" ? { ...e, fontSize: 6 } : e,
            ),
          },
        }),
      );
    judgeAndCorrect.mockResolvedValue({
      corrected: true,
      spec: { ...spec, logoPlacement: "bottom-left" },
      verdict: {
        ...verdict,
        change: { field: "logoPlacement", value: "bottom-left" },
      },
      applied: { field: "logoPlacement", from: "top-right", to: "bottom-left" },
    });
    const out = await guarded();
    expect(rasterizeDocument).toHaveBeenCalledTimes(2);
    expect(out.correctionKept).toBeUndefined();
    expect(out.spec.logoPlacement).toBe(spec.logoPlacement);
    expect(out.fault).toBeDefined();
  });

  it("refuses a correction whose copy does not hold, before drawing it", async () => {
    rasterizeDocument.mockImplementation(
      rasterized({ logoFault: LOGO_NOT_LEGIBLE }),
    );
    judgeAndCorrect.mockResolvedValue({
      corrected: true,
      spec: { ...spec, footerLines: [], logoPlacement: "bottom-left" },
      verdict,
      applied: null,
    });
    const out = await renderDirectionGuarded({
      id: "row-1",
      spec,
      context,
      assets: { image: photo, logo: mark },
      fonts,
      outOfTime: () => false,
      copyHolds: () => false,
    });
    expect(rasterizeDocument).toHaveBeenCalledTimes(1);
    expect(out.spec).toBe(spec);
  });
});

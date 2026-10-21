// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const renderCompositeDesign = vi.fn();
const judgeAndCorrect = vi.fn();

vi.mock("@/lib/design/render/composite", () => ({
  renderCompositeDesign: (input: unknown) => renderCompositeDesign(input),
}));
vi.mock("@/lib/design/quality/judge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  judgeAndCorrect: (args: unknown) => judgeAndCorrect(args),
}));
vi.mock("@/lib/db/queries", () => ({
  createDesignGeneration: vi.fn(),
  getBrandById: vi.fn(),
  getDesignGenerationById: vi.fn(),
  updateDesignGeneration: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  getObjectBytes: vi.fn(),
  uploadObject: vi.fn(),
  STORAGE_PREFIXES: { generated: "generated" },
  storageKeyFrom: vi.fn(),
}));

import { RUBRIC_CATEGORIES } from "@/lib/design/quality/judge";
import { renderGuarded } from "@/lib/jobs/run-design-generation";

/**
 * A real PNG header plus a body sized in bytes per pixel, because that is what
 * the blank-frame check measures (BLANK_MAX_BYTES_PER_PIXEL = 0.05). A fixed
 * body length is a trap: 40KB clears the floor at 1080x1080 and fails it at
 * 1080x1920, so a test meaning to check the shape would silently be checking
 * blankness instead.
 */
function png(width: number, height: number, bytesPerPixel = 0.08): Uint8Array {
  const bytes = new Uint8Array(64 + Math.ceil(width * height * bytesPerPixel));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const spec = {
  aspectRatio: "1:1",
  layout: "hero-center",
  headline: "Launch week",
  subheadline: "Free delivery",
  cta: "Order now",
  palette: { background: "#0B1F3A", foreground: "#ffffff", accent: "#F2A33C" },
  logoPlacement: "bottom-right",
  footerStyle: "none",
  footerLines: [],
  backgroundPrompt: "a skyline at dusk",
  backgroundTreatment: "photographic",
  nativePrompt: "a launch poster",
};

const context = {
  brand: { id: "b1" },
  brandSummary: { name: "Acme", primaryColor: "#0B1F3A" },
  briefText: "Launch week, free delivery",
} as never;

const variant = {
  id: "v1",
  renderer: "composite" as const,
  adapter: {
    id: "stability",
    supportsReferenceImages: false,
    generate: vi.fn(),
  },
} as never;

/**
 * The compositor's real shape, all of it.
 *
 * `CompositeResult` carries seven fields and the call site writes `width`,
 * `height` and `brandFontFault` to the database. A double supplying only
 * `bytes` leaves those undefined in every test, which is how this repo already
 * shipped `stamped.bytes` as undefined once.
 */
function composite(
  bytes: Uint8Array,
  extra: { logoFault?: string; logoUnplaced?: true } = {},
) {
  const size = { width: 1080, height: 1080 };
  return {
    bytes,
    contentType: "image/png" as const,
    ...size,
    palette: {
      background: "#0B1F3A",
      foreground: "#ffffff",
      accent: "#F2A33C",
    },
    brandFontFault: null,
    logoFault: null,
    ...extra,
  };
}

/** A verdict the way the judge really returns one. A double carrying only the
 *  fields a test reads is how `stamped.bytes` once came back undefined in
 *  every logo test. */
function verdict(symptom: string, weakest = "integration") {
  return {
    /* Read from the module, not restated: the real correctionSummary runs on
       this object, and a hand-written list that falls behind RUBRIC_CATEGORIES
       makes its total NaN while every assertion still passes. */
    scores: Object.fromEntries(
      RUBRIC_CATEGORIES.map((category) => [
        category,
        category === weakest ? 2 : 4,
      ]),
    ),
    weakest,
    seriousFailure: false,
    symptom,
    change: { field: "layout", value: "split-left" },
    reason: "the frame reads flat",
    sawImage: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  (
    variant as unknown as { adapter: { generate: ReturnType<typeof vi.fn> } }
  ).adapter.generate.mockResolvedValue({
    bytes: png(1080, 1080),
    contentType: "image/png",
  });
});

/* KOOS-AI-001 AC-3. The correction pass used to re-render the IDENTICAL spec,
   which is a dice re-roll, not a correction. These tests exist because the
   bullet "the re-render uses the corrected spec" is a property of this
   function and of nothing else — the judge module cannot prove it. */
describe("renderGuarded", () => {
  it("costs no judge call when the design passes its checks", async () => {
    renderCompositeDesign.mockResolvedValue(composite(png(1080, 1080)));

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
    );

    expect(judgeAndCorrect).not.toHaveBeenCalled();
    expect(renderCompositeDesign).toHaveBeenCalledTimes(1);
    expect(result.fault).toBeUndefined();
    expect(result.spec).toBe(spec);
  });

  /* The assertion the whole unit turns on. */
  it("renders the corrected spec, not the one that failed", async () => {
    const corrected = { ...spec, layout: "split-left" };
    renderCompositeDesign
      .mockResolvedValueOnce(composite(png(1080, 1080, 0.001)))
      .mockResolvedValueOnce(composite(png(1080, 1080)));
    judgeAndCorrect.mockResolvedValue({
      corrected: true,
      spec: corrected,
      verdict: verdict("flat"),
      applied: { field: "layout", from: "hero-center", to: "split-left" },
    });

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
    );

    expect(renderCompositeDesign).toHaveBeenCalledTimes(2);
    expect(renderCompositeDesign.mock.calls[1][0].spec).toBe(corrected);
    /* The row stores the spec that produced the delivered bytes, because the
       layout memory reads it back to shape the brand's next design. */
    expect(result.spec).toBe(corrected);
    expect(result.fault).toBeUndefined();
  });

  it("never renders more than twice", async () => {
    renderCompositeDesign.mockResolvedValue(composite(png(1080, 1080, 0.001)));
    judgeAndCorrect.mockResolvedValue({
      corrected: true,
      spec: { ...spec, backgroundPrompt: "a quiet courtyard" },
      verdict: verdict("empty", "spacing"),
      applied: {
        field: "backgroundPrompt",
        from: "a skyline at dusk",
        to: "x",
      },
    });

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
    );

    expect(renderCompositeDesign).toHaveBeenCalledTimes(2);
    expect(judgeAndCorrect).toHaveBeenCalledTimes(1);
    expect(result.fault).toBeTruthy();
  });

  /* An unreadable mark is the fault the correctable/retryable split unlocked:
     re-rolling the same spec cannot change a mark's contrast against its own
     ground, so without a correction there is nothing to render. */
  it("asks the judge about an unreadable logo and delivers when it has no answer", async () => {
    renderCompositeDesign.mockResolvedValue(
      composite(png(1080, 1080), { logoFault: "the mark does not read" }),
    );
    judgeAndCorrect.mockResolvedValue({
      corrected: false,
      spec,
      verdict: verdict("off-brand", "brandRecognition"),
      applied: null,
    });

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
    );

    expect(judgeAndCorrect).toHaveBeenCalledTimes(1);
    expect(renderCompositeDesign).toHaveBeenCalledTimes(1);
    expect(result.fault).toContain("does not read");
    /* The verdict is still recorded, so the log can tell "the judge found
       nothing" from "the judge never ran". */
    expect(result.correction).toBeTruthy();
  });

  /* The image reaches the judge only when there are pixels worth reading. */
  it("hands the judge the rendered bytes and the brief", async () => {
    const rendered = png(1080, 1080);
    renderCompositeDesign.mockResolvedValue(
      composite(rendered, { logoFault: "the mark does not read" }),
    );
    judgeAndCorrect.mockResolvedValue({
      corrected: false,
      spec,
      verdict: null,
      applied: null,
    });

    await renderGuarded(variant, spec as never, context, null, []);

    expect(judgeAndCorrect).toHaveBeenCalledWith(
      expect.objectContaining({
        image: rendered,
        renderer: "composite",
        brief: "Launch week, free delivery",
        hasLogo: false,
      }),
    );
  });

  /* A blank plate is the image model having returned nothing, and the next
     roll is a different plate. That re-roll must survive the judge being
     unreachable, or adding the judge would have removed a working retry. */
  it("still re-rolls a blank frame when the judge produced nothing", async () => {
    renderCompositeDesign
      .mockResolvedValueOnce(composite(png(1080, 1080, 0.001)))
      .mockResolvedValueOnce(composite(png(1080, 1080)));
    judgeAndCorrect.mockResolvedValue({
      corrected: false,
      spec,
      verdict: null,
      applied: null,
    });

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
    );

    expect(renderCompositeDesign).toHaveBeenCalledTimes(2);
    expect(renderCompositeDesign.mock.calls[1][0].spec).toBe(spec);
    expect(result.fault).toBeUndefined();
  });

  /* The user must never lose a rendered design because the critic was
     unavailable. */
  it("delivers the design when the judge throws", async () => {
    renderCompositeDesign
      .mockResolvedValueOnce(composite(png(1080, 1080, 0.001)))
      .mockResolvedValueOnce(composite(png(1080, 1080)));
    judgeAndCorrect.mockRejectedValue(new Error("Forbidden"));

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
    );

    expect(result.bytes.length).toBeGreaterThan(0);
    expect(result.correction).toBeUndefined();
  });

  /* The wrong shape is deterministic adapter substitution, so neither a
     re-roll nor a changed spec alters what comes back and a judge call would
     buy a verdict nobody can act on. */
  it("spends nothing on a design that came back the wrong shape", async () => {
    renderCompositeDesign.mockResolvedValue(composite(png(1080, 1920)));

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
    );

    expect(judgeAndCorrect).not.toHaveBeenCalled();
    expect(renderCompositeDesign).toHaveBeenCalledTimes(1);
    expect(result.fault).toContain("not the shape");
  });

  /* Ties go to the first render, so a correction that did not help must not
     change what the user sees or what the row stores. */
  it("keeps the original spec when the correction did not help", async () => {
    renderCompositeDesign.mockResolvedValue(composite(png(1080, 1080, 0.001)));
    judgeAndCorrect.mockResolvedValue({
      corrected: true,
      spec: { ...spec, layout: "quote-card" },
      verdict: verdict("generic", "freshness"),
      applied: { field: "layout", from: "hero-center", to: "quote-card" },
    });

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
    );

    expect(result.spec).toBe(spec);
  });
});

/* The findings of the second round of review. */
describe("renderGuarded, after review", () => {
  /* `logoFault` has four producers and only one is a measurement. The other
     three mean the mark never reached the design, and nothing in the spec
     makes an undecodable file decodable — so sending them to the judge would
     spend a reasoning call and a full second image render, on every
     generation, for every brand whose logo we cannot read. */
  it("spends nothing when the mark was never placed", async () => {
    /* The real path: satori throws on the brand's logo, the compositor is
       retried without it, and the design comes back with no mark on it. The
       `logoUnplaced` flag is set by renderVariant, not by the compositor, so
       stubbing it on the compositor's own result would prove nothing. */
    renderCompositeDesign
      .mockRejectedValueOnce(new Error("u2 is not iterable"))
      .mockResolvedValue(composite(png(1080, 1080)));

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" } as never,
      [],
    );

    expect(judgeAndCorrect).not.toHaveBeenCalled();
    /* Two composites, one design: the second is renderVariant's retry without
       the logo, not a second render of the design. */
    expect(renderCompositeDesign).toHaveBeenCalledTimes(2);
    expect(result.logoFault).toBeTruthy();
    /* The design still ships and the user is still told, through the logo-fault
       notification the job already sends. */
    expect(result.fault).toBeUndefined();
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  /* A correction costs a reasoning call plus a second image render, and this
     project has measured single images at 55-663s against a 300s route. */
  it("skips the correction once the slice deadline has passed", async () => {
    renderCompositeDesign.mockResolvedValue(composite(png(1080, 1080, 0.001)));

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
      () => true,
    );

    expect(judgeAndCorrect).not.toHaveBeenCalled();
    expect(renderCompositeDesign).toHaveBeenCalledTimes(1);
    expect(result.fault).toBeTruthy();
  });

  /* A verdict arrives on every refused prescription too, so one counter made a
     refusal and a delivered correction indistinguishable. */
  it("reports a kept correction separately from a verdict that bought nothing", async () => {
    renderCompositeDesign
      .mockResolvedValueOnce(composite(png(1080, 1080, 0.001)))
      .mockResolvedValueOnce(composite(png(1080, 1080)));
    judgeAndCorrect.mockResolvedValue({
      corrected: true,
      spec: { ...spec, layout: "split-left" },
      verdict: verdict("flat"),
      applied: { field: "layout", from: "hero-center", to: "split-left" },
    });

    const kept = await renderGuarded(variant, spec as never, context, null, []);
    expect(kept.correction).toBeTruthy();
    expect(kept.correctionKept).toBe(true);

    vi.clearAllMocks();
    renderCompositeDesign.mockResolvedValue(
      composite(png(1080, 1080), { logoFault: "the mark does not read" }),
    );
    judgeAndCorrect.mockResolvedValue({
      corrected: false,
      spec,
      verdict: verdict("off-brand", "brandRecognition"),
      applied: null,
    });

    const refused = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
    );
    expect(refused.correction).toBeTruthy();
    expect(refused.correctionKept).toBeUndefined();
  });

  /* Severity before count: a correction that turned an empty frame into a real
     design with an imperfect mark used to be discarded, and the empty frame
     delivered. */
  it("keeps a real design with a weak mark over a blank frame", async () => {
    const corrected = { ...spec, backgroundPrompt: "a quiet courtyard" };
    renderCompositeDesign
      .mockResolvedValueOnce(composite(png(1080, 1080, 0.001)))
      .mockResolvedValueOnce(
        composite(png(1080, 1080), { logoFault: "the mark does not read" }),
      );
    judgeAndCorrect.mockResolvedValue({
      corrected: true,
      spec: corrected,
      verdict: verdict("empty", "spacing"),
      applied: {
        field: "backgroundPrompt",
        from: "a skyline at dusk",
        to: "a quiet courtyard",
      },
    });

    const result = await renderGuarded(
      variant,
      spec as never,
      context,
      null,
      [],
    );

    expect(result.spec).toBe(corrected);
    expect(result.correctionKept).toBe(true);
    expect(result.fault).toContain("does not read");
  });
});

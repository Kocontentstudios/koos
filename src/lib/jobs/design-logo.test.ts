// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
const loadBrandLogo = vi.fn();
const overlayLogo = vi.fn();
const renderCompositeDesign = vi.fn();
const getObjectBytes = vi.fn();
const createNotification = vi.fn();
const updateDesignGeneration = vi.fn();
const getPlateAdapter = vi.fn();
const getNativeAdapters = vi.fn();

vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));
vi.mock("@/lib/ai/image", () => ({
  getPlateAdapter: () => getPlateAdapter(),
  getNativeAdapters: () => getNativeAdapters(),
}));
vi.mock("@/lib/design/render/logo", async (importOriginal) => ({
  // The fault vocabulary is real; only the loading is stubbed.
  ...(await importOriginal<typeof import("@/lib/design/render/logo")>()),
  loadBestLogo: (args: unknown) => loadBrandLogo(args),
}));
vi.mock("@/lib/design/render/logo-overlay", () => ({
  overlayLogo: (input: unknown) => overlayLogo(input),
}));
vi.mock("@/lib/design/render/composite", () => ({
  renderCompositeDesign: (input: unknown) => renderCompositeDesign(input),
}));
vi.mock("@/lib/db/queries", () => ({
  createDesignGeneration: vi
    .fn()
    .mockImplementation(() => Promise.resolve({ id: "row" })),
  createNotification: (input: unknown) => createNotification(input),
  recordUsageEvent: vi.fn(),
  updateDesignGeneration: (id: string, patch: unknown) =>
    updateDesignGeneration(id, patch),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  getObjectBytes: (key: string) => getObjectBytes(key),
  uploadObject: vi.fn(),
  // Mirrors the real one closely enough to exercise key-vs-string matching:
  // the query string is not part of the key.
  storageKeyFrom: (url: string) =>
    url?.startsWith("ok:") ? url.slice(3).split("?")[0] : null,
  STORAGE_PREFIXES: {
    generated: "generated",
    logos: "logos",
    referenceImages: "reference-images",
  },
}));

const { generateDesignWork } = await import("@/lib/jobs/run-design-generation");

function png(width = 8, height = 8): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const LOGO = { bytes: new Uint8Array([1, 1, 1]), contentType: "image/png" };
const ATTACHMENT = new Uint8Array([9, 9, 9]);

const draftedSpec = {
  layout: "hero-center",
  headline: "Launch week",
  palette: { background: "#000", foreground: "#fff", accent: "#f00" },
  logoPlacement: "none",
  logoFree: false,
  logoFreeQuote: "",
  backgroundPrompt: "a skyline",
  backgroundTreatment: "photographic",
  nativePrompt: "a launch poster",
  aspectRatio: "1:1",
};

const nativeGenerate = vi.fn();

function context(over: Record<string, unknown> = {}) {
  return {
    source: "quick",
    brand: { id: "b1", logoUrl: "ok:logos/u/a.png" },
    brandSummary: { name: "Acme" },
    briefId: null,
    calendarItemId: null,
    attachments: [],
    title: null,
    briefText: null,
    designType: "Flyer",
    dimensions: null,
    aspectRatio: "1:1",
    platform: null,
    scheduledFor: null,
    referenceUrls: [],
    logoAssetUrls: [],
    ...over,
  } as never;
}

const runtime = { reportProgress: vi.fn() } as never;

beforeEach(() => {
  vi.clearAllMocks();
  generateObject.mockResolvedValue({ object: { ...draftedSpec } });
  loadBrandLogo.mockResolvedValue({ logo: LOGO, fault: null });
  overlayLogo.mockResolvedValue(png(64, 64));
  nativeGenerate.mockResolvedValue({
    bytes: png(1024, 1024),
    contentType: "image/png",
  });
  getPlateAdapter.mockReturnValue(null);
  getNativeAdapters.mockReturnValue([
    {
      id: "google",
      model: "gemini-3-pro-image",
      supportsTextRendering: true,
      supportsReferenceImages: true,
      generate: nativeGenerate,
    },
  ]);
  getObjectBytes.mockResolvedValue(Buffer.from(ATTACHMENT));
  updateDesignGeneration.mockResolvedValue(undefined);
  createNotification.mockResolvedValue(undefined);
});

describe("the logo reaches the design", () => {
  /* The shipped bug. "none" is in the enum, the prompt gave the art director
     no grounds to choose it, and it chose it anyway — so the brand's mark
     never appeared and the persisted spec agreed that it should not. */
  it("overrides an art director that suppressed the logo", async () => {
    await generateDesignWork({ context: context(), userId: "u1" }, runtime);

    expect(overlayLogo).toHaveBeenCalledTimes(1);
    expect(overlayLogo.mock.calls[0][0]).toMatchObject({
      logo: LOGO,
      placement: "top-right",
      layout: "hero-center",
    });
  });

  it("stamps the real file rather than letting the model redraw it", async () => {
    const modelOutput = png(1024, 1024);
    nativeGenerate.mockResolvedValue({
      bytes: modelOutput,
      contentType: "image/png",
    });

    await generateDesignWork({ context: context(), userId: "u1" }, runtime);

    const sent = nativeGenerate.mock.calls[0][0];
    // Handing the model the logo is what lets it approximate the mark.
    expect(sent.referenceImages).toBeUndefined();
    expect(sent.prompt).toMatch(/leave the top right corner clear/i);
    expect(sent.prompt).toMatch(/do not draw a logo yourself/i);
    expect(overlayLogo.mock.calls[0][0].image.bytes).toBe(modelOutput);
  });

  it("still passes the user's own attachments to the model", async () => {
    await generateDesignWork(
      {
        context: context({ referenceUrls: ["ok:reference-images/u/r.png"] }),
        userId: "u1",
      },
      runtime,
    );

    const sent = nativeGenerate.mock.calls[0][0];
    expect(sent.referenceImages).toHaveLength(1);
    expect(sent.referenceImages[0].bytes).toEqual(ATTACHMENT);
  });

  /* The second shipped bug: the logo used to be recovered as references[0],
     which was the logo only while the logo loaded. A brand whose logo failed
     but who had attached a reference got that reference drawn in the logo
     slot — someone else's artwork presented as their mark. */
  it("never promotes an attachment into the logo slot", async () => {
    loadBrandLogo.mockResolvedValue({ logo: null, fault: "it was unreadable" });
    getPlateAdapter.mockReturnValue({
      id: "bedrock-stability",
      model: "stability",
      supportsTextRendering: false,
      supportsReferenceImages: false,
      generate: vi
        .fn()
        .mockResolvedValue({ bytes: png(8, 8), contentType: "image/png" }),
    });
    renderCompositeDesign.mockResolvedValue({
      bytes: png(1080, 1080),
      width: 1080,
      height: 1080,
      brandFontFault: null,
    });

    await generateDesignWork(
      {
        context: context({ referenceUrls: ["ok:reference-images/u/r.png"] }),
        userId: "u1",
      },
      runtime,
    );

    // The attachment loaded; only the logo failed. Neither renderer may treat
    // that attachment as the brand's mark.
    expect(renderCompositeDesign.mock.calls[0][0].logo).toBeNull();
    expect(overlayLogo).not.toHaveBeenCalled();
  });

  /* The claim that an attachment which IS the brand logo is dropped, so the
     model cannot redraw a second mark beside the one we stamp. Compared as
     storage keys: the same object reaches the list through different URLs. */
  it("drops an attachment that is the brand logo itself", async () => {
    await generateDesignWork(
      {
        context: context({
          referenceUrls: ["ok:logos/u/a.png", "ok:reference-images/u/r.png"],
        }),
        userId: "u1",
      },
      runtime,
    );

    const sent = nativeGenerate.mock.calls[0][0];
    expect(sent.referenceImages).toHaveLength(1);
  });

  it("matches the logo by key, not by exact URL string", async () => {
    await generateDesignWork(
      {
        context: context({ referenceUrls: ["ok:logos/u/a.png?v=2"] }),
        userId: "u1",
      },
      runtime,
    );

    // Same object, different URL: it must still not reach the model.
    const sent = nativeGenerate.mock.calls[0][0];
    expect(sent.referenceImages).toBeUndefined();
  });

  /* The row is written before rendering, so a variant that dropped the mark
     would otherwise keep a spec claiming a corner it does not have — and the
     spec is what every later surface reads. */
  it("corrects the stored spec when a variant lost the mark", async () => {
    overlayLogo.mockRejectedValue(new Error("resvg"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await generateDesignWork({ context: context(), userId: "u1" }, runtime);

    expect(updateDesignGeneration.mock.calls[0][1].spec).toMatchObject({
      logoPlacement: "none",
    });
    error.mockRestore();
  });

  it("leaves the stored spec alone when the mark went on", async () => {
    await generateDesignWork({ context: context(), userId: "u1" }, runtime);

    expect(updateDesignGeneration.mock.calls[0][1].spec).toBeUndefined();
  });

  it("persists the placement it actually rendered, not the draft", async () => {
    const created = (await import("@/lib/db/queries"))
      .createDesignGeneration as unknown as ReturnType<typeof vi.fn>;
    await generateDesignWork({ context: context(), userId: "u1" }, runtime);

    expect(created.mock.calls[0][0].spec.logoPlacement).toBe("top-right");
  });

  it("leaves the logo off when the brief asked for none", async () => {
    generateObject.mockResolvedValue({
      object: {
        ...draftedSpec,
        logoFree: true,
        logoFreeQuote: "No logo on this one",
      },
    });

    await generateDesignWork(
      {
        context: context({ briefText: "No logo on this one, please." }),
        userId: "u1",
      },
      runtime,
    );

    expect(overlayLogo).not.toHaveBeenCalled();
    // No R2 read and no rasterise to decide not to draw it.
    expect(loadBrandLogo).not.toHaveBeenCalled();
  });

  /* An omission the user did not intend looks exactly like the reported bug:
     the logo is simply not there. No textual guard can settle whether a
     sentence asked for removal, so saying so is what makes a wrong reading
     correctable instead of invisible. */
  it("tells the user when it deliberately left the logo off", async () => {
    generateObject.mockResolvedValue({
      object: {
        ...draftedSpec,
        logoFree: true,
        logoFreeQuote: "No logo on this one",
      },
    });

    await generateDesignWork(
      {
        context: context({ briefText: "No logo on this one, please." }),
        userId: "u1",
      },
      runtime,
    );

    expect(createNotification).toHaveBeenCalledTimes(1);
    const message = createNotification.mock.calls[0][0].payload.message;
    expect(message).toMatch(/without your brand logo/i);
    // It quotes the words it acted on, so a wrong reading is obvious.
    expect(message).toContain("No logo on this one");
  });

  it("says so when the logo IS the deliverable", async () => {
    await generateDesignWork(
      { context: context({ designType: "Logo Design" }), userId: "u1" },
      runtime,
    );

    expect(createNotification.mock.calls[0][0].payload.message).toMatch(
      /sitting on its own replacement/i,
    );
  });

  it("stays quiet about a brand that has no logo to leave off", async () => {
    loadBrandLogo.mockResolvedValue({ logo: null, fault: null });

    await generateDesignWork(
      {
        context: context({
          brand: { id: "b1", logoUrl: null },
          designType: "Logo Design",
        }),
        userId: "u1",
      },
      runtime,
    );

    expect(createNotification).not.toHaveBeenCalled();
  });

  /* The stored spec has to record the RESOLVED answer. An uncorroborated
     claim used to persist logoFree: true beside a real corner. */
  it("persists the resolved logo-free answer, not the model's claim", async () => {
    const created = (await import("@/lib/db/queries"))
      .createDesignGeneration as unknown as ReturnType<typeof vi.fn>;
    generateObject.mockResolvedValue({
      object: {
        ...draftedSpec,
        logoFree: true,
        logoFreeQuote: "words the brief never contained",
      },
    });

    await generateDesignWork(
      { context: context({ briefText: "Autumn launch." }), userId: "u1" },
      runtime,
    );

    const spec = created.mock.calls[0][0].spec;
    expect(spec.logoFree).toBe(false);
    expect(spec.logoFreeQuote).toBe("");
    expect(spec.logoPlacement).not.toBe("none");
  });

  /* Designing a logo means the existing mark is what is being replaced. */
  it("leaves the logo off when the logo IS the deliverable", async () => {
    await generateDesignWork(
      { context: context({ designType: "Logo" }), userId: "u1" },
      runtime,
    );

    expect(overlayLogo).not.toHaveBeenCalled();
    expect(loadBrandLogo).not.toHaveBeenCalled();
  });

  /* logoFree alone is a boolean the model can simply get wrong, with exactly
     the consequences that made "none" a bug. The quotation is what makes it
     checkable: those words are in the brief or they are not. */
  it("ignores logoFree when the quote is not in the brief", async () => {
    generateObject.mockResolvedValue({
      object: {
        ...draftedSpec,
        logoFree: true,
        // A phrase the brief never contains.
        logoFreeQuote: "leave the logo off",
      },
    });

    await generateDesignWork(
      {
        context: context({
          briefText: "Announce the autumn collection with a warm photograph.",
        }),
        userId: "u1",
      },
      runtime,
    );

    expect(overlayLogo).toHaveBeenCalledTimes(1);
  });

  /* The regex this replaced read "never omit the logo" as "omit the logo".
     Nothing in the job may suppress the mark on brief text alone any more. */
  it("keeps the mark on a brief that only insists it be kept", async () => {
    generateObject.mockResolvedValue({
      object: {
        ...draftedSpec,
        logoFree: true,
        // A brief discussing the logo is exactly where a wrong answer is
        // likeliest, and a mention alone used to open the gate.
        logoFreeQuote: "no logo",
      },
    });

    await generateDesignWork(
      {
        context: context({
          briefText: "Never omit the logo. No branding changes this quarter.",
        }),
        userId: "u1",
      },
      runtime,
    );

    expect(overlayLogo).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the logo went on cleanly", async () => {
    await generateDesignWork({ context: context(), userId: "u1" }, runtime);

    expect(overlayLogo).toHaveBeenCalledTimes(1);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("leaves the logo off when the brand has none", async () => {
    loadBrandLogo.mockResolvedValue({ logo: null, fault: null });

    await generateDesignWork(
      {
        context: context({ brand: { id: "b1", logoUrl: null } }),
        userId: "u1",
      },
      runtime,
    );

    expect(overlayLogo).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });
});

/* The model may answer in a format satori cannot composite. Without the guard
   it fails deep inside the stamp and the catch reports it as a problem with
   the brand's logo file — sending the user to replace a file that is fine, on
   every generation from that model. */
describe("a model image the renderer cannot stamp", () => {
  function webp(): Uint8Array {
    const bytes = new Uint8Array(32);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    return bytes;
  }

  it("skips the stamp and blames the model, not the brand's file", async () => {
    nativeGenerate.mockResolvedValue({
      bytes: webp(),
      contentType: "image/webp",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await generateDesignWork({ context: context(), userId: "u1" }, runtime);

    expect(overlayLogo).not.toHaveBeenCalled();
    const message = createNotification.mock.calls[0][0].payload.message;
    expect(message).toMatch(/from the image model in a format/i);
    // The remedy must not be "replace your logo".
    expect(message).not.toMatch(/Upload a replacement/i);
    warn.mockRestore();
  });
});

describe("a logo that cannot be used is reported", () => {
  it("tells the user why, instead of omitting it silently", async () => {
    loadBrandLogo.mockResolvedValue({
      logo: null,
      fault: "the file could not be read from storage",
    });

    await generateDesignWork({ context: context(), userId: "u1" }, runtime);

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][0].payload.message).toMatch(
      /logo couldn't be added .* could not be read from storage/i,
    );
  });

  it("keeps the design when the stamp itself fails", async () => {
    overlayLogo.mockRejectedValue(new Error("resvg"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await generateDesignWork(
      { context: context(), userId: "u1" },
      runtime,
    );

    expect(result.resultId).toBeDefined();
    expect(updateDesignGeneration.mock.calls[0][1].status).toBe("succeeded");
    expect(createNotification.mock.calls[0][0].payload.message).toMatch(
      /could not place it on this version/i,
    );
    error.mockRestore();
  });

  /* Every variant loads the same file and would report the same fault. */
  it("reports a load fault once, not once per variant", async () => {
    loadBrandLogo.mockResolvedValue({ logo: null, fault: "it was unreadable" });
    getNativeAdapters.mockReturnValue([
      {
        id: "google",
        model: "m",
        supportsTextRendering: true,
        supportsReferenceImages: true,
        generate: nativeGenerate,
      },
      {
        id: "openai",
        model: "m2",
        supportsTextRendering: true,
        supportsReferenceImages: true,
        generate: nativeGenerate,
      },
    ]);

    await generateDesignWork({ context: context(), userId: "u1" }, runtime);

    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});

describe("a logo the renderer cannot decode", () => {
  beforeEach(() => {
    getPlateAdapter.mockReturnValue({
      id: "bedrock-stability",
      model: "stability",
      supportsTextRendering: false,
      supportsReferenceImages: false,
      generate: vi
        .fn()
        .mockResolvedValue({ bytes: png(8, 8), contentType: "image/png" }),
    });
    getNativeAdapters.mockReturnValue([]);
  });

  /* Before, an undecodable logo took the whole composite variant down and the
     user lost a render rather than a corner. */
  it("keeps the design and says the logo was the cause", async () => {
    renderCompositeDesign
      .mockRejectedValueOnce(new Error("satori: unsupported image"))
      .mockResolvedValueOnce({
        bytes: png(1080, 1080),
        width: 1080,
        height: 1080,
        brandFontFault: null,
      });

    const result = await generateDesignWork(
      { context: context(), userId: "u1" },
      runtime,
    );

    expect(result.resultId).toBeDefined();
    expect(renderCompositeDesign.mock.calls[1][0].logo).toBeNull();
    expect(createNotification.mock.calls[0][0].payload.message).toMatch(
      /could not decode the file/i,
    );
  });

  /* A failure that has nothing to do with the logo must not be relabelled as
     a logo problem — that sends the user to replace a file that is fine. */
  it("reports the original failure when the logo was not the cause", async () => {
    renderCompositeDesign.mockRejectedValue(new Error("font table missing"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      generateDesignWork({ context: context(), userId: "u1" }, runtime),
    ).rejects.toThrow(/Design generation failed/);

    expect(updateDesignGeneration.mock.calls[0][1].error).toMatch(
      /font table missing/,
    );
    expect(createNotification).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

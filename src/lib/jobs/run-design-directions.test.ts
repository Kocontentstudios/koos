// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
const getPlateAdapter = vi.fn();
const createDesignGeneration = vi.fn();
const updateDesignGeneration = vi.fn();
const getDesignGenerationById = vi.fn();
const listDirectionSet = vi.fn();
const recordUsageEvent = vi.fn();
const captureServerEvent = vi.fn();
const uploadObject = vi.fn();
const loadDesignImage = vi.fn();
const rasterizeDocument = vi.fn();

vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));
vi.mock("@/lib/ai/image", () => ({
  getPlateAdapter: () => getPlateAdapter(),
  getNativeAdapters: () => [],
}));
vi.mock("@/lib/ai/memory", () => ({ buildMemoryBlock: async () => "" }));
vi.mock("@/lib/db/queries", () => ({
  createDesignGeneration: (row: unknown) => createDesignGeneration(row),
  updateDesignGeneration: (id: string, patch: unknown) =>
    updateDesignGeneration(id, patch),
  getDesignGenerationById: (id: string) => getDesignGenerationById(id),
  listDirectionSet: (brandId: string, set: string) =>
    listDirectionSet(brandId, set),
  listDesignGenerationsForBrand: async () => [],
  recordUsageEvent: (event: unknown) => recordUsageEvent(event),
  createNotification: (input: unknown) => createNotification(input),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: (event: unknown) => captureServerEvent(event),
}));
vi.mock("@/lib/storage", () => ({
  uploadObject: (input: unknown) => uploadObject(input),
  getObjectBytes: vi.fn(),
  storageKeyFrom: () => null,
  STORAGE_PREFIXES: {
    generated: "generated",
    logos: "logos",
    designImages: "design-images",
  },
}));
vi.mock("@/lib/uploads/design-image", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadDesignImage: (key: string, brandId: string) =>
    loadDesignImage(key, brandId),
}));
vi.mock("@/lib/design/document/rasterize", () => ({
  rasterizeDocument: (input: unknown) => rasterizeDocument(input),
  prepareDocumentFonts: async () => ({ fonts: [], fault: null }),
}));
vi.mock("@/lib/design/document/measure", async () => {
  const { monospaceMeasurer } = await import("@/lib/design/document/fixtures");
  return { createRendererMeasurer: () => monospaceMeasurer() };
});
const loadBestLogo = vi.fn();
const createNotification = vi.fn();
const checkPlateShowsProduct = vi.fn();
vi.mock("@/lib/design/quality/plate-check", () => ({
  checkPlateShowsProduct: (input: unknown) => checkPlateShowsProduct(input),
}));
vi.mock("@/lib/design/render/logo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBestLogo: (args: unknown) => loadBestLogo(args),
}));

const { generateDirectionsWork, RegenerateTargetError } = await import(
  "./run-design-directions"
);
const { DesignImageError } = await import("@/lib/uploads/design-image");
const { BRAND_ID, contrastingDraft, designPng, directionsContext, draftOf } =
  await import("./directions/fixtures");

const UPLOAD_KEY = `design-images/${BRAND_ID}/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.png`;
const SET = "9c0e8f5a-3b2d-4c1e-8f7a-6d5c4b3a2f10";

const plateModel = {
  id: "bedrock-stability",
  label: "Stability",
  model: "stable-image-core",
  supportsTextRendering: false,
  supportsReferenceImages: false,
  generate: vi.fn(),
};

const progress: { stage?: string; done: number; total: number }[] = [];
const runtime = {
  jobId: "job-1",
  reportProgress: (p: (typeof progress)[number]) => progress.push(p),
  checkpoint: {},
  saveCheckpoint: vi.fn(),
  shouldPause: () => false,
};

let rowCount = 0;

function run(request: Record<string, unknown>) {
  return generateDirectionsWork(
    {
      context: directionsContext(),
      userId: "u1",
      sessionId: "s1",
      request: request as never,
    },
    runtime as never,
  );
}

const stagesSeen = () =>
  progress.map((p) => p.stage).filter((s, i, all) => s !== all[i - 1]);
const updatesFor = (id: string) =>
  updateDesignGeneration.mock.calls
    .filter(([rowId]) => rowId === id)
    .map(([, patch]) => patch);
const documentOf = (id: string) =>
  updatesFor(id).find((patch) => patch.document)?.document;

beforeEach(() => {
  vi.clearAllMocks();
  progress.length = 0;
  rowCount = 0;
  generateObject.mockResolvedValue({
    object: { directions: [draftOf(), contrastingDraft()] },
  });
  getPlateAdapter.mockReturnValue(plateModel);
  plateModel.generate.mockImplementation(async () => ({
    bytes: designPng(1024, 1280),
    contentType: "image/png",
  }));
  createDesignGeneration.mockImplementation(async (row: object) => ({
    ...row,
    id: `row-${++rowCount}`,
  }));
  updateDesignGeneration.mockResolvedValue(undefined);
  uploadObject.mockResolvedValue(undefined);
  loadBestLogo.mockResolvedValue({ logo: null, fault: null });
  createNotification.mockResolvedValue(undefined);
  checkPlateShowsProduct.mockResolvedValue({ shows: true, seen: "" });
  loadDesignImage.mockResolvedValue({
    bytes: Buffer.from(designPng(1200, 1200)),
    contentType: "image/png",
    width: 1200,
    height: 1200,
  });
  rasterizeDocument.mockImplementation(async (input: { doc: unknown }) => ({
    bytes: designPng(1080, 1350),
    contentType: "image/png",
    width: 1080,
    height: 1350,
    document: input.doc,
    logoFault: null,
    brandFontFault: null,
  }));
});

describe("the upload path", () => {
  it("makes no image-model call and builds both directions on the user's photo", async () => {
    const outcome = await run({ image: { source: "upload", key: UPLOAD_KEY } });

    expect(plateModel.generate).not.toHaveBeenCalled();
    expect(getPlateAdapter).not.toHaveBeenCalled();
    expect(loadDesignImage).toHaveBeenCalledWith(UPLOAD_KEY, BRAND_ID);
    expect(outcome.result).toMatchObject({
      generationIds: ["row-1", "row-2"],
      imageSource: "upload",
    });
    for (const id of ["row-1", "row-2"]) {
      const images = documentOf(id).elements.filter(
        (e: { type: string }) => e.type === "image",
      );
      expect(
        images.map((e: { asset: { key: string } }) => e.asset.key),
      ).toEqual([UPLOAD_KEY]);
    }
  });

  it("writes one row per direction with its rationale and image source", async () => {
    await run({ image: { source: "upload", key: UPLOAD_KEY } });
    expect(createDesignGeneration).toHaveBeenCalledTimes(2);
    const [first, second] = createDesignGeneration.mock.calls.map(([r]) => r);
    for (const [i, row] of [first, second].entries()) {
      expect(row).toMatchObject({
        brandId: BRAND_ID,
        renderer: "composite",
        imageSource: "upload",
        sourceImageKey: UPLOAD_KEY,
        rationale: { slot: i, set: first.rationale.set },
      });
      expect(row.rationale.reasons.length).toBeGreaterThanOrEqual(2);
    }
    expect(first.rationale.title).toBe("Morning bake story");
    expect(first.spec.layout).not.toBe(second.spec.layout);
    expect(updatesFor("row-1")[0]).toMatchObject({
      status: "succeeded",
      imageKey: expect.stringMatching(new RegExp(`^generated/${BRAND_ID}/`)),
      width: 1080,
      height: 1350,
    });
  });

  it("shows zero image calls on the usage row, which is one quota unit", async () => {
    await run({ image: { source: "upload", key: UPLOAD_KEY } });
    expect(recordUsageEvent).toHaveBeenCalledTimes(1);
    expect(recordUsageEvent.mock.calls[0][0]).toMatchObject({
      kind: "design_generated",
      metadata: {
        renderers: ["composite:upload", "composite:upload"],
        imageCalls: 0,
        imageSource: "upload",
        directions: 2,
      },
    });
  });

  it("reports brief, render and checks in order, and no imagery stage", async () => {
    await run({ image: { source: "upload", key: UPLOAD_KEY } });
    expect(stagesSeen()).toEqual(["brief", "render", "checks"]);
    const renders = progress.filter((p) => p.stage === "render");
    expect(renders.at(-1)).toMatchObject({ done: 2, total: 2 });
  });

  it("fails with the user-facing reason and writes nothing when the file is unusable", async () => {
    loadDesignImage.mockRejectedValue(new DesignImageError("not_png_or_jpeg"));
    await expect(
      run({ image: { source: "upload", key: UPLOAD_KEY } }),
    ).rejects.toThrow(/^This image can't be used/);
    expect(generateObject).not.toHaveBeenCalled();
    expect(createDesignGeneration).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
  });

  it("emits design_directions_generated with source, count and faults", async () => {
    await run({ image: { source: "upload", key: UPLOAD_KEY } });
    expect(captureServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "u1",
        event: "design_directions_generated",
        properties: expect.objectContaining({
          source: "upload",
          directions: 2,
          quality_faults: 0,
          image_calls: 0,
        }),
      }),
    );
  });
});

describe("the KO imagery path", () => {
  it("paints exactly one plate per direction and references it by key", async () => {
    await run({ image: { source: "ko" } });
    expect(plateModel.generate).toHaveBeenCalledTimes(2);
    const plateKeys = uploadObject.mock.calls
      .map(([input]) => input.key as string)
      .filter((key) => key.includes("/plates/"));
    expect(plateKeys).toHaveLength(2);
    for (const key of plateKeys) {
      expect(key).toMatch(new RegExp(`^generated/${BRAND_ID}/plates/`));
    }
    const drawn = ["row-1", "row-2"].map(
      (id) =>
        documentOf(id).elements.find(
          (e: { type: string }) => e.type === "image",
        ).asset.key,
    );
    expect(drawn.sort()).toEqual([...plateKeys].sort());
    expect(recordUsageEvent.mock.calls[0][0].metadata).toMatchObject({
      imageCalls: 2,
      renderers: ["composite:bedrock-stability", "composite:bedrock-stability"],
    });
  });

  it("paints each direction from its own scene", async () => {
    await run({ image: { source: "ko" } });
    const prompts = plateModel.generate.mock.calls.map(([i]) => i.prompt);
    expect(prompts[0]).toContain("bakery counter");
    expect(prompts[1]).toContain("cafe table");
  });

  it("reports an imagery stage between the brief and the render", async () => {
    await run({ image: { source: "ko" } });
    expect(stagesSeen()).toEqual(["brief", "imagery", "render", "checks"]);
  });

  it("draws a direction on a flat brand colour when its plate fails", async () => {
    plateModel.generate
      .mockRejectedValueOnce(new Error("throttled"))
      .mockResolvedValue({
        bytes: designPng(1024, 1280),
        contentType: "image/png",
      });
    const outcome = await run({ image: { source: "ko" } });
    expect(outcome.result).toMatchObject({
      generationIds: ["row-1", "row-2"],
    });
    const images = ["row-1", "row-2"].map(
      (id) =>
        documentOf(id).elements.filter(
          (e: { type: string }) => e.type === "image",
        ).length,
    );
    expect(images.sort()).toEqual([0, 1]);
  });

  it("keeps the direction that rendered when the other one fails", async () => {
    rasterizeDocument.mockRejectedValueOnce(new Error("resvg crashed"));
    const outcome = await run({ image: { source: "ko" } });
    expect(
      (outcome.result as { generationIds: string[] }).generationIds,
    ).toHaveLength(1);
    expect(updateDesignGeneration).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("retries the delivered PNG's upload once before losing a rendered direction", async () => {
    let failedOnce = false;
    uploadObject.mockImplementation(async ({ key }: { key: string }) => {
      if (!failedOnce && /^generated\/[^/]+\/[0-9a-f-]+\.png$/.test(key)) {
        failedOnce = true;
        throw new Error("ssl/tls alert bad record mac");
      }
    });
    const outcome = await run({ image: { source: "ko" } });
    expect(
      (outcome.result as { generationIds: string[] }).generationIds,
    ).toHaveLength(2);
  });

  it("fails the job only when no direction rendered", async () => {
    rasterizeDocument.mockRejectedValue(new Error("resvg crashed"));
    await expect(run({ image: { source: "ko" } })).rejects.toThrow(
      "Design generation failed",
    );
    expect(recordUsageEvent).not.toHaveBeenCalled();
  });
});

describe("the product on KO imagery", () => {
  const usage = () => recordUsageEvent.mock.calls[0][0].metadata;

  it("checks each plate against the brief's product", async () => {
    await run({ image: { source: "ko" } });
    expect(checkPlateShowsProduct).toHaveBeenCalledTimes(2);
    expect(checkPlateShowsProduct).toHaveBeenCalledWith(
      expect.objectContaining({ product: "almond croissants" }),
    );
    expect(usage()).toMatchObject({
      imageCalls: 2,
      plateChecks: ["passed", "passed"],
    });
  });

  it("counts the retry as an image call and draws flat after two misses", async () => {
    /* Both plates are checked before either retry: first-round misses for
       both, then one retry passes and the other misses again. */
    checkPlateShowsProduct
      .mockResolvedValueOnce({ shows: false, seen: "a round tart" })
      .mockResolvedValueOnce({ shows: false, seen: "bread rolls" })
      .mockResolvedValueOnce({ shows: true, seen: "" })
      .mockResolvedValue({ shows: false, seen: "bread rolls" });
    await run({ image: { source: "ko" } });
    expect(plateModel.generate).toHaveBeenCalledTimes(4);
    expect(usage().imageCalls).toBe(4);
    expect([...usage().plateChecks].sort()).toEqual([
      "failed",
      "passed-on-retry",
    ]);
    const flat = ["row-1", "row-2"].filter(
      (id) =>
        !documentOf(id).elements.some(
          (e: { type: string }) => e.type === "image",
        ),
    );
    expect(flat).toHaveLength(1);
    expect(usage().qualityFaults).toBeGreaterThanOrEqual(1);
  });

  /* A reason written before the plate was painted cannot promise what the
     plate shows; once the check fails it is not shown. */
  it("drops a reason about the image from a direction drawn flat", async () => {
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({
            rationale: [
              "The photo shows the almond croissants themselves",
              "Leads with the croissant, the product commuters queue for",
              "Speaks to commuters on their way to work",
            ],
          }),
          contrastingDraft(),
        ],
      },
    });
    checkPlateShowsProduct.mockResolvedValue({ shows: false, seen: "a cake" });
    await run({ image: { source: "ko" } });
    const stored = updatesFor("row-1").find((p) => p.rationale)?.rationale;
    expect(stored.reasons).not.toContain(
      "The photo shows the almond croissants themselves",
    );
    expect(stored.reasons.length).toBeGreaterThanOrEqual(2);
    expect(usage().reasonsDropped).toBeGreaterThanOrEqual(1);
  });

  it("keeps the image reason when the check confirmed the plate", async () => {
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({
            rationale: [
              "The photo shows the almond croissants themselves",
              "Leads with the croissant, the product commuters queue for",
            ],
          }),
          contrastingDraft(),
        ],
      },
    });
    await run({ image: { source: "ko" } });
    const stored = updatesFor("row-1").find((p) => p.rationale)?.rationale;
    expect(stored.reasons).toContain(
      "The photo shows the almond croissants themselves",
    );
  });
});

describe("regenerating one direction", () => {
  const target = {
    id: "old-1",
    brandId: BRAND_ID,
    status: "succeeded",
    spec: draftOf({ layout: "hero-center" }),
    rationale: { title: "Morning bake story", reasons: [], set: SET, slot: 0 },
  };
  const sibling = {
    id: "old-2",
    brandId: BRAND_ID,
    status: "succeeded",
    spec: contrastingDraft({ layout: "quote-card" }),
    rationale: {
      title: "Weekend table invitation",
      reasons: [],
      set: SET,
      slot: 1,
    },
  };
  const replacement = draftOf({
    layout: "hero-center",
    title: "Almond gift box",
    headline: "Give a box of almond joy",
    subheadline: "A box of pastries, one ribbon",
    cta: "Pre-order",
    backgroundPrompt: "a ribboned pastry box on linen",
  });

  beforeEach(() => {
    getDesignGenerationById.mockResolvedValue(target);
    listDirectionSet.mockResolvedValue([target, sibling]);
    generateObject.mockResolvedValue({
      object: { directions: [replacement] },
    });
  });

  it("makes exactly one direction in a layout neither existing one uses", async () => {
    const outcome = await run({
      image: { source: "ko" },
      regenerateOf: "old-1",
    });
    expect(createDesignGeneration).toHaveBeenCalledTimes(1);
    const row = createDesignGeneration.mock.calls[0][0];
    expect(["hero-center", "quote-card"]).not.toContain(row.spec.layout);
    expect(row.rationale).toMatchObject({ set: SET, slot: 0 });
    expect(row.imageSource).toBe("ko");
    expect(plateModel.generate).toHaveBeenCalledTimes(1);
    expect(recordUsageEvent).toHaveBeenCalledTimes(1);
    expect(outcome.result).toMatchObject({
      generationIds: ["row-1"],
      regenerateOf: "old-1",
    });
  });

  /* Round-1 regression: with 20+ newer rows in the target's slot the capped
     read lost the sibling, so its layout was no longer avoided. */
  it("avoids the sibling's layout behind 25 newer rows in the same slot", async () => {
    const churn = Array.from({ length: 25 }, (_, i) => ({
      ...target,
      id: `churn-${i}`,
      status: i % 4 === 0 ? "failed" : "succeeded",
      createdAt: new Date(Date.UTC(2026, 9, 21, 10, i)),
    }));
    listDirectionSet.mockResolvedValue([
      ...churn.reverse(),
      { ...sibling, createdAt: new Date(Date.UTC(2026, 9, 21, 9, 0)) },
    ]);
    getDesignGenerationById.mockResolvedValue(churn[0]);
    await run({ image: { source: "ko" }, regenerateOf: "churn-24" });
    const row = createDesignGeneration.mock.calls[0][0];
    expect(["hero-center", "quote-card"]).not.toContain(row.spec.layout);
  });

  it("reads the set within the brand", async () => {
    await run({ image: { source: "ko" }, regenerateOf: "old-1" });
    expect(listDirectionSet).toHaveBeenCalledWith(BRAND_ID, SET);
  });

  it("refuses a design that belongs to another brand, writing nothing", async () => {
    getDesignGenerationById.mockResolvedValue({
      ...target,
      brandId: "22222222-2222-4222-8222-222222222222",
    });
    await expect(
      run({ image: { source: "ko" }, regenerateOf: "old-1" }),
    ).rejects.toBeInstanceOf(RegenerateTargetError);
    expect(createDesignGeneration).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("refuses a variant row, writing nothing", async () => {
    getDesignGenerationById.mockResolvedValue({ ...target, rationale: null });
    await expect(
      run({ image: { source: "ko" }, regenerateOf: "old-1" }),
    ).rejects.toBeInstanceOf(RegenerateTargetError);
    expect(createDesignGeneration).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("needs no image call on the upload path either", async () => {
    await run({
      image: { source: "upload", key: UPLOAD_KEY },
      regenerateOf: "old-1",
    });
    expect(plateModel.generate).not.toHaveBeenCalled();
    expect(createDesignGeneration.mock.calls[0][0].imageSource).toBe("upload");
  });
});

describe("the brand's mark", () => {
  const mark = {
    bytes: designPng(200, 50),
    contentType: "image/png",
    darkest: 0.02,
    lightest: 0.1,
    aspect: 4,
  };

  function withLogo() {
    return generateDirectionsWork(
      {
        context: directionsContext({
          brand: {
            ...(directionsContext() as { brand: object }).brand,
            logoUrl: "https://cdn/logos/b/mark.png",
          },
          logoCandidates: ["https://cdn/logos/b/mark.png"],
        }),
        userId: "u1",
        request: { image: { source: "upload", key: UPLOAD_KEY } },
      },
      runtime as never,
    );
  }

  it("is stored as drawn and named by the document", async () => {
    loadBestLogo.mockResolvedValue({ logo: mark, fault: null });
    await withLogo();
    const markKeys = uploadObject.mock.calls
      .map(([input]) => input.key as string)
      .filter((key) => key.includes("/marks/"));
    expect(new Set(markKeys).size).toBe(1);
    for (const id of ["row-1", "row-2"]) {
      const logo = documentOf(id).elements.find(
        (e: { type: string }) => e.type === "logo",
      );
      expect(logo.asset.key).toBe(markKeys[0]);
    }
  });

  it("loses its corner on the stored spec when it could not be stored", async () => {
    loadBestLogo.mockResolvedValue({ logo: mark, fault: null });
    uploadObject.mockImplementation(async ({ key }: { key: string }) => {
      if (key.includes("/marks/")) throw new Error("R2 down");
    });
    await withLogo();
    for (const id of ["row-1", "row-2"]) {
      const update = updatesFor(id).find((patch) => patch.spec);
      expect(update.spec.logoPlacement).toBe("none");
      expect(
        update.document.elements.some(
          (e: { type: string }) => e.type === "logo",
        ),
      ).toBe(false);
    }
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          message: expect.stringContaining(
            "could not be saved alongside the design",
          ),
        },
      }),
    );
  });
});

describe("generateDesignWork", () => {
  it("takes the directions path when the request carries an image", async () => {
    const { generateDesignWork } = await import("./run-design-generation");
    const outcome = await generateDesignWork(
      {
        context: directionsContext(),
        userId: "u1",
        directions: { image: { source: "upload", key: UPLOAD_KEY } },
      },
      runtime as never,
    );
    expect(outcome.result).toMatchObject({ imageSource: "upload" });
    expect(createDesignGeneration).toHaveBeenCalledTimes(2);
  });
});

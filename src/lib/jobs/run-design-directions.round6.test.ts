// @vitest-environment node
/* Round-5 critics' job probes (code K1 to K14, live findings), each now a
   regression test on the round-4 harness: the real builders, layout
   choice, fact coverage and a gate double that applies a correction as
   guardRender does. */
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

const readBrief = vi.fn();
vi.mock("ai", async () => {
  const { isBriefReadCall } = await import("./directions/fixtures");
  return {
    generateObject: (o: unknown) =>
      isBriefReadCall(o) ? readBrief(o) : generateObject(o),
  };
});
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));
vi.mock("@/lib/ai/image", () => ({
  getPlateAdapter: () => getPlateAdapter(),
  getNativeAdapters: () => [],
}));
vi.mock("@/lib/ai/memory", () => ({ buildMemoryBlock: async () => "" }));
const claimDirectionLayout = vi.fn();
vi.mock("@/lib/db/queries", () => ({
  claimDirectionLayout: (input: unknown) => claimDirectionLayout(input),
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
vi.mock("@/lib/design/document/rasterize", async (importOriginal) => ({
  DocumentAssetError: (
    await importOriginal<typeof import("@/lib/design/document/rasterize")>()
  ).DocumentAssetError,
  rasterizeDocument: (input: unknown) => rasterizeDocument(input),
  prepareDocumentFonts: async () => ({ fonts: [], fault: null }),
}));
vi.mock("@/lib/design/document/measure", async () => {
  const { monospaceMeasurer } = await import("@/lib/design/document/fixtures");
  return { createRendererMeasurer: () => monospaceMeasurer() };
});
/* Off by default: the real builders decide. On, every build reports the
   subject covered, the case no layout can fix. */
let forceCovered = false;
vi.mock("@/lib/design/document/from-spec", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/design/document/from-spec")>();
  const { SUBJECT_COVERED } = await import("@/lib/design/document/subject");
  return {
    ...real,
    documentFromSpec: async (
      input: Parameters<typeof real.documentFromSpec>[0],
    ) => {
      const built = await real.documentFromSpec(input);
      /* Emulates the builder fault subject-fault.test.ts documents: it
         reports only "cropped" while the headline sits on the subject. */
      if (
        overlapHeadline &&
        input.image &&
        input.subject &&
        (input.spec as { headline: string }).headline === overlapHeadline
      ) {
        const { SUBJECT_CROPPED } = await import(
          "@/lib/design/document/subject"
        );
        const sb = input.subject;
        return {
          ...built,
          subjectFault: SUBJECT_CROPPED,
          document: {
            ...built.document,
            elements: built.document.elements.map((e) =>
              e.type === "text" && (e as { role?: string }).role === "headline"
                ? (() => {
                    const img = built.document.elements.find(
                      (x) => x.type === "image",
                    ) as {
                      x: number;
                      y: number;
                      width: number;
                      height: number;
                    };
                    return {
                      ...e,
                      x: img.x + img.width * (sb.x + sb.w / 4),
                      y: img.y + img.height * (sb.y + sb.h / 3),
                      width: (img.width * sb.w) / 2,
                      height: 60,
                    };
                  })()
                : e,
            ),
          },
        };
      }
      if (input.image && input.subject && input.subject.w >= coverWholeWider) {
        const { SUBJECT_COVERED } = await import(
          "@/lib/design/document/subject"
        );
        return { ...built, subjectFault: SUBJECT_COVERED };
      }
      return forceCovered && input.image
        ? { ...built, subjectFault: SUBJECT_COVERED }
        : built;
    },
  };
});
const loadBestLogo = vi.fn();
const createNotification = vi.fn();
const checkPlateShowsProduct = vi.fn();
const lookAtPhoto = vi.fn();
vi.mock("@/lib/design/quality/plate-check", () => ({
  checkPlateShowsProduct: (input: unknown) => checkPlateShowsProduct(input),
  lookAtPhoto: (bytes: unknown) => lookAtPhoto(bytes),
}));
vi.mock("@/lib/design/render/logo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBestLogo: (args: unknown) => loadBestLogo(args),
}));

let correctWith:
  | ((spec: Record<string, unknown>) => Record<string, unknown> | null)
  | null = null;
let overlapHeadline: string | null = null;
let coverWholeWider = 2;
vi.mock("@/lib/jobs/design-gate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/jobs/design-gate")>();
  return {
    ...real,
    guardRender: async (
      render: (s: unknown) => Promise<Record<string, unknown>>,
      spec: Record<string, unknown>,
      opts: {
        acceptCorrection: (s: unknown) => boolean | Promise<boolean>;
        refuseSecond?: (r: unknown) => boolean;
        onFirstRender?: () => void;
      },
    ) => {
      const first = await render(spec);
      opts.onFirstRender?.();
      const corrected = correctWith ? correctWith(spec) : null;
      if (!corrected) return { ...first, spec };
      if (!(await opts.acceptCorrection(corrected)))
        return {
          ...first,
          spec,
          fault: "correction refused",
          correction: "probe correction",
        };
      const second = await render(corrected);
      if (opts.refuseSecond?.(second))
        return {
          ...first,
          spec,
          fault: "second render refused",
          correction: "probe correction",
        };
      return {
        ...second,
        spec: corrected,
        correction: "probe correction",
        correctionKept: true,
      };
    },
  };
});

const { generateDirectionsWork } = await import("./run-design-directions");
const {
  BRAND_ID,
  contrastingDraft,
  designPng,
  directionsContext,
  draftOf,
  readAnswer,
} = await import("./directions/fixtures");

const UPLOAD_KEY = `design-images/${BRAND_ID}/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.png`;
const SET = "9c0e8f5a-3b2d-4c1e-8f7a-6d5c4b3a2f10";
const UPLOADED_PHOTO = await photo(600, 600);
const PLATE_PHOTO = await photo(256, 320);

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
const claimed = new Map<string, Record<string, unknown>>();

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

const updatesFor = (id: string) =>
  updateDesignGeneration.mock.calls
    .filter(([rowId]) => rowId === id)
    .map(([, patch]) => patch);

beforeEach(() => {
  vi.clearAllMocks();
  readBrief.mockResolvedValue({
    object: { facts: [], offering: { kind: "none", phrase: "" }, people: [] },
  });
  forceCovered = false;
  progress.length = 0;
  rowCount = 0;
  generateObject.mockResolvedValue({
    object: { directions: [draftOf(), contrastingDraft()] },
  });
  getPlateAdapter.mockReturnValue(plateModel);
  plateModel.generate.mockImplementation(async () => ({
    bytes: PLATE_PHOTO,
    contentType: "image/png",
  }));
  claimed.clear();
  createDesignGeneration.mockImplementation(async (row: object) => {
    const created = { ...row, id: `row-${++rowCount}` };
    claimed.set(created.id, created);
    return created;
  });
  updateDesignGeneration.mockResolvedValue(undefined);
  uploadObject.mockResolvedValue(undefined);
  loadBestLogo.mockResolvedValue({ logo: null, fault: null });
  createNotification.mockResolvedValue(undefined);
  checkPlateShowsProduct.mockResolvedValue({
    shows: true,
    seen: "",
    subject: null,
    items: [],
    lettering: false,
  });
  lookAtPhoto.mockResolvedValue(null);
  const createdRows = () =>
    createDesignGeneration.mock.results.map((_r, n) => ({
      status: "pending",
      createdAt: new Date(Date.now() - 1000 + n),
      ...claimed.get(`row-${n + 1}`),
    }));
  listDirectionSet.mockImplementation(async () => createdRows());
  claimDirectionLayout.mockImplementation(
    async ({
      rowId,
      spec,
      isFree,
    }: {
      rowId: string;
      spec: unknown;
      isFree: (rows: unknown[]) => boolean;
    }) => {
      const stored = ((await listDirectionSet(BRAND_ID, SET)) ?? []).map(
        (r: { createdAt?: Date }) => ({ createdAt: new Date(0), ...r }),
      );
      const created = createdRows();
      const rows = [
        ...stored.filter(
          (r: { id?: string }) =>
            !created.some((c) => (c as { id?: string }).id === r.id),
        ),
        ...created,
      ];
      if (!isFree(rows)) return false;
      claimed.set(rowId, { ...claimed.get(rowId), spec });
      return true;
    },
  );
  loadDesignImage.mockResolvedValue({
    bytes: Buffer.from(UPLOADED_PHOTO),
    contentType: "image/png",
    width: 600,
    height: 600,
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

/* A real photograph-like PNG: measureImage has to decode it for the subject
   rule to place anything. */
async function photo(width: number, height: number): Promise<Uint8Array> {
  const { encodePngRgba } = await import("@/lib/images/png-pixels");
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = 200 - (i % width) / 4;
    pixels[i * 4 + 1] = 140;
    pixels[i * 4 + 2] = 90 + Math.floor(i / width) / 6;
    pixels[i * 4 + 3] = 255;
  }
  return encodePngRgba({ width, height, pixels });
}

const usage = () => recordUsageEvent.mock.calls[0]?.[0]?.metadata;
const delivered = (id: string) =>
  updatesFor(id).find((p) => p.status === "succeeded");

beforeEach(() => {
  correctWith = null;
  overlapHeadline = null;
  coverWholeWider = 2;
});

function runBrief(briefText: string, request: Record<string, unknown>) {
  return generateDirectionsWork(
    {
      context: directionsContext({ briefText }),
      userId: "u1",
      sessionId: "s1",
      request: request as never,
    },
    runtime as never,
  );
}

const drawnOf = (id: string) => {
  const spec = delivered(id)?.spec;
  return [
    spec?.headline,
    spec?.subheadline,
    spec?.cta,
    ...(spec?.footerLines ?? []),
  ]
    .filter(Boolean)
    .join("\n");
};

const { EmojiBudgetError } = await import("@/lib/design/render/satori-pool");
const { readImageDimensions } = await import("@/lib/design/png-dimensions");
const { default: sharp } = await import("sharp");

const notified = () =>
  createNotification.mock.calls.map(
    ([input]) => (input as { payload: { message: string } }).payload.message,
  );

describe("round-5 critic job probes", () => {
  /* K1: a phone read in other words was dropped, and the metrics said every
     fact was delivered. A reading that is not the brief's words is never
     drawn, but a design that does not state it is recorded as leaving it
     off. */
  it("records a fact the reader could not place, on every direction", async () => {
    readBrief.mockResolvedValue(
      readAnswer([
        { kind: "price", text: "₦4,500 a box" },
        { kind: "date", text: "Friday, December 5th" },
      ]),
    );
    await runBrief(
      "Almond croissants, ₦4,500 a box. Pickup on the 5th of December, a Friday.",
      { image: { source: "upload", key: UPLOAD_KEY } },
    );
    const m = usage();
    expect(m.briefRead.unread).toEqual(["Friday, December 5th"]);
    expect(m.factsLeftOff).toEqual([
      expect.objectContaining({ direction: 0, fact: "Friday, December 5th" }),
      expect.objectContaining({ direction: 1, fact: "Friday, December 5th" }),
    ]);
    expect(m.briefFacts).toBe(2);
    expect(m.briefFactsDelivered).toBe(1);
    expect(m.qualityFaults).toBe(2);
  });

  /* K3, E1, E2: the reader omitted the phone. */
  it("draws the brief's phone the reader missed, and counts it", async () => {
    readBrief.mockResolvedValue(
      readAnswer([{ kind: "price", text: "₦4,500 a box" }]),
    );
    await runBrief(
      "Almond croissants, ₦4,500 a box. WhatsApp 0803 555 0142 to reserve.",
      { image: { source: "upload", key: UPLOAD_KEY } },
    );
    const m = usage();
    expect(m.briefRead.phonesAdded).toEqual(["WhatsApp 0803 555 0142"]);
    expect(m.briefFacts).toBe(2);
    expect(m.briefFactsByDirection).toEqual([2, 2]);
    expect(m.factsLeftOff).toEqual([]);
    for (const id of ["row-1", "row-2"]) {
      expect(drawnOf(id)).toContain("0803 555 0142");
    }
  });

  /* K5: Bedrock 503 on every plate. */
  it("says the image model was down, not that its plates were wrong", async () => {
    plateModel.generate.mockRejectedValue(new Error("Bedrock 503"));
    await run({ image: { source: "ko" } });
    const m = usage();
    expect(m.plateChecks).toEqual(["unavailable", "unavailable"]);
    expect(m.textLed).toBe(2);
    expect(m.textLedImageModelDown).toBe(2);
    expect(notified()).toEqual([
      expect.stringMatching(
        /^Both directions were laid out with words only: KO's image service didn't return an image just now/,
      ),
    ]);
    expect(notified()[0]).not.toMatch(/wrong thing|made-up writing/);
    expect(captureServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "design_directions_generated",
        properties: expect.objectContaining({
          text_led: 2,
          text_led_image_model_down: 2,
        }),
      }),
    );
  });

  /* Live: event s1 never named the speaker, and coverage reported 8/8. */
  it("names the speaker the brief names on every direction", async () => {
    readBrief.mockResolvedValue(
      readAnswer(
        [{ kind: "price", text: "₦35,000 a seat" }],
        { kind: "event", phrase: "lamination masterclass" },
        ["Tunde Okafor"],
      ),
    );
    await runBrief(
      "Lamination masterclass with head baker Tunde Okafor, ₦35,000 a seat.",
      { image: { source: "upload", key: UPLOAD_KEY } },
    );
    const m = usage();
    expect(m.briefFacts).toBe(2);
    expect(m.briefFactsByDirection).toEqual([2, 2]);
    for (const id of ["row-1", "row-2"]) {
      expect(drawnOf(id)).toMatch(/Tunde Okafor/);
    }
  });

  /* Layer document unit: an image model's 4K plate is past the 4096 px
     rasterizeDocument draws. */
  it("fits a 4K plate before the renderer sees it", async () => {
    const big = new Uint8Array(
      await sharp({
        create: { width: 3072, height: 5504, channels: 3, background: "#b85" },
      })
        .png()
        .toBuffer(),
    );
    plateModel.generate.mockResolvedValue({
      bytes: big,
      contentType: "image/png",
    });
    await run({ image: { source: "ko" } });
    const drawn = rasterizeDocument.mock.calls.flatMap(([input]) =>
      Object.entries(
        (input as { assets: Record<string, { bytes: Uint8Array }> }).assets,
      ).filter(([key]) => key.includes("/plates/")),
    );
    expect(drawn.length).toBeGreaterThan(0);
    for (const [, asset] of drawn) {
      const size = readImageDimensions(asset.bytes);
      expect(Math.max(size?.width ?? 0, size?.height ?? 0)).toBe(2560);
    }
    expect(usage().plateChecks).toEqual(["passed", "passed"]);
  });

  /* Layer document unit: the render worker refuses copy with too many
     emoji. It is not retried, not blamed on the logo, and the user is told
     what to change. */
  it("fails a direction the worker refuses for its emoji, saying why", async () => {
    rasterizeDocument.mockRejectedValue(new EmojiBudgetError(16));
    await expect(
      run({ image: { source: "upload", key: UPLOAD_KEY } }),
    ).rejects.toThrow(
      "This design can't be drawn: the design has more than 16 different emoji to draw; use fewer, then try again.",
    );
    expect(rasterizeDocument).toHaveBeenCalledTimes(2);
    for (const id of ["row-1", "row-2"]) {
      expect(updatesFor(id)).toContainEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.stringMatching(/more than 16 different emoji/),
        }),
      );
    }
    expect(notified().join(" ")).not.toMatch(/logo|font/i);
  });

  /* K14: a gate correction to "Livraison gratuite à Lekki" was kept. */
  it("refuses a correction in another language that drops the product", async () => {
    readBrief.mockResolvedValue(
      readAnswer([], { kind: "product", phrase: "almond croissants" }),
    );
    correctWith = (spec) => ({
      ...spec,
      headline: "Livraison gratuite à Lekki",
    });
    await run({ image: { source: "ko" } });
    const m = usage();
    expect(m.correctionsKept).toBe(0);
    for (const id of ["row-1", "row-2"]) {
      expect(delivered(id)?.spec.headline).not.toMatch(/Livraison/);
    }
  });

  /* Round-5 live critic: never deliver a subject fault. A KO plate no
     layout shows whole and clear is left off, and the direction is laid
     out as text, rather than delivered cut or failed outright. */
  it("lays a KO direction out as text when no layout shows its plate whole", async () => {
    coverWholeWider = 0.85;
    checkPlateShowsProduct.mockResolvedValue({
      shows: true,
      seen: "almond croissants",
      subject: { x: 0.04, y: 0.05, w: 0.92, h: 0.9 },
      items: [],
      lettering: false,
      person: false,
    });
    await run({ image: { source: "ko" } });
    const m = usage();
    expect(m.textLed).toBe(2);
    expect(m.qualityFaults).toBe(2);
    const { TEXT_LED_LAYOUTS } = await import("./directions/subject-layout");
    for (const id of ["row-1", "row-2"]) {
      const doc = delivered(id)?.document as {
        elements: { type: string }[];
      };
      expect(doc.elements.some((e) => e.type === "image")).toBe(false);
      expect(TEXT_LED_LAYOUTS).toContain(delivered(id)?.spec.layout);
    }
    expect(notified()[0]).toMatch(/left no room to show the subject whole/);
  });

  /* A regenerate of one direction on an upload made one row, so it never
     kept apart from the sibling drawing the same photo. */
  it("keeps a regenerated upload direction apart from its sibling's photo", async () => {
    lookAtPhoto.mockResolvedValue({
      description: "a cup on a bar",
      subject: { x: 0.4, y: 0.35, w: 0.2, h: 0.25 },
      face: null,
      items: ["a cup"],
    });
    const SIBLING_DOC = {
      width: 1080,
      height: 1350,
      elements: [
        { id: "image", type: "image", x: 0, y: 0, width: 540, height: 1350 },
        {
          id: "headline",
          type: "text",
          role: "headline",
          x: 600,
          y: 400,
          width: 400,
          height: 200,
        },
      ],
    };
    const target = {
      id: "old-1",
      brandId: BRAND_ID,
      status: "succeeded",
      spec: draftOf({ layout: "quote-card" }),
      rationale: { title: "Morning", reasons: [], set: SET, slot: 0 },
      createdAt: new Date(0),
    };
    const sibling = {
      ...target,
      id: "old-2",
      spec: contrastingDraft({ layout: "banner-bottom" }),
      rationale: { title: "Weekend", reasons: [], set: SET, slot: 1 },
      sourceImageKey: UPLOAD_KEY,
      document: SIBLING_DOC,
    };
    getDesignGenerationById.mockImplementation(async (id: string) =>
      id === "old-2" ? sibling : target,
    );
    listDirectionSet.mockResolvedValue([target, sibling]);
    generateObject.mockResolvedValue({
      object: { directions: [draftOf({ layout: "split-left" })] },
    });
    await run({
      image: { source: "upload", key: UPLOAD_KEY },
      regenerateOf: "old-1",
    });
    expect(getDesignGenerationById).toHaveBeenCalledWith("old-2");
    const { photoPlace } = await import("./directions/render");
    const { SAME_SHAPE_AS_SIBLING } = await import(
      "./directions/subject-layout"
    );
    const place = photoPlace(delivered("row-1")?.document);
    const faults = usage().subjectFaults as (string | null)[];
    expect(
      place?.arrangement !== "beside" || faults.includes(SAME_SHAPE_AS_SIBLING),
    ).toBe(true);
  });
});

describe("round 6c: object-free scenes", () => {
  /* Round-6 eval at 8cc381c: a scene's subject box was the whole room, so
     every layout covered it and seven plates were left off. */
  it("draws a scene plate as a backdrop with no subject to keep clear", async () => {
    readBrief.mockResolvedValue(
      readAnswer([], { kind: "service", phrase: "laundry pickup" }),
    );
    checkPlateShowsProduct.mockResolvedValue({
      shows: true,
      seen: "an empty courtyard",
      subject: { x: 0.02, y: 0.02, w: 0.96, h: 0.96 },
      items: [],
      lettering: false,
      person: false,
    });
    await runBrief("Same-day laundry pickup across Lekki.", {
      image: { source: "ko" },
    });
    const m = usage();
    expect(m.plateChecks).toEqual(["scene", "scene"]);
    expect(m.textLed).toBe(0);
    expect(m.subjectKnown).toEqual([false, false]);
    for (const [input] of plateModel.generate.mock.calls) {
      expect(input.prompt).toMatch(
        /^A soft-focus, close-up photograph of light and texture that suits the /,
      );
    }
  });
});

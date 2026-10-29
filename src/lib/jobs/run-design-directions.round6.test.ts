// @vitest-environment node
/* Round-5 critics' job probes (code K1 to K14, live findings), each now a
   regression test on the round-4 harness: the real builders, layout
   choice, fact coverage and a gate double that applies a correction as
   guardRender does. */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* The KO path runs behind FEATURE_KO_IMAGERY (round 8); its tests run with
   the flag on. */
process.env.FEATURE_KO_IMAGERY = "1";

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
  const { fakeFactWrite, isBriefReadCall, isClaimCheckCall, isFactWriteCall } =
    await import("./directions/fixtures");
  return {
    generateObject: (o: unknown) =>
      isBriefReadCall(o)
        ? readBrief(o)
        : isFactWriteCall(o) &&
            !(globalThis as { factWriteThroughDouble?: boolean })
              .factWriteThroughDouble
          ? fakeFactWrite(o)
          : isClaimCheckCall(o) &&
              !(globalThis as { claimCheckThroughDouble?: boolean })
                .claimCheckThroughDouble
            ? { object: { unsupported: [] } }
            : generateObject(o),
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
/* When set, the photo fits this layout alone: every other build with the
   image reports it covered. */
let fitsOnly: string | null = null;
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
      layoutOfDocument.set(
        built.document,
        (input.spec as { layout: string }).layout,
      );
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
      if (
        fitsOnly &&
        input.image &&
        (input.spec as { layout: string }).layout !== fitsOnly
      ) {
        return { ...built, subjectFault: SUBJECT_COVERED };
      }
      return forceCovered && input.image
        ? { ...built, subjectFault: SUBJECT_COVERED }
        : built;
    },
  };
});
/* The live fonts measure craft faults the monospace double does not:
   a layout named here is judged with this soft fault, as the live
   measurement judged it (round 22, the cafe pair). */
let softOn: Record<string, string> = {};
const layoutOfDocument = new WeakMap<object, string>();
vi.mock("./directions/craft", async (importOriginal) => {
  const real = await importOriginal<typeof import("./directions/craft")>();
  return {
    ...real,
    layoutCraftFaults: (...args: Parameters<typeof real.layoutCraftFaults>) => {
      const faults = real.layoutCraftFaults(...args);
      const layout = layoutOfDocument.get(args[0] as object);
      const soft = layout ? softOn[layout] : undefined;
      return soft && !faults.soft ? { ...faults, soft } : faults;
    },
  };
});
/* When set, every choice made apart from a sibling's photo reports it in
   the same shape (round 21: the ruling of 2026-10-28 keeps the photo). */
let forceSameShape = false;
/* Every layout choice the job made, to read what each layout carried. */
const choicesMade: Awaited<
  ReturnType<typeof import("./directions/subject-layout").chooseLayout>
>[] = [];
vi.mock("./directions/subject-layout", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("./directions/subject-layout")>();
  return {
    ...real,
    chooseLayout: async (input: Parameters<typeof real.chooseLayout>[0]) => {
      const choice = await real.chooseLayout(input);
      choicesMade.push(choice);
      return forceSameShape && input.apartFrom && !input.imageless
        ? {
            ...choice,
            faults: [...choice.faults, real.SAME_SHAPE_AS_SIBLING],
            fault: choice.fault ?? real.SAME_SHAPE_AS_SIBLING,
          }
        : choice;
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

const { DateOnWrongDayError, generateDirectionsWork } = await import(
  "./run-design-directions"
);
const { footerLinesFor } = await import("@/lib/design/render/footer");
const {
  BRAND_ID,
  contrastingDraft,
  designPng,
  directionsContext,
  draftOf,
  readAnswer,
} = await import("./directions/fixtures");
const { EVAL_A_BA7A7EA } = await import("./directions/fixtures.ba7a7ea");

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
const failedRow = (id: string) =>
  updatesFor(id).find((p) => p.status === "failed");

beforeEach(() => {
  softOn = {};
  fitsOnly = null;
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
    /* The offering's name, the price and the speaker (round 7). */
    expect(m.briefFacts).toBe(3);
    expect(m.briefFactsByDirection).toEqual([3, 3]);
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

/* Round-6 code critic's job probes K15 and K16: a drop decided by a rule
   that counted a fact stated when the design no longer carried it. */
describe("round-6 critic job probes", () => {
  it("K15: a count above never makes the footer price a repeat", async () => {
    readBrief.mockResolvedValue(
      readAnswer(
        [
          { kind: "quantity", text: "2,000 happy customers" },
          { kind: "price", text: "₦2,000 each" },
          { kind: "contact", text: "WhatsApp 0803 555 0142" },
        ],
        { kind: "product", phrase: "chin chin jars" },
      ),
    );
    const footerLines = ["₦2,000 each · WhatsApp 0803 555 0142"];
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({
            headline: "2,000 happy customers can't be wrong",
            subheadline: "Crunchy chin chin jars, fried fresh.",
            footerLines,
            footerStyle: "text",
          }),
          contrastingDraft({
            headline: "Join 2,000 happy customers",
            subheadline: "Our chin chin jars, fried fresh.",
            footerLines,
            footerStyle: "text",
          }),
        ],
      },
    });
    await runBrief(
      "Join 2,000 happy customers. Chin chin jars ₦2,000 each. WhatsApp 0803 555 0142.",
      { image: { source: "upload", key: UPLOAD_KEY } },
    );
    for (const id of ["row-1", "row-2"]) {
      expect(drawnOf(id)).toContain("₦2,000 each");
    }
    expect(usage().factsLeftOff).toEqual([]);
  });

  it("K16: three places in four never drops the offer", async () => {
    readBrief.mockResolvedValue(
      readAnswer(
        [
          { kind: "offer", text: "Free delivery to Lekki, Ajah and Ikoyi" },
          { kind: "price", text: "₦15,000" },
        ],
        { kind: "product", phrase: "cakes" },
      ),
    );
    const footerLines = ["Free delivery to Lekki, Ajah and Ikoyi"];
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({
            headline: "Cakes at your door",
            subheadline: "₦15,000 cakes with free delivery in Lekki and Ajah.",
            footerLines,
            footerStyle: "text",
          }),
          contrastingDraft({
            subheadline: "₦15,000 cakes. Free delivery in Lekki and Ajah.",
            footerLines,
            footerStyle: "text",
          }),
        ],
      },
    });
    await runBrief(
      "Cakes ₦15,000. Free delivery to Lekki, Ajah and Ikoyi this week.",
      { image: { source: "upload", key: UPLOAD_KEY } },
    );
    for (const id of ["row-1", "row-2"]) {
      expect(drawnOf(id)).toContain("Ikoyi");
    }
  });
});

/* Oluwaseyi's ruling, round 7: a photo that fits one layout, which its
   sibling takes, leaves the second direction laid out as text, so the
   client always gets two (round-6 live critic: a 16:9 portrait delivered
   one direction of two). */
/* Round 21, round-8 live critic finding 3 and Oluwaseyi's ruling of
   2026-10-28 (superseding 2026-10-26): a second upload direction whose only
   free layouts show the photo in its sibling's shape still shows it. */
describe("an upload whose second direction shares its sibling's shape", () => {
  it("keeps the photo in both directions and records the shared shape", async () => {
    forceSameShape = true;
    try {
      lookAtPhoto.mockResolvedValue({
        description: "a strawberry mille-feuille",
        subject: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
        face: null,
        heads: [],
        items: ["a pastry"],
      });
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({ layout: "banner-bottom" }),
            contrastingDraft({ layout: "hero-center" }),
          ],
        },
      });
      await run({ image: { source: "upload", key: UPLOAD_KEY } });
    } finally {
      forceSameShape = false;
    }
    for (const id of ["row-1", "row-2"]) {
      const doc = delivered(id)?.document as
        | { elements: { type: string }[] }
        | undefined;
      expect(doc?.elements.some((e) => e.type === "image")).toBe(true);
    }
    expect(usage().textLedUpload).toBe(0);
    expect(notified()).not.toContainEqual(
      expect.stringContaining("laid out with words only"),
    );
  });
});

describe("an upload that fits one layout", () => {
  it("delivers the second direction laid out as text", async () => {
    fitsOnly = "split-left";
    lookAtPhoto.mockResolvedValue({
      description: "a woman in a green coat",
      subject: { x: 0.3, y: 0.05, w: 0.4, h: 0.9 },
      face: null,
      items: ["a coat"],
    });
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({ layout: "split-left" }),
          contrastingDraft({ layout: "banner-bottom" }),
        ],
      },
    });
    await run({ image: { source: "upload", key: UPLOAD_KEY } });
    const docs = ["row-1", "row-2"].map(
      (id) =>
        delivered(id)?.document as { elements: { type: string }[] } | undefined,
    );
    expect(docs.every(Boolean)).toBe(true);
    const withPhoto = docs.map((d) =>
      Boolean(d?.elements.some((e) => e.type === "image")),
    );
    expect(withPhoto.filter(Boolean)).toHaveLength(1);
    const { TEXT_LED_LAYOUTS } = await import("./directions/subject-layout");
    const textLed = ["row-1", "row-2"][withPhoto.indexOf(false)];
    expect(TEXT_LED_LAYOUTS).toContain(delivered(textLed)?.spec.layout);
    expect(notified()).toContain(
      "One direction was laid out with words only: your photo couldn't be shown whole in any other layout at this size, so only the other direction shows it. Try another size, or upload a photo with more room around the subject.",
    );
  });
});

/* Round-7 live critic: slot 0 of a 16:9 portrait failed with
   SubjectFaultError while slot 1 held the one layout that fits; one run in
   two. Round 8 makes it deterministic: repeated draws all deliver two. */
describe("an upload whose only fitting layout the sibling holds", () => {
  it("delivers both directions on every draw, the first laid out as text", async () => {
    for (let draw = 0; draw < 5; draw += 1) {
      vi.clearAllMocks();
      rowCount = 0;
      claimed.clear();
      fitsOnly = "split-left";
      lookAtPhoto.mockResolvedValue({
        description: "a woman in a green robe",
        subject: { x: 0.3, y: 0.05, w: 0.4, h: 0.9 },
        face: null,
        items: ["a robe"],
      });
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({ layout: "hero-center" }),
            contrastingDraft({ layout: "split-left" }),
          ],
        },
      });
      await run({ image: { source: "upload", key: UPLOAD_KEY } });
      const docs = ["row-1", "row-2"].map(
        (id) =>
          delivered(id)?.document as
            | { elements: { type: string }[] }
            | undefined,
      );
      expect(docs.every(Boolean)).toBe(true);
    }
  });
});

describe("KO imagery behind FEATURE_KO_IMAGERY (round 8)", () => {
  it("refuses a KO request with the flag off: no rows, no image calls", async () => {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await expect(run({ image: { source: "ko" } })).rejects.toThrow(
        /KO-generated images are not available yet/,
      );
      expect(createDesignGeneration).not.toHaveBeenCalled();
      expect(plateModel.generate).not.toHaveBeenCalled();
      expect(generateObject).not.toHaveBeenCalled();
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  });

  it("lays out a no-photo request as text, with no image calls", async () => {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await run({ image: { source: "none" } });
      expect(plateModel.generate).not.toHaveBeenCalled();
      const { TEXT_LED_LAYOUTS } = await import("./directions/subject-layout");
      for (const id of ["row-1", "row-2"]) {
        const doc = delivered(id)?.document as {
          elements: { type: string }[];
        };
        expect(doc.elements.some((e) => e.type === "image")).toBe(false);
        expect(TEXT_LED_LAYOUTS).toContain(delivered(id)?.spec.layout);
      }
      expect(usage().imageCalls).toBe(0);
      /* Round-8 code critic: a text-led row was stored and costed as an
         upload. */
      for (const [row] of createDesignGeneration.mock.calls) {
        expect(row).toMatchObject({
          imageSource: "none",
          provider: "none",
          model: "none",
        });
      }
      expect(usage().renderers).toEqual(["composite:none", "composite:none"]);
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  });
});

/* Round-7 code critic, K17: "Doors open 8pm" counted the age "Ages 8+"
   stated, so the writer was never asked and the metrics said 4 of 4. */
describe("round-7 critic job probes", () => {
  it("K17: an age the design never prints is written in, never counted from a door time", async () => {
    readBrief.mockResolvedValue(
      readAnswer(
        [
          { kind: "day", text: "this Friday" },
          { kind: "time", text: "8pm" },
          { kind: "age", text: "Ages 8+" },
        ],
        { kind: "event", phrase: "Family movie night" },
      ),
    );
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({
            headline: "Family movie night",
            subheadline: "This Friday, doors open 8pm.",
            footerLines: [],
          }),
          contrastingDraft({
            headline: "Popcorn, blankets, Friday",
            subheadline: "Family movie night this Friday. Doors open 8pm.",
            footerLines: [],
          }),
        ],
      },
    });
    await runBrief("Family movie night this Friday, doors open 8pm. Ages 8+.", {
      image: { source: "none" },
    });
    for (const id of ["row-1", "row-2"]) {
      expect(drawnOf(id)).toContain("Ages 8+");
    }
    expect(usage().factsAdded).toBeGreaterThanOrEqual(2);
  });
});

/* Round-8 code critic, job probes J1 and J3 (r8-job-probes.log), on the
   PR 1 default path: the flag off and no photo. */
describe("round-8 critic job probes", () => {
  it("J1: an age the design never prints is written in, never counted from '8+ flavours'", async () => {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      readBrief.mockResolvedValue(
        readAnswer(
          [
            { kind: "day", text: "this Saturday" },
            { kind: "age", text: "Ages 8+" },
          ],
          { kind: "event", phrase: "ice cream social" },
        ),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Ice cream social",
              subheadline: "This Saturday, 8+ flavours to try.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Scoops this Saturday",
              subheadline: "Our ice cream social is back with 8+ flavours.",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Ice cream social this Saturday with 8+ flavours. Ages 8+.",
        { image: { source: "none" } },
      );
      for (const id of ["row-1", "row-2"]) {
        expect(drawnOf(id)).toMatch(/ages 8\+/i);
      }
      expect(usage().factsAdded).toBeGreaterThanOrEqual(2);
      expect(usage().factsLeftOff).toEqual([]);
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  });

  /* Break 3: with the fit pass down, the brief's internal title was drawn
     as the headline. The fit pass is asked once more; when it is still
     down the direction fails with a message, and its sibling ships. */
  it("J3: with the fit pass down, fails the direction rather than draw code's headline", async () => {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      const fitCalls: string[] = [];
      generateObject.mockImplementation(async (o: { prompt?: string }) => {
        const prompt = typeof o.prompt === "string" ? o.prompt : "";
        if (prompt.startsWith("Some fields you wrote")) {
          fitCalls.push(prompt);
          throw new Error("model timeout");
        }
        return {
          object: {
            directions: [
              draftOf({ headline: "Loved by 500 Lagos commuters" }),
              contrastingDraft(),
            ],
          },
        };
      });
      await runBrief(
        "Promote our almond croissants to commuters before work.",
        { image: { source: "none" } },
      );
      expect(fitCalls).toHaveLength(2);
      expect(delivered("row-1")).toBeUndefined();
      expect(updatesFor("row-1")).toContainEqual({
        status: "failed",
        error:
          "We couldn't write a headline for this design that keeps to your brief. Regenerate it to try again, or add more detail to the brief.",
      });
      expect(delivered("row-2")?.spec.headline).toBe("Your table is waiting");
      const drawn = updatesFor("row-1").map((p) => p.spec?.headline);
      for (const code of ["Croissant launch", "Product", "Design direction"]) {
        expect(drawn).not.toContain(code);
      }
      expect(usage().headlinesLost).toBe(1);
      expect(captureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "design_directions_generated",
          properties: expect.objectContaining({
            source: "none",
            headlines_lost: 1,
            text_led_upload: 0,
          }),
        }),
      );
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  });

  /* Round-8 code critic: the failed-status write was swallowed, and a row
     left pending holds its layout for 15 minutes. */
  it("logs a failed direction it could not mark failed", async () => {
    process.env.FEATURE_KO_IMAGERY = "";
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      generateObject.mockImplementation(async (o: { prompt?: string }) => {
        if (String(o.prompt ?? "").startsWith("Some fields you wrote")) {
          throw new Error("model timeout");
        }
        return {
          object: {
            directions: [
              draftOf({ headline: "Loved by 500 Lagos commuters" }),
              contrastingDraft(),
            ],
          },
        };
      });
      const lost = new Error("connection reset");
      updateDesignGeneration.mockImplementation(
        async (_id: string, patch: { status?: string }) => {
          if (patch.status === "failed") throw lost;
        },
      );
      await runBrief(
        "Promote our almond croissants to commuters before work.",
        { image: { source: "none" } },
      );
      expect(logged).toHaveBeenCalledWith(
        "design direction row-1 could not be marked failed",
        lost,
      );
    } finally {
      logged.mockRestore();
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  });

  it("J3: says so in the job's error when every direction loses its headline", async () => {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      generateObject.mockImplementation(async (o: { prompt?: string }) => {
        if (String(o.prompt ?? "").startsWith("Some fields you wrote")) {
          throw new Error("model timeout");
        }
        return {
          object: {
            directions: [
              draftOf({ headline: "Loved by 500 Lagos commuters" }),
              contrastingDraft({ headline: "Rated 4.9 by 2,000 regulars" }),
            ],
          },
        };
      });
      await expect(
        runBrief("Promote our almond croissants to commuters before work.", {
          image: { source: "none" },
        }),
      ).rejects.toThrow(
        "We couldn't write a headline for this design that keeps to your brief.",
      );
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  });
});

/* Round-9 code critic, job probes J4 to J6 (r9-job-probes.log), on the
   PR 1 default path: the flag off and no photo. */
describe("round-9 critic job probes", () => {
  async function flagOff(body: () => Promise<void>) {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await body();
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  }

  it("J4: 'Fun for all ages, 8+ flavours' is not the age, which is written in", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer(
          [
            { kind: "day", text: "this Saturday" },
            { kind: "age", text: "Ages 8+" },
          ],
          { kind: "event", phrase: "ice cream social" },
        ),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Ice cream social",
              subheadline: "This Saturday. Fun for all ages, 8+ flavours.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Scoops this Saturday",
              subheadline:
                "Our social is back for all ages: 8+ flavours to try.",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Ice cream social this Saturday with 8+ flavours. Ages 8+.",
        { image: { source: "none" } },
      );
      for (const id of ["row-1", "row-2"]) {
        expect(drawnOf(id)).toMatch(/ages 8\+/i);
      }
      expect(usage().factsAdded).toBeGreaterThanOrEqual(2);
      expect(usage().factsLeftOff).toEqual([]);
    }));

  /* The second design has no comma, so the month sits beside the hour in
     one clause (FP4): only the calendar rule refuses it. */
  it("J5: 'Saturday 12 December, 5pm' is not the date, which is written in", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer([{ kind: "date", text: "Saturday 5 December" }], {
          kind: "event",
          phrase: "Christmas market",
        }),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Christmas market",
              subheadline: "Saturday 12 December, 5pm.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Twelve stalls of gifts",
              subheadline: "Join us Saturday 12 December 5pm till late.",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Christmas market on Saturday 5 December from 5pm. 12 stalls.",
        { image: { source: "none" } },
      );
      for (const id of ["row-1", "row-2"]) {
        expect(drawnOf(id)).toMatch(/Saturday 5 December/);
      }
      expect(usage().factsAdded).toBeGreaterThanOrEqual(2);
      expect(usage().factsLeftOff).toEqual([]);
    }));

  it("J6: draws a Title Case count and a hyphenated phone button", () =>
    flagOff(async () => {
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({ cta: "Book 4 Seats" }),
            contrastingDraft({ cta: "Call 0803-555-0142 to order" }),
          ],
        },
      });
      await runBrief(
        "Almond croissant tasting for commuters. Book 4 seats per table. Call 0803-555-0142 to order.",
        { image: { source: "none" } },
      );
      expect(["row-1", "row-2"].map((id) => delivered(id)?.spec?.cta)).toEqual([
        "Book 4 Seats",
        "Call 0803-555-0142 to order",
      ]);
    }));
});

/* Round-10 code critic, job probes J7 and J9 to J11 (r10-job-probes.log,
   r10-job-J11.log), on the PR 1 default path: the flag off and no photo.
   Each was a design shipped without the brief's fact, or a fact counted
   left off that the design carried, while the usage row said otherwise. */
describe("round-10 critic job probes", () => {
  async function flagOff(body: () => Promise<void>) {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await body();
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  }

  it("J7: 'Fun for all ages · 8+ flavours' is not the age, which is written in", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer(
          [
            { kind: "day", text: "this Saturday" },
            { kind: "age", text: "Ages 8+" },
          ],
          { kind: "event", phrase: "ice cream social" },
        ),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Ice cream social",
              subheadline: "This Saturday · Fun for all ages · 8+ flavours",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Scoops this Saturday",
              subheadline:
                "Our social is back for all ages / 8+ flavours to try",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Ice cream social this Saturday with 8+ flavours. Ages 8+.",
        { image: { source: "none" } },
      );
      for (const id of ["row-1", "row-2"]) {
        expect(drawnOf(id)).toMatch(/ages 8\+/i);
      }
      expect(usage().factsAdded).toBeGreaterThanOrEqual(2);
      expect(usage().factsLeftOff).toEqual([]);
    }));

  it("J9: 'Ages 21 and over' states '21 and over': nothing is written in again or counted left off", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer([{ kind: "age", text: "21 and over" }], {
          kind: "event",
          phrase: "wine night",
        }),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Wine night",
              subheadline: "Ages 21 and over. Friday from 7pm.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Uncork Friday",
              subheadline: "Adults 18+ only? No: ages 21 and over.",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief("Wine night this Friday from 7pm, 21 and over.", {
        image: { source: "none" },
      });
      /* Row 1 states the age; the writer was sent anyway, added a "21 and
         over" footer the renderer then hid, and the row was counted as
         leaving the age off. Row 2's subheadline invents "18+", so its
         facts are written in. */
      expect(delivered("row-1")?.spec?.footerLines ?? []).toEqual([]);
      expect(usage().factsLeftOff).toEqual([]);
      expect(usage().briefFactsDelivered).toBe(usage().briefFacts);
    }));

  it("J10: draws 'Shop 2 Floor Lamps' and 'Shop 10 Styles at the Mall'", () =>
    flagOff(async () => {
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({ cta: "Shop 2 Floor Lamps" }),
            contrastingDraft({ cta: "Shop 10 Styles at the Mall" }),
          ],
        },
      });
      /* The brief gives both counts, so only isAction can refuse the
         buttons: with "New floor lamps in store this week." inventedFacts
         refuses them first, for numbers the brief never states. */
      await runBrief(
        "New floor lamps in store this week: shop 2 floor lamps for the price of one, or 10 styles at the mall.",
        { image: { source: "none" } },
      );
      expect(["row-1", "row-2"].map((id) => delivered(id)?.spec?.cta)).toEqual([
        "Shop 2 Floor Lamps",
        "Shop 10 Styles at the Mall",
      ]);
    }));

  it("J11: 'Saturday 5 food trucks, 12 stalls, all December' is not the date, which is written in", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer([{ kind: "date", text: "Saturday 5 December" }], {
          kind: "event",
          phrase: "Christmas market",
        }),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Christmas market",
              subheadline:
                "This Saturday 5 food trucks and 12 stalls in December",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Gifts for everyone",
              subheadline: "Saturday 5 food trucks, 12 stalls, all December",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Christmas market on Saturday 5 December. 12 stalls and 5 food trucks.",
        { image: { source: "none" } },
      );
      for (const id of ["row-1", "row-2"]) {
        expect(drawnOf(id)).toMatch(/Saturday 5 December/);
      }
      expect(usage().factsAdded).toBeGreaterThanOrEqual(2);
      expect(usage().factsLeftOff).toEqual([]);
    }));
});

/* Round-11 code critic, job probes J12 to J16 (r11-job-probes.log), on the
   PR 1 default path: the flag off and no photo. J12, J15 and J16 shipped a
   design with one part of a fact and counted the whole fact delivered; J13
   hid a footer age the verifier had counted; J14 is the field's other
   weekday. */
describe("round-11 critic job probes", () => {
  async function flagOff(body: () => Promise<void>) {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await body();
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  }
  const shownOf = (id: string) => {
    const spec = delivered(id)?.spec;
    if (!spec) return "";
    return [spec.headline, spec.subheadline, spec.cta, ...footerLinesFor(spec)]
      .filter(Boolean)
      .join("\n");
  };
  const both = (re: RegExp) =>
    ["row-1", "row-2"].map((id) => re.test(shownOf(id)));

  it("J12: '5, 12 and 19 December' is not stated by '5 December' alone, and is written in", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer([{ kind: "date", text: "5, 12 and 19 December" }], {
          kind: "event",
          phrase: "pottery class",
        }),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Pottery class",
              subheadline: "Starts Saturday 5 December. Book your wheel.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Get your hands muddy",
              subheadline: "First class December 5, beginners welcome.",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Beginner pottery class on 5, 12 and 19 December. Book your wheel.",
        { image: { source: "none" } },
      );
      expect(both(/5, 12 and 19 December/)).toEqual([true, true]);
      expect(usage().factsLeftOff).toEqual([]);
      expect(usage().briefFactsDelivered).toBe(usage().briefFacts);
    }));

  it("J13: a footer 'Ages: 8+' under 'all ages · 8+ flavours' is drawn, not hidden as a repeat", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer(
          [
            { kind: "day", text: "this Saturday" },
            { kind: "age", text: "Ages 8+" },
          ],
          { kind: "event", phrase: "ice cream social" },
        ),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Ice cream social",
              subheadline: "This Saturday. Fun for all ages · 8+ flavours",
              footerStyle: "text",
              footerLines: ["Ages: 8+"],
            }),
            contrastingDraft({
              headline: "Scoops this Saturday",
              subheadline: "This Saturday, all ages, 8+ flavours to try",
              footerStyle: "text",
              footerLines: ["Ages: 8+"],
            }),
          ],
        },
      });
      await runBrief(
        "Ice cream social this Saturday with 8+ flavours. Ages 8+.",
        { image: { source: "none" } },
      );
      expect(both(/ages:? 8\+/i)).toEqual([true, true]);
      expect(usage().factsLeftOff).toEqual([]);
    }));

  it("J14: 'Sunday · 5 December' never stands for 'Saturday 5 December'", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer([{ kind: "date", text: "Saturday 5 December" }], {
          kind: "event",
          phrase: "Christmas market",
        }),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Christmas market",
              subheadline: "Sunday · 5 December · from 5pm",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Gifts for everyone",
              subheadline: "5 December, Sunday. 12 stalls.",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Christmas market on Saturday 5 December from 5pm. 12 stalls.",
        { image: { source: "none" } },
      );
      expect(both(/sunday/i)).toEqual([false, false]);
      expect(both(/Saturday 5 December/)).toEqual([true, true]);
    }));

  it("J15: 'Mon-Fri 9am-5pm, Sat 10am-2pm' is not stated by 'Sat 10am-2pm', and is written in", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer([{ kind: "time", text: "Mon-Fri 9am-5pm, Sat 10am-2pm" }], {
          kind: "service",
          phrase: "tailoring",
        }),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Bespoke tailoring",
              subheadline: "Walk in Sat 10am-2pm for a fitting.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Suits that fit",
              subheadline: "Saturday fittings 10am-2pm.",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Bespoke tailoring in Yaba. Open Mon-Fri 9am-5pm, Sat 10am-2pm.",
        { image: { source: "none" } },
      );
      expect(both(/Mon-Fri 9am-5pm/)).toEqual([true, true]);
      expect(usage().factsLeftOff).toEqual([]);
      expect(usage().briefFactsDelivered).toBe(usage().briefFacts);
    }));

  it("J16: 'ages 5-12 and 13-17' is not stated by 'Ages 5-12', and is written in", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer([{ kind: "age", text: "ages 5-12 and 13-17" }], {
          kind: "event",
          phrase: "coding camp",
        }),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Coding camp",
              subheadline: "For ages 5-12. Build your first game.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Build your first game",
              subheadline: "Ages 5-12, this December.",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Holiday coding camp for ages 5-12 and 13-17 this December.",
        { image: { source: "none" } },
      );
      expect(both(/13-17/)).toEqual([true, true]);
      expect(usage().factsLeftOff).toEqual([]);
      expect(usage().briefFactsDelivered).toBe(usage().briefFacts);
    }));
});

/* Round 12, the lost headline in eval run a at a958ac0: conference-ko's
   claim check flagged "Can African cities beat the heat?" and rewrote it as
   the other design's headline, which the sibling rule refused, so the case
   shipped one design (critique-12/lost-headline-trace.log, three of three
   calls). Before a headline is declared lost the model is asked once more,
   told what was refused and why; what it writes is held to every rule. */
describe("a refused headline is asked for once more before it is lost", () => {
  const SIBLING = "Almond croissants for the commute";
  const REFUSED = "Your table is waiting";
  let claimCalls = 0;
  let recoveryPrompts: string[] = [];

  async function withClaimDouble(
    recovered: string[],
    flagSecond: boolean,
    body: () => Promise<void>,
  ) {
    const { HEADLINE_RECOVERY_PROMPT_START } = await import(
      "./directions/headline-rewrite"
    );
    const { isClaimCheckCall } = await import("./directions/fixtures");
    claimCalls = 0;
    recoveryPrompts = [];
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      const prompt = o.prompt ?? "";
      if (isClaimCheckCall(o)) {
        claimCalls += 1;
        if (claimCalls === 1) {
          return {
            object: {
              unsupported: [
                { id: "1.headline", statement: REFUSED, rewrite: SIBLING },
              ],
            },
          };
        }
        return {
          object: {
            unsupported:
              flagSecond && claimCalls === 2
                ? recovered.map((_, k) => ({
                    id: `1.headline.${k}`,
                    statement: "a promise",
                    rewrite: "",
                  }))
                : [],
          },
        };
      }
      if (prompt.startsWith(HEADLINE_RECOVERY_PROMPT_START)) {
        recoveryPrompts.push(prompt);
        return { object: { headlines: recovered } };
      }
      return { object: { directions: [draftOf(), contrastingDraft()] } };
    });
    const g = globalThis as { claimCheckThroughDouble?: boolean };
    g.claimCheckThroughDouble = true;
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await body();
    } finally {
      g.claimCheckThroughDouble = false;
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  }

  it("delivers the model's new headline when the claim check refused the first", () =>
    withClaimDouble(
      [SIBLING, "Weekend brunch starts here"],
      false,
      async () => {
        await runBrief(
          "Promote our almond croissants to commuters before work. Brunch on weekends.",
          { image: { source: "none" } },
        );
        expect(recoveryPrompts).toHaveLength(1);
        expect(recoveryPrompts[0]).toContain(`"${REFUSED}"`);
        expect(recoveryPrompts[0]).toContain("the other design's headline");
        expect(recoveryPrompts[0]).toContain(SIBLING);
        expect(delivered("row-1")?.spec?.headline).toBe(SIBLING);
        expect(delivered("row-2")?.spec?.headline).toBe(
          "Weekend brunch starts here",
        );
        expect(usage().headlinesLost).toBe(0);
        expect(usage().headlineRecovery).toEqual([
          {
            direction: 1,
            refused: [
              {
                headline: REFUSED,
                why: expect.stringMatching(/other design's headline/),
              },
            ],
            candidates: [SIBLING, "Weekend brunch starts here"],
            recovered: "Weekend brunch starts here",
            refusals: [
              {
                headline: SIBLING,
                rule: "already a headline",
                why: "another design's headline, or one already refused",
              },
            ],
            ships: "Weekend brunch starts here",
          },
        ]);
      },
    ));

  /* Eval run a at 4931c2e, pottery-evening-ko: a recovered headline the
     subheadline repeats kept the fact writer from writing the price in. */
  it("refuses a new headline the subheadline repeats", () =>
    withClaimDouble(
      ["Slow brunch and good coffee", "Weekend brunch starts here"],
      false,
      async () => {
        await runBrief(
          "Promote our almond croissants to commuters before work. Brunch on weekends.",
          { image: { source: "none" } },
        );
        expect(delivered("row-2")?.spec?.headline).toBe(
          "Weekend brunch starts here",
        );
        expect(recoveryPrompts[0]).toContain(
          "saying nothing the subheadline or button already says",
        );
      },
    ));

  it("fails the direction after one ask when nothing it writes stands", () =>
    withClaimDouble([SIBLING], false, async () => {
      await runBrief(
        "Promote our almond croissants to commuters before work. Brunch on weekends.",
        { image: { source: "none" } },
      );
      expect(recoveryPrompts).toHaveLength(1);
      expect(delivered("row-1")?.spec?.headline).toBe(SIBLING);
      expect(delivered("row-2")).toBeUndefined();
      expect(usage().headlinesLost).toBe(1);
      expect(usage().headlineRecovery[0]).toMatchObject({
        direction: 1,
        recovered: null,
        why: expect.stringMatching(/broke a rule/),
      });
    }));

  it("never delivers a new headline the claim check flags", () =>
    withClaimDouble(["Weekend brunch starts here"], true, async () => {
      await runBrief(
        "Promote our almond croissants to commuters before work. Brunch on weekends.",
        { image: { source: "none" } },
      );
      expect(recoveryPrompts).toHaveLength(1);
      expect(delivered("row-2")).toBeUndefined();
      expect(usage().headlinesLost).toBe(1);
      expect(usage().headlineRecovery[0]).toMatchObject({
        recovered: null,
        why: expect.stringMatching(/flagged every headline/),
      });
    }));
});

/* Round-12 code critic, job probes J20 to J22 (r12-job-probes.log), on the
   PR 1 default path: the flag off and no photo. */
describe("round-12 critic job probes", () => {
  async function flagOff(body: () => Promise<void>) {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await body();
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  }
  const shownOf = (id: string) => {
    const spec = delivered(id)?.spec;
    if (!spec) return "";
    return [spec.headline, spec.subheadline, spec.cta, ...footerLinesFor(spec)]
      .filter(Boolean)
      .join("\n");
  };
  const both = (re: RegExp) =>
    ["row-1", "row-2"].map((id) => re.test(shownOf(id)));

  it("J20: 'first Sunday of the month, 4pm-6pm' is not stated by 'Sunday 4pm-6pm', and is written in", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer(
          [{ kind: "time", text: "first Sunday of the month, 4pm-6pm" }],
          { kind: "event", phrase: "book club" },
        ),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Book club",
              subheadline: "Sunday 4pm-6pm. Bring a book.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Read with us",
              subheadline: "Join the book club, Sunday 4pm-6pm.",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Book club on the first Sunday of the month, 4pm-6pm. Bring a book.",
        { image: { source: "none" } },
      );
      expect(both(/first Sunday of the month/i)).toEqual([true, true]);
      expect(usage().factsLeftOff).toEqual([]);
      expect(usage().briefFactsDelivered).toBe(usage().briefFacts);
    }));

  /* Both headlines flagged by the claim check with no rewrite, and every
     recovery ask answered by `recover`. */
  async function bothLost(
    recover: () => unknown,
    { lost = ["0", "1"], noSub = false } = {},
  ) {
    const { HEADLINE_RECOVERY_PROMPT_START } = await import(
      "./directions/headline-rewrite"
    );
    const { isClaimCheckCall } = await import("./directions/fixtures");
    let claimCalls = 0;
    const prompts: string[] = [];
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      const prompt = o.prompt ?? "";
      if (isClaimCheckCall(o)) {
        claimCalls += 1;
        return {
          object: {
            unsupported:
              claimCalls === 1
                ? lost.map((i) => ({
                    id: `${i}.headline`,
                    statement: "a promise",
                    rewrite: "",
                  }))
                : [],
          },
        };
      }
      if (prompt.startsWith(HEADLINE_RECOVERY_PROMPT_START)) {
        prompts.push(prompt);
        return recover();
      }
      const drafts = [draftOf(), contrastingDraft()];
      return {
        object: {
          directions: noSub
            ? drafts.map((d) => ({ ...d, subheadline: "" }))
            : drafts,
        },
      };
    });
    const g = globalThis as { claimCheckThroughDouble?: boolean };
    g.claimCheckThroughDouble = true;
    try {
      await flagOff(() =>
        runBrief(
          "Promote our almond croissants to commuters before work. Brunch on weekends.",
          { image: { source: "none" } },
        ).then(() => undefined),
      );
    } finally {
      g.claimCheckThroughDouble = false;
    }
    return { prompts, claimCalls };
  }
  const headlines = () =>
    ["row-1", "row-2"].map((id) => delivered(id)?.spec?.headline ?? null);

  it("J21b: two lost directions never both recover one headline, and the record names what ships", async () => {
    const { prompts } = await bothLost(() => ({
      object: { headlines: ["Weekend brunch starts here"] },
    }));
    const [first, second] = headlines();
    expect(first).toBe("Weekend brunch starts here");
    expect(second).not.toBe(first);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Weekend brunch starts here");
    const recovery = usage().headlineRecovery;
    expect(
      recovery.map((r: { recovered: string | null }) => r.recovered),
    ).toEqual(["Weekend brunch starts here", null]);
    expect(recovery.map((r: { ships: string | null }) => r.ships)).toEqual(
      headlines(),
    );
  });

  it("J21c: with no subheadline to promote, the pair still never ships one headline", async () => {
    await bothLost(
      () => ({ object: { headlines: ["Weekend brunch starts here"] } }),
      { noSub: true },
    );
    const [first, second] = headlines();
    expect(first).toBe("Weekend brunch starts here");
    expect(second).not.toBe(first);
    expect(usage().headlinesLost).toBe(1);
    expect(usage().headlineRecovery[1]).toMatchObject({
      direction: 1,
      recovered: null,
      ships: null,
      why: expect.stringMatching(/broke a rule/),
    });
  });

  it("J22: a recovery call that throws is recorded as an outage, not as the model's answer", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await bothLost(
        () => {
          throw new Error("upstream 529");
        },
        { lost: ["1"] },
      );
    } finally {
      errors.mockRestore();
    }
    expect(usage().headlinesLost).toBe(1);
    expect(usage().headlineRecovery).toEqual([
      expect.objectContaining({
        direction: 1,
        candidates: [],
        recovered: null,
        why: "the headline model could not be reached",
      }),
    ]);
  });
});

/* Round 14, eval run a at ba7a7ea: three directions lost and a fourth
   recovered, each after the claim check offered the other design's
   headline as its rewrite (critique-14/diagnosis.md). Every case replays
   the logged drafts, brief read, claim-check flag and recovery candidates
   through the job, on the PR 1 default path: the flag off and no photo. */
describe("round 14: the lost headlines of eval run a at ba7a7ea", () => {
  type LoggedCase = keyof typeof EVAL_A_BA7A7EA;

  async function replay(
    id: LoggedCase,
    {
      candidates,
      drafts,
      flagRecovered = false,
    }: {
      candidates?: readonly string[];
      drafts?: (logged: Record<string, unknown>[]) => Record<string, unknown>[];
      flagRecovered?: boolean;
    } = {},
  ) {
    const { HEADLINE_RECOVERY_PROMPT_START } = await import(
      "./directions/headline-rewrite"
    );
    const { isClaimCheckCall } = await import("./directions/fixtures");
    const logged = EVAL_A_BA7A7EA[id];
    const claimPrompts: string[] = [];
    const recoveryPrompts: string[] = [];
    readBrief.mockResolvedValue(
      readAnswer(
        logged.read.facts.map((f) => ({ ...f })),
        { ...logged.read.offering },
        [...logged.read.people],
      ),
    );
    const loggedDrafts = structuredClone(logged.drafts) as unknown as Record<
      string,
      unknown
    >[];
    if ("atRecovery" in logged) {
      loggedDrafts[1] = { ...loggedDrafts[1], ...logged.atRecovery };
    }
    const shown = drafts ? drafts(loggedDrafts) : loggedDrafts;
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      const prompt = o.prompt ?? "";
      if (isClaimCheckCall(o)) {
        claimPrompts.push(prompt);
        if (claimPrompts.length === 1) {
          return { object: { unsupported: [{ ...logged.headlineFlag }] } };
        }
        const ids = [...prompt.matchAll(/^(\d+\.headline\.\d+) \|/gm)].map(
          (m) => m[1],
        );
        return {
          object: {
            unsupported: flagRecovered
              ? ids.map((fieldId) => ({
                  id: fieldId,
                  statement: "Across Africa",
                  rewrite: "",
                }))
              : [],
          },
        };
      }
      if (prompt.startsWith(HEADLINE_RECOVERY_PROMPT_START)) {
        recoveryPrompts.push(prompt);
        return {
          object: { headlines: [...(candidates ?? logged.candidates)] },
        };
      }
      return { object: { directions: structuredClone(shown) } };
    });
    const g = globalThis as { claimCheckThroughDouble?: boolean };
    g.claimCheckThroughDouble = true;
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await generateDirectionsWork(
        {
          context: directionsContext({
            briefText: logged.briefText,
            title: logged.title,
            brandSummary: { ...logged.brandSummary },
          }),
          userId: "u1",
          sessionId: "s1",
          request: { image: { source: "none" } } as never,
        },
        runtime as never,
      );
    } finally {
      g.claimCheckThroughDouble = false;
      process.env.FEATURE_KO_IMAGERY = "1";
    }
    return { claimPrompts, recoveryPrompts, logged };
  }
  const recovery = () =>
    usage().headlineRecovery as {
      direction: number;
      recovered: string | null;
      why?: string;
      refusals: { headline: string; rule: string; why: string }[];
    }[];

  it("tells the claim check each design's headline is its own, by name", async () => {
    const { claimPrompts, logged } = await replay(
      "storefront-reopening-upload",
    );
    expect(claimPrompts[0]).toContain(
      "a rewrite never uses another design's headline",
    );
    expect(claimPrompts[0]).toContain(
      `design 0's headline is "${logged.drafts[0].headline}"`,
    );
    expect(claimPrompts[0]).toContain(
      `design 1's headline is "${logged.drafts[1].headline}"`,
    );
  });

  it.each(["fashion-portrait-upload", "storefront-reopening-upload"] as const)(
    "%s: names the check that refused each logged candidate",
    async (id) => {
      const { logged } = await replay(id);
      const [outcome] = recovery();
      expect(outcome.recovered).toBeNull();
      expect(outcome.refusals.map((r) => r.headline)).toEqual([
        ...logged.candidates,
      ]);
      for (const refusal of outcome.refusals) {
        expect(refusal.rule).toBe("subheadline repeats it");
        expect(refusal.why).toMatch(/^the subheadline (says|repeats)/);
      }
    },
  );

  it("recruitment-ko: names the repeat and the words the claim check found", async () => {
    await replay("recruitment-ko", { flagRecovered: true });
    const [outcome] = recovery();
    expect(outcome.why).toMatch(/claim check flagged every headline/);
    expect(outcome.refusals).toEqual([
      {
        headline: "Senior React Engineers, Remote in Africa",
        rule: "subheadline repeats it",
        why: "the subheadline says the headline again",
      },
      {
        headline: "Remote React Roles Across Africa",
        rule: "claim check",
        why: 'found "Across Africa", which the brief does not say',
      },
      {
        headline: "React Engineers Across Africa",
        rule: "claim check",
        why: 'found "Across Africa", which the brief does not say',
      },
    ]);
  });

  /* A subheadline that repeats the button's date repeats it whatever the
     headline says: counted against the candidate, it refused every one. */
  it("recruitment-ko: a candidate is not refused for the button's repeat", async () => {
    await replay("recruitment-ko", {
      drafts: ([first, second]) => [
        first,
        { ...second, cta: "Apply by 30 November" },
      ],
    });
    const [outcome] = recovery();
    expect(outcome.recovered).toBe("Remote React Roles Across Africa");
    expect(delivered("row-2")?.spec?.headline).toBe(
      "Remote React Roles Across Africa",
    );
    expect(usage().headlinesLost).toBe(0);
  });

  it("fashion-portrait-upload: asks for five and states the subheadline rule with its words", async () => {
    const extra = ["Linen for the Harmattan", "Made for the dry wind"];
    const { recoveryPrompts, logged } = await replay(
      "fashion-portrait-upload",
      {
        candidates: [
          ...EVAL_A_BA7A7EA["fashion-portrait-upload"].candidates,
          ...extra,
        ],
      },
    );
    expect(recoveryPrompts[0]).toContain("Write 5 headlines");
    expect(recoveryPrompts[0]).toMatch(
      /The subheadline already uses these words: [^.]*harmattan[^.]*linen[^.]*dress/,
    );
    expect(recoveryPrompts[0]).toContain(
      "A headline is refused when two of every three of its words are among them",
    );
    const [outcome] = recovery();
    expect(outcome.refusals.map((r) => r.headline)).toEqual([
      ...logged.candidates,
      "Linen for the Harmattan",
    ]);
    expect(outcome.recovered).toBe("Made for the dry wind");
    expect(usage().headlinesLost).toBe(0);
  });
});

/* Round-14 code critic, job probes J30 to J33 (r14-job-probes.log) and
   J14's lost headline, on the PR 1 default path: the flag off and no
   photo. */
describe("round-14 critic job probes", () => {
  async function flagOff(body: () => Promise<void>) {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await body();
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  }
  const shownOf = (id: string) => {
    const spec = delivered(id)?.spec;
    if (!spec) return "";
    return [spec.headline, spec.subheadline, spec.cta, ...footerLinesFor(spec)]
      .filter(Boolean)
      .join("\n");
  };
  const headlines = () =>
    ["row-1", "row-2"].map((id) => delivered(id)?.spec?.headline ?? null);

  /* J30: direction 0's subheadline gives 5 December on Sunday. `fix` is
     what the fact writer (a double for the model) writes for it. */
  async function christmasMarket(fix: {
    subheadline: string;
    footerLines: string[];
  }) {
    const { fakeFactWrite, isFactWriteCall } = await import(
      "./directions/fixtures"
    );
    const asks: string[] = [];
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      if (isFactWriteCall(o)) {
        asks.push(o.prompt ?? "");
        const { rewrites } = fakeFactWrite(o).object;
        return {
          object: {
            rewrites: rewrites.map((r) => (r.id === 0 ? { id: 0, ...fix } : r)),
          },
        };
      }
      return {
        object: {
          directions: [
            draftOf({
              headline: "Christmas market",
              subheadline:
                "Crafts on Sunday morning, 5 December. Food on Sunday 6 December.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Make it merry",
              subheadline: "Saturday 5 December and Sunday 6 December",
              footerLines: [],
            }),
          ],
        },
      };
    });
    readBrief.mockResolvedValue(
      readAnswer(
        [
          { kind: "date", text: "Saturday 5 December" },
          { kind: "date", text: "Sunday 6 December" },
        ],
        { kind: "event", phrase: "Christmas market" },
      ),
    );
    const g = globalThis as { factWriteThroughDouble?: boolean };
    g.factWriteThroughDouble = true;
    try {
      await flagOff(() =>
        runBrief(
          "Christmas market on Saturday 5 December and Sunday 6 December. Crafts on the Saturday, food on the Sunday.",
          { image: { source: "none" } },
        ).then(() => undefined),
      );
    } finally {
      g.factWriteThroughDouble = false;
    }
    return asks;
  }

  /* Two dated days in one field state neither (Oluwaseyi's ruling,
     2026-10-28), so the fix gives each its own footer line. */
  it("J30: the fact writer is asked to fix the field that gives 5 December on Sunday, and its fix ships", () =>
    christmasMarket({
      subheadline: "Crafts on the Saturday, food on the Sunday.",
      footerLines: ["Saturday 5 December", "Sunday 6 December"],
    }).then((asks) => {
      expect(asks[0]).toContain(
        'the subheadline "Crafts on Sunday morning, 5 December. Food on Sunday 6 December." gives "5 December"',
      );
      expect(delivered("row-1")?.spec?.subheadline).toBe(
        "Crafts on the Saturday, food on the Sunday.",
      );
      expect(shownOf("row-1")).toContain("Saturday 5 December");
      expect(
        usage().factsLeftOff.filter(
          (l: { direction: number }) => l.direction === 0,
        ),
      ).toEqual([]);
      expect(usage().datesContradicted).toEqual([]);
    }));

  /* Round-16 code critic, finding 4: the writer could not fix the
     sentence, and the design shipped the wrong day. Code leaves that
     sentence off; it writes nothing in its place. */
  it("J30: a sentence the writer could not move off the wrong day is left off, and no design ships the wrong day", () =>
    christmasMarket({
      subheadline:
        "Crafts on Sunday morning, 5 December. Food on Sunday 6 December.",
      footerLines: ["Open Saturday 5 December"],
    }).then(() => {
      for (const id of ["row-1", "row-2"]) {
        expect(shownOf(id)).not.toMatch(/Sunday morning, 5 December/);
      }
      expect(delivered("row-1")?.spec?.subheadline).toBe(
        "Food on Sunday 6 December.",
      );
      expect(usage().datesContradicted).toEqual([
        expect.objectContaining({
          direction: 0,
          fact: "Saturday 5 December",
          field: "subheadline",
          run: "5 December",
          action: "dropped",
        }),
      ]);
      expect(usage().factsLeftOff).toContainEqual(
        expect.objectContaining({
          direction: 0,
          fact: "Saturday 5 December",
        }),
      );
    }));

  /* Round-19 code critic, finding 1 (r19-writer.log): the writer's own
     fix prepends the right day and keeps the wrong sentence. The rewrite
     is refused, the wrong sentence is left off, and the job records it;
     no design ships "Sunday morning, 5 December" as delivered. */
  it("J30: a fix that states the date on the right day beside the wrong one ships neither the wrong day nor a silent delivery", () =>
    christmasMarket({
      subheadline:
        "Open Saturday 5 December. Crafts on Sunday morning, 5 December.",
      footerLines: ["Food on Sunday 6 December"],
    }).then(() => {
      for (const id of ["row-1", "row-2"]) {
        expect(shownOf(id)).not.toMatch(/Sunday morning, 5 December/);
      }
      expect(usage().datesContradicted).toContainEqual(
        expect.objectContaining({
          direction: 0,
          fact: "Saturday 5 December",
          field: "subheadline",
          action: "dropped",
        }),
      );
    }));

  /* The headline is the idea: code never rewrites it, so a headline on
     the wrong day fails its direction and the sibling ships. */
  it("J30: a headline that gives the date on the wrong day fails its direction", async () => {
    const { fakeFactWrite, isFactWriteCall } = await import(
      "./directions/fixtures"
    );
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      if (isFactWriteCall(o)) return fakeFactWrite(o);
      return {
        object: {
          directions: [
            draftOf({
              headline: "Sunday market, 5 December",
              subheadline: "Crafts on the Saturday, food on the Sunday.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Make it merry",
              subheadline: "Crafts on Saturday 5 December.",
              footerLines: ["Food on Sunday 6 December"],
              footerStyle: "text",
            }),
          ],
        },
      };
    });
    readBrief.mockResolvedValue(
      readAnswer(
        [
          { kind: "date", text: "Saturday 5 December" },
          { kind: "date", text: "Sunday 6 December" },
        ],
        { kind: "event", phrase: "Christmas market" },
      ),
    );
    const g = globalThis as { factWriteThroughDouble?: boolean };
    g.factWriteThroughDouble = true;
    try {
      await flagOff(() =>
        runBrief(
          "Christmas market on Saturday 5 December and Sunday 6 December. Crafts on the Saturday, food on the Sunday.",
          { image: { source: "none" } },
        ).then(() => undefined),
      );
    } finally {
      g.factWriteThroughDouble = false;
    }
    expect(delivered("row-1")).toBeUndefined();
    expect(failedRow("row-1")?.error).toBe(new DateOnWrongDayError().message);
    expect(delivered("row-2")?.spec?.headline).toBe("Make it merry");
    expect(usage().datesContradicted).toContainEqual(
      expect.objectContaining({
        direction: 0,
        field: "headline",
        run: "5 December",
        action: "failed",
      }),
    );
  });

  /* The claim check flags direction 1's headline and offers `rewrite`;
     neither design has a subheadline to promote. */
  async function siblingRewrite(rewrite: string) {
    const { isClaimCheckCall } = await import("./directions/fixtures");
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      if (isClaimCheckCall(o)) {
        const flagsOne = (o.prompt ?? "").includes("1.headline |");
        return {
          object: {
            unsupported: flagsOne
              ? [{ id: "1.headline", statement: "a promise", rewrite }]
              : [],
          },
        };
      }
      return {
        object: {
          directions: [
            draftOf({ subheadline: "" }),
            contrastingDraft({ subheadline: "" }),
          ],
        },
      };
    });
    const g = globalThis as { claimCheckThroughDouble?: boolean };
    g.claimCheckThroughDouble = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await flagOff(() =>
        runBrief(
          "Promote our almond croissants to commuters before work. Brunch on weekends.",
          { image: { source: "none" } },
        ).then(() => undefined),
      );
    } finally {
      g.claimCheckThroughDouble = false;
      errors.mockRestore();
    }
  }

  it.each([
    ["J31", "Almond croissants for the commute."],
    ["J32", "Almond croissants for your commute"],
  ])(
    "%s: the claim check's rewrite %j of the sibling's headline is refused",
    async (_id, rewrite) => {
      await siblingRewrite(rewrite);
      const [first, second] = headlines();
      expect(first).toBe("Almond croissants for the commute");
      expect(second).not.toBe(rewrite);
      expect(usage().headlinesLost).toBe(1);
      expect(usage().claimCheck.headlineRefusals).toEqual([
        expect.objectContaining({
          direction: 1,
          rewrite,
          why: "its rewrite is the other design's headline",
        }),
      ]);
    },
  );

  it("J33: a direction whose recovery failed ships nothing, so the next recovery is not held to its headline", async () => {
    const { HEADLINE_RECOVERY_PROMPT_START } = await import(
      "./directions/headline-rewrite"
    );
    const { isClaimCheckCall } = await import("./directions/fixtures");
    let claimCalls = 0;
    const asks: string[] = [];
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      const prompt = o.prompt ?? "";
      if (isClaimCheckCall(o)) {
        claimCalls += 1;
        return {
          object: {
            unsupported:
              claimCalls === 1
                ? ["0", "1"].map((i) => ({
                    id: `${i}.headline`,
                    statement: "a promise",
                    rewrite: "",
                  }))
                : [],
          },
        };
      }
      if (prompt.startsWith(HEADLINE_RECOVERY_PROMPT_START)) {
        asks.push(prompt);
        return {
          object: {
            headlines:
              asks.length === 1 ? [] : ["Almond croissants for your commute"],
          },
        };
      }
      return { object: { directions: [draftOf(), contrastingDraft()] } };
    });
    const g = globalThis as { claimCheckThroughDouble?: boolean };
    g.claimCheckThroughDouble = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await flagOff(() =>
        runBrief(
          "Promote our almond croissants to commuters before work. Brunch on weekends.",
          { image: { source: "none" } },
        ).then(() => undefined),
      );
    } finally {
      g.claimCheckThroughDouble = false;
      errors.mockRestore();
    }
    expect(asks).toHaveLength(2);
    expect(asks[1]).not.toContain("The other design's headline");
    const recovery = usage().headlineRecovery;
    expect(recovery[0]).toMatchObject({ direction: 0, recovered: null });
    expect(recovery[1]).toMatchObject({
      direction: 1,
      recovered: "Almond croissants for your commute",
      refusals: [],
    });
    expect(headlines()[0]).toBeNull();
    expect(recovery[1].ships).toBe(headlines()[1]);
  });

  it("J14: 'Gifts under one roof' counts nothing, so its design is not lost", () =>
    flagOff(async () => {
      readBrief.mockResolvedValue(
        readAnswer([{ kind: "date", text: "Saturday 5 December" }], {
          kind: "event",
          phrase: "Christmas market",
        }),
      );
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              headline: "Christmas market",
              subheadline: "Saturday 5 December, from 5pm. 12 stalls.",
              footerLines: [],
            }),
            contrastingDraft({
              headline: "Gifts under one roof",
              subheadline: "12 stalls on Saturday 5 December, from 5pm.",
              footerLines: [],
            }),
          ],
        },
      });
      await runBrief(
        "Christmas market on Saturday 5 December from 5pm. 12 stalls.",
        { image: { source: "none" } },
      );
      expect(headlines()).toEqual(["Christmas market", "Gifts under one roof"]);
      expect(usage().headlinesLost).toBe(0);
    }));

  /* Round-15 code critic, finding 4 (J40): direction 1's headline is
     refused with no rewrite and its recovery fails, so it ships nothing.
     Its refused headline near-duplicates direction 0's, which must not
     move for it. */
  it("J40: a lost direction's refused headline does not move the design that ships", async () => {
    const { HEADLINE_RECOVERY_PROMPT_START } = await import(
      "./directions/headline-rewrite"
    );
    const { isClaimCheckCall } = await import("./directions/fixtures");
    const calls: string[] = [];
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      const prompt = o.prompt ?? "";
      if (isClaimCheckCall(o)) {
        calls.push("claim");
        const flagsOne = prompt.includes("1.headline |");
        return {
          object: {
            unsupported: flagsOne
              ? [{ id: "1.headline", statement: "a promise", rewrite: "" }]
              : [],
          },
        };
      }
      if (prompt.startsWith(HEADLINE_RECOVERY_PROMPT_START)) {
        calls.push("recover");
        return { object: { headlines: [] } };
      }
      if (prompt.startsWith("You write headlines")) {
        calls.push("rewrite");
        return { object: { headlines: [] } };
      }
      calls.push("draft");
      return {
        object: {
          directions: [
            draftOf(),
            contrastingDraft({
              headline: "Almond croissants for your commute",
              subheadline: "",
            }),
          ],
        },
      };
    });
    const g = globalThis as { claimCheckThroughDouble?: boolean };
    g.claimCheckThroughDouble = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await flagOff(() =>
        runBrief(
          "Promote our almond croissants to commuters before work. Brunch on weekends.",
          { image: { source: "none" } },
        ).then(() => undefined),
      );
    } finally {
      g.claimCheckThroughDouble = false;
      errors.mockRestore();
    }
    expect(headlines()).toEqual(["Almond croissants for the commute", null]);
    expect(delivered("row-1")?.spec?.subheadline).toBe(
      "Baked before sunrise in Lekki",
    );
    expect(calls).not.toContain("rewrite");
    expect(usage().headlineRewritten).toBe(false);
    expect(usage().headlinesLost).toBe(1);
  });

  /* Round-16 code critic, finding 5: a lost direction still went through
     the fact writer and the footer passes, paying for a design that never
     ships. */
  it("J40: a lost direction is not sent to the fact writer or the footer passes", async () => {
    const { HEADLINE_RECOVERY_PROMPT_START } = await import(
      "./directions/headline-rewrite"
    );
    const { fakeFactWrite, isClaimCheckCall, isFactWriteCall } = await import(
      "./directions/fixtures"
    );
    const factAsks: string[] = [];
    const footerAsks: string[] = [];
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      const prompt = o.prompt ?? "";
      if (isClaimCheckCall(o)) {
        const flagsOne = prompt.includes("1.headline |");
        return {
          object: {
            unsupported: flagsOne
              ? [{ id: "1.headline", statement: "a promise", rewrite: "" }]
              : [],
          },
        };
      }
      if (isFactWriteCall(o)) {
        factAsks.push(prompt);
        return fakeFactWrite(o);
      }
      if (prompt.startsWith("You edit social media designs. For each")) {
        footerAsks.push(prompt);
        return { object: { repeats: [] } };
      }
      if (
        prompt.startsWith(HEADLINE_RECOVERY_PROMPT_START) ||
        prompt.startsWith("You write headlines")
      ) {
        return { object: { headlines: [] } };
      }
      return {
        object: {
          directions: [
            draftOf({
              footerLines: ["WhatsApp 0803 555 0142"],
              footerStyle: "text",
            }),
            contrastingDraft({
              headline: "Your table is waiting",
              subheadline: "Slow tables for the weekend crowd.",
              footerLines: ["Weekend brunch tables"],
              footerStyle: "text",
            }),
          ],
        },
      };
    });
    readBrief.mockResolvedValue(
      readAnswer([{ kind: "price", text: "₦2,500 each" }], {
        kind: "product",
        phrase: "almond croissants",
      }),
    );
    const g = globalThis as {
      claimCheckThroughDouble?: boolean;
      factWriteThroughDouble?: boolean;
    };
    g.claimCheckThroughDouble = true;
    g.factWriteThroughDouble = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await flagOff(() =>
        runBrief(
          "Promote our almond croissants to commuters before work, ₦2,500 each. WhatsApp 0803 555 0142. Brunch on weekends.",
          { image: { source: "none" } },
        ).then(() => undefined),
      );
    } finally {
      g.claimCheckThroughDouble = false;
      g.factWriteThroughDouble = false;
      errors.mockRestore();
    }
    expect(usage().headlinesLost).toBe(1);
    expect(factAsks.length).toBeGreaterThan(0);
    for (const ask of factAsks) {
      expect(ask).toContain("Design 0:");
      expect(ask).not.toContain("Design 1:");
      expect(ask).not.toContain("Slow tables for the weekend crowd.");
    }
    expect(footerAsks.length).toBeGreaterThan(0);
    for (const ask of footerAsks) {
      expect(ask).toContain("footer item 0.0: WhatsApp 0803 555 0142");
      expect(ask).not.toContain("Weekend brunch tables");
    }
  });

  /* Round-15 code critic, finding 5 (J43): two headlines of stop words
     shared no content stem, so the claim check's rewrite "All for you"
     shipped beside "It's all for you". */
  it("J43: the claim check's rewrite 'All for you' beside 'It's all for you' is refused", async () => {
    const { isClaimCheckCall } = await import("./directions/fixtures");
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      if (isClaimCheckCall(o)) {
        const flagsOne = (o.prompt ?? "").includes("1.headline |");
        return {
          object: {
            unsupported: flagsOne
              ? [
                  {
                    id: "1.headline",
                    statement: "a promise",
                    rewrite: "All for you",
                  },
                ]
              : [],
          },
        };
      }
      return {
        object: {
          directions: [
            draftOf({ headline: "It's all for you", subheadline: "" }),
            contrastingDraft({ subheadline: "" }),
          ],
        },
      };
    });
    const g = globalThis as { claimCheckThroughDouble?: boolean };
    g.claimCheckThroughDouble = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await flagOff(() =>
        runBrief(
          "Promote our almond croissants to commuters before work. Brunch on weekends.",
          { image: { source: "none" } },
        ).then(() => undefined),
      );
    } finally {
      g.claimCheckThroughDouble = false;
      errors.mockRestore();
    }
    expect(headlines()[0]).toBe("It's all for you");
    expect(headlines()[1]).not.toBe("All for you");
    expect(usage().claimCheck.headlineRefusals).toEqual([
      expect.objectContaining({
        direction: 1,
        rewrite: "All for you",
        why: "its rewrite is the other design's headline",
      }),
    ]);
  });
});

/* Round 21, round-8 live critic finding 2 (HIGH): cafe s1 shipped "Three
   tasters. ₦6,000." with no "cold brew" anywhere, the name recorded in
   factsLeftOff. The fact writer gets one ask aimed at the name; a design
   still without it fails, and its sibling ships. */
describe("round 21: every delivered design names the offering", () => {
  const CAFE =
    "Our cold brew flight is on: three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500. Weekdays 8am to 6pm at the bar, 9 Akinola Street, Yaba. Ask for oat milk.";

  /* `named` is what the writer does on the ask aimed at the name: write
     it into the subheadline, or answer as it did before. */
  async function cafe(named: boolean) {
    const { isFactWriteCall } = await import("./directions/fixtures");
    const asks: string[] = [];
    generateObject.mockImplementation(async (o: { prompt?: string }) => {
      if (isFactWriteCall(o)) {
        const prompt = o.prompt ?? "";
        asks.push(prompt);
        const targeted = prompt.includes(
          "the design never says what it offers",
        );
        return {
          object: {
            rewrites: [
              {
                id: 1,
                subheadline:
                  targeted && named
                    ? "Our cold brew flight: three 150ml tasters for ₦6,000."
                    : "Weekdays 8am to 6pm at the bar.",
                footerLines: ["9 Akinola Street, Yaba"],
              },
            ],
          },
        };
      }
      return {
        object: {
          directions: [
            draftOf({
              layout: "banner-bottom",
              headline: "The Cold Brew Flight",
              subheadline: "Three 150ml tasters for ₦6,000.",
              cta: "Ask for oat milk",
              footerLines: ["9 Akinola Street, Yaba"],
              footerStyle: "text",
            }),
            contrastingDraft({
              layout: "split-left",
              headline: "Taste three ways",
              subheadline: "Three 150ml tasters for ₦6,000.",
              cta: "Ask for oat milk",
              footerLines: ["9 Akinola Street, Yaba"],
              footerStyle: "text",
            }),
          ],
        },
      };
    });
    readBrief.mockResolvedValue(
      readAnswer(
        [
          { kind: "price", text: "three 150ml tasters for ₦6,000" },
          { kind: "place", text: "9 Akinola Street, Yaba" },
        ],
        { kind: "product", phrase: "cold brew flight" },
      ),
    );
    const g = globalThis as { factWriteThroughDouble?: boolean };
    g.factWriteThroughDouble = true;
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await runBrief(CAFE, { image: { source: "none" } });
    } finally {
      g.factWriteThroughDouble = false;
      process.env.FEATURE_KO_IMAGERY = "1";
    }
    return asks;
  }

  it("cafe s1: a design that never names cold brew fails after one targeted ask; its sibling ships", async () => {
    const { OfferingNotNamedError } = await import("./run-design-directions");
    const asks = await cafe(false);
    const targeted = asks.filter((a) =>
      a.includes(
        'the design never says what it offers: name "cold brew flight"',
      ),
    );
    expect(targeted).toHaveLength(1);
    expect(targeted[0]).toContain("Design 1:");
    expect(targeted[0]).not.toContain("Design 0:");
    expect(delivered("row-2")).toBeUndefined();
    expect(failedRow("row-2")?.error).toBe(
      new OfferingNotNamedError("cold brew flight").message,
    );
    expect(delivered("row-1")?.spec?.headline).toBe("The Cold Brew Flight");
    expect(usage().offeringsLost).toBe(1);
    expect(usage().offeringRecovery).toEqual([
      expect.objectContaining({
        direction: 1,
        offering: "cold brew flight",
        named: false,
      }),
    ]);
  });

  it("a targeted ask that names it ships the design, named by the model", async () => {
    await cafe(true);
    expect(delivered("row-2")?.spec?.subheadline).toBe(
      "Our cold brew flight: three 150ml tasters for ₦6,000.",
    );
    expect(usage().offeringsLost).toBe(0);
    expect(usage().offeringRecovery).toEqual([
      expect.objectContaining({ direction: 1, named: true, why: null }),
    ]);
    expect(
      usage().factsLeftOff.filter(
        (l: { fact: string }) => l.fact === "cold brew flight",
      ),
    ).toEqual([]);
  });
});

describe("round 21: a text-led pair is two compositions", () => {
  it("event: stat-highlight and quote-card become a card and a centred poster", async () => {
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({ layout: "stat-highlight" }),
          contrastingDraft({ layout: "quote-card" }),
        ],
      },
    });
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      await run({ image: { source: "none" } });
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
    expect(delivered("row-1")?.spec?.layout).toBe("stat-highlight");
    expect(delivered("row-2")?.spec?.layout).toBe("hero-center");
  });
});

/* Round-9 live critic, cafe: quote-card and stat-highlight drew the photo
   at one crop in one place, recorded "the same photo in the same place"
   and shipped as a pair. The cafe photo is 5242 x 3744 with the bar and
   barista across its lower middle. */
describe("round 22: an upload pair is two compositions", () => {
  const CAFE =
    "Our cold brew flight is on: three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500. Weekdays 8am to 6pm at the bar, 9 Akinola Street, Yaba. Ask for oat milk.";

  async function cafePair() {
    const cafePhoto = await photo(1048, 749);
    loadDesignImage.mockResolvedValue({
      bytes: Buffer.from(cafePhoto),
      contentType: "image/png",
      width: 1048,
      height: 749,
    });
    lookAtPhoto.mockResolvedValue({
      description: "an espresso bar with a barista behind the machine",
      subject: { x: 0.29, y: 0.36, w: 0.62, h: 0.56 },
      face: null,
      heads: [
        { x: 0.53, y: 0.3, w: 0.06, h: 0.1 },
        { x: 0.76, y: 0.33, w: 0.08, h: 0.12 },
      ],
      items: ["an espresso machine", "a barista"],
    });
    const cafeDraft = {
      aspectRatio: "1:1" as const,
      cta: "Ask for oat milk",
      footerStyle: "text" as const,
      footerLines: [
        "Weekdays 8am to 6pm",
        "At the bar, 9 Akinola Street, Yaba",
      ],
    };
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({
            ...cafeDraft,
            layout: "quote-card",
            headline: "The Cold Brew Flight",
            subheadline: "Three 150ml tasters for ₦6,000.",
          }),
          contrastingDraft({
            ...cafeDraft,
            layout: "stat-highlight",
            headline: "Three Tasters. ₦6,000.",
            subheadline:
              "Cold brew flight: three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500.",
          }),
        ],
      },
    });
    await runBrief(CAFE, { image: { source: "upload", key: UPLOAD_KEY } });
  }

  it("cafe: the second direction leaves the card and puts the photo elsewhere", async () => {
    const { photoPlace } = await import("./directions/render");
    const { SAME_SHAPE_AS_SIBLING, SAME_COMPOSITION_AS_SIBLING } = await import(
      "./directions/subject-layout"
    );
    const { HEADLINE_NOT_LEADING } = await import("./directions/craft");
    softOn = { "split-left": HEADLINE_NOT_LEADING };
    choicesMade.length = 0;
    await cafePair();
    expect(
      choicesMade[1]?.considered.find((c) => c.layout === "stat-highlight"),
    ).toMatchObject({
      subjectFault: null,
      hard: null,
      soft: null,
      alike: true,
    });
    const first = delivered("row-1");
    const second = delivered("row-2");
    expect(first?.spec?.layout).toBe("quote-card");
    expect(["quote-card", "stat-highlight"]).not.toContain(
      second?.spec?.layout,
    );
    const places = [first, second].map((d) =>
      photoPlace(d?.document as Parameters<typeof photoPlace>[0]),
    );
    expect(places.every(Boolean)).toBe(true);
    expect(places[1]?.arrangement).not.toBe(places[0]?.arrangement);
    expect(usage().subjectFaults).not.toContainEqual(SAME_SHAPE_AS_SIBLING);
    expect(usage().subjectFaults).not.toContainEqual(
      SAME_COMPOSITION_AS_SIBLING,
    );
  });
});

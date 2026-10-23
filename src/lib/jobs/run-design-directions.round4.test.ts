// @vitest-environment node
/* Round-3 code critic's job probes (P1-P6), each now a regression test:
   the same harness, the real builders, layout choice, claim and fact
   coverage, and a gate double that applies a correction exactly as
   guardRender does, refusals included. */
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
vi.mock("@/lib/design/document/rasterize", () => ({
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
        acceptCorrection: (s: unknown) => boolean;
        refuseSecond?: (r: unknown) => boolean;
        onFirstRender?: () => void;
      },
    ) => {
      const first = await render(spec);
      opts.onFirstRender?.();
      const corrected = correctWith ? correctWith(spec) : null;
      if (!corrected) return { ...first, spec };
      if (!opts.acceptCorrection(corrected))
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
const { BRAND_ID, contrastingDraft, designPng, directionsContext, draftOf } =
  await import("./directions/fixtures");

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

describe("round-3 job probes", () => {
  /* P1: a kept correction emptied the footer of every fact the job drew in,
     and the metric still counted them delivered. */
  it("refuses a correction that loses the brief's facts, and measures every direction", async () => {
    const ctx = directionsContext({
      briefText:
        "Promote our almond croissants, ₦4,500 a box. Pickup Saturday from 7am. WhatsApp 0803 555 0142.",
    });
    correctWith = (spec) =>
      spec.headline === "Almond croissants for the commute"
        ? { ...spec, footerLines: [], footerStyle: "none" }
        : null;
    await generateDirectionsWork(
      {
        context: ctx,
        userId: "u1",
        sessionId: "s1",
        request: { image: { source: "ko" } } as never,
      },
      runtime as never,
    );
    const first = delivered("row-1");
    expect(first?.spec.footerLines.join(" ")).toContain("0803 555 0142");
    const m = usage();
    expect(m.correctionsKept).toBe(0);
    expect(m.briefFactsByDirection).toEqual([m.briefFacts, m.briefFacts]);
    expect(m.briefFactsDelivered).toBe(m.briefFacts);
    expect(m.factsLeftOff).toEqual([]);
  });

  /* P2: the builder called a correction "cropped" while its headline sat
     on the subject; the job trusted it. */
  it("refuses a corrected render that lays copy on the subject, by measurement", async () => {
    const subject = { x: 0.3, y: 0.35, w: 0.4, h: 0.4 };
    lookAtPhoto.mockResolvedValue({
      description: "almond croissants",
      subject,
      face: null,
      items: ["almond croissants"],
    });
    const longer = "Almond croissants before work";
    overlapHeadline = longer;
    correctWith = (spec) =>
      spec.headline === "Almond croissants for the commute"
        ? { ...spec, headline: longer }
        : null;
    await run({ image: { source: "upload", key: UPLOAD_KEY } });
    /* The correction was accepted and drawn (three renders), then refused
       on what the drawing measured. */
    expect(rasterizeDocument).toHaveBeenCalledTimes(3);
    const first = delivered("row-1");
    expect(first?.spec.headline).toBe("Almond croissants for the commute");
    const { measureSubject } = await import("@/lib/design/document/subject");
    expect(
      measureSubject(first?.document, { width: 600, height: 600 }, subject)
        ?.overlaps,
    ).toEqual([]);
    expect(usage().correctionsKept).toBe(0);
  });

  /* P3: only the head was kept clear; the headline lay across the tray and
     nothing was recorded. */
  it("records a fault when only a person's face is kept clear", async () => {
    const whole = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
    const face = { x: 0.42, y: 0.08, w: 0.16, h: 0.16 };
    coverWholeWider = 0.85;
    lookAtPhoto.mockResolvedValue({
      description: "a woman holding a tray of croissants",
      subject: whole,
      face,
      items: ["woman", "tray of croissants"],
    });
    await run({ image: { source: "upload", key: UPLOAD_KEY } });
    const { SUBJECT_FACE_ONLY } = await import("./directions/subject-layout");
    const m = usage();
    expect(m.subjectFaults).toEqual([SUBJECT_FACE_ONLY, SUBJECT_FACE_ONLY]);
    expect(m.qualityFaults).toBe(2);
    for (const id of ["row-1", "row-2"]) {
      expect(delivered(id)?.rationale.reasons.join(" ")).not.toMatch(
        /drawn whole/,
      );
    }
  });

  /* P4a and P4b: the plate checked for nothing, or for "a strawberry". */
  it.each([
    ["no name", ""],
    ["a name the brief does not use", "Strawberry Napoleon"],
  ])(
    "checks the plate for the brief's whole product with %s",
    async (_label, name) => {
      const ctx = directionsContext({
        briefText:
          "Launch our new strawberry mille-feuille. Fresh cream, crisp pastry layers. Order on WhatsApp.",
        title: "Strawberry mille-feuille launch",
      });
      generateObject.mockResolvedValue({
        object: {
          directions: [
            draftOf({
              productName: name,
              productLook: "",
              headline: "Layers worth the wait",
              subheadline: "Fresh cream between crisp pastry",
            }),
            contrastingDraft({
              productName: name,
              productLook: "",
              headline: "Strawberry season is here",
              subheadline: "Crisp pastry, fresh cream",
            }),
          ],
        },
      });
      await generateDirectionsWork(
        {
          context: ctx,
          userId: "u1",
          sessionId: "s1",
          request: { image: { source: "ko" } } as never,
        },
        runtime as never,
      );
      expect(checkPlateShowsProduct.mock.calls.map(([a]) => a.product)).toEqual(
        ["strawberry mille-feuille", "strawberry mille-feuille"],
      );
      for (const [input] of plateModel.generate.mock.calls) {
        expect(input.prompt).toMatch(/^A strawberry mille-feuille, /);
      }
      expect(usage().productSources).toEqual(["brief", "brief"]);
    },
  );

  it("records a plate it had no product to check as unchecked, and its image unverified", async () => {
    const ctx = directionsContext({
      briefText: "Wish our customers a happy new month from all of us.",
      title: "Happy new month",
    });
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({
            productName: "",
            productLook: "",
            headline: "Happy new month",
            rationale: [
              "The image shows the bakery counter",
              "Speaks to the new month",
            ],
          }),
          contrastingDraft({ productName: "", productLook: "" }),
        ],
      },
    });
    await generateDirectionsWork(
      {
        context: ctx,
        userId: "u1",
        sessionId: "s1",
        request: { image: { source: "ko" } } as never,
      },
      runtime as never,
    );
    expect(usage().plateChecks).toEqual(["unchecked", "unchecked"]);
    expect(delivered("row-1")?.rationale.reasons.join(" ")).not.toMatch(
      /image shows/i,
    );
  });

  /* P5: with every layout held it landed on a held one. */
  it("fails a regenerate rather than reuse a held layout", async () => {
    const now = Date.now();
    const mk = (
      id: string,
      slot: number,
      status: string,
      layout: string,
      ago: number,
    ) => ({
      id,
      brandId: BRAND_ID,
      status,
      spec: draftOf({ layout: layout as never }),
      createdAt: new Date(now - ago),
      rationale: { title: id, reasons: [], set: SET, slot },
    });
    const target = mk("old-1", 0, "succeeded", "hero-center", 3_600_000);
    const set = [
      target,
      mk("old-2", 1, "succeeded", "quote-card", 3_500_000),
      mk("p1", 1, "pending", "split-left", 60_000),
      mk("p2", 1, "pending", "banner-bottom", 50_000),
      mk("p3", 1, "pending", "stat-highlight", 40_000),
    ];
    getDesignGenerationById.mockResolvedValue(target);
    listDirectionSet.mockResolvedValue(set);
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({
            layout: "split-left",
            headline: "Give a box of almond joy",
          }),
        ],
      },
    });
    await expect(
      run({ image: { source: "ko" }, regenerateOf: "old-1" }),
    ).rejects.toThrow(/Every layout is already in use/);
    expect(updatesFor("row-1").some((p) => p.status === "succeeded")).toBe(
      false,
    );
  });

  /* P6: the footer drew "0803 555 0142 2", a number that does not exist,
     and lost the 2pm. */
  it("draws the brief's real phone number and its time", async () => {
    const ctx = directionsContext({
      briefText:
        "Promote our almond croissants. Call 0803 555 0142 2pm onwards.",
    });
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({ subheadline: "Call 0803 555 0142 to order" }),
          contrastingDraft({ subheadline: "Call 0803 555 0142 from 2pm" }),
        ],
      },
    });
    await generateDirectionsWork(
      {
        context: ctx,
        userId: "u1",
        sessionId: "s1",
        request: { image: { source: "ko" } } as never,
      },
      runtime as never,
    );
    for (const id of ["row-1", "row-2"]) {
      const spec = delivered(id)?.spec;
      const all = [spec.subheadline, ...spec.footerLines].join(" ");
      expect(all).not.toMatch(/0142 2(?!pm)/);
      expect(all).toMatch(/2pm/);
    }
    const m = usage();
    expect(m.briefFactsDelivered).toBe(m.briefFacts);
  });
});

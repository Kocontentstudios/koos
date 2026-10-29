// @vitest-environment node
/* Round-3 code critic's job probes (P1-P6), each now a regression test:
   the same harness, the real builders, layout choice, claim and fact
   coverage, and a gate double that applies a correction exactly as
   guardRender does, refusals included. */
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
        : isFactWriteCall(o)
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

describe("round-3 job probes", () => {
  /* P1: a kept correction emptied the footer of every fact the job drew in,
     and the metric still counted them delivered. */
  it("refuses a correction that loses the brief's facts, and measures every direction", async () => {
    const ctx = directionsContext({
      briefText:
        "Promote our almond croissants, ₦4,500 a box. Pickup Saturday from 7am. WhatsApp 0803 555 0142.",
    });
    readBrief.mockResolvedValue(
      readAnswer([
        { kind: "price", text: "₦4,500" },
        { kind: "day", text: "Saturday" },
        { kind: "time", text: "from 7am" },
        { kind: "contact", text: "WhatsApp 0803 555 0142" },
      ]),
    );
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
     nothing was recorded. Round 6: a direction with copy on the subject is
     not delivered at all, and the user is told why. */
  /* Round 8 (two are always delivered): only the head could be kept
     clear, so neither direction draws the photo with copy across the tray;
     both are laid out as text and the user is told. */
  it("never delivers copy on the subject when only a face is kept clear", async () => {
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
    for (const id of ["row-1", "row-2"]) {
      const doc = delivered(id)?.document as { elements: { type: string }[] };
      expect(doc.elements.some((e) => e.type === "image")).toBe(false);
    }
    expect(usage().textLedUpload).toBe(2);
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

  it("records a plate it had no product to check as a scene, and its image unverified", async () => {
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
    expect(usage().plateChecks).toEqual(["scene", "scene"]);
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
    /* The reader's span runs one digit past the number, the round-3
       glue; the settling cuts it at the number's end. */
    readBrief.mockResolvedValue(
      readAnswer([
        { kind: "contact", text: "Call 0803 555 0142 2" },
        { kind: "time", text: "2pm onwards" },
      ]),
    );
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

/* The round-4 code critic's job probes, J1 to J11, as the reader's answers
   would arrive: the reading is the model's, everything after it is code. */
describe("round-4 critic job probes", () => {
  it("J2: keeps a phone before a bare hour range, and draws both", async () => {
    readBrief.mockResolvedValue(
      readAnswer([
        { kind: "contact", text: "WhatsApp 0803 555 0142 9-5" },
        { kind: "time", text: "9-5" },
        { kind: "day", text: "daily" },
      ]),
    );
    await runBrief(
      "Promote our almond croissants. WhatsApp 0803 555 0142 9-5 daily.",
      { image: { source: "ko" } },
    );
    for (const id of ["row-1", "row-2"]) {
      expect(drawnOf(id)).toContain("WhatsApp 0803 555 0142");
      expect(drawnOf(id)).toContain("9-5");
    }
    const m = usage();
    expect(m.briefFacts).toBe(3);
    expect(m.briefFactsDelivered).toBe(3);
    expect(m.factsLeftOff).toEqual([]);
  });

  it("J3: never draws a digit glued to the number", async () => {
    readBrief.mockResolvedValue(
      readAnswer([
        { kind: "contact", text: "Call 08035550142, 9" },
        { kind: "time", text: "9-5" },
        { kind: "day", text: "weekdays" },
      ]),
    );
    await runBrief(
      "Promote our almond croissants. Call 08035550142, 9-5 weekdays.",
      { image: { source: "ko" } },
    );
    for (const id of ["row-1", "row-2"]) {
      expect(drawnOf(id)).not.toMatch(/08035550142, 9(?!-)/);
      expect(drawnOf(id)).toContain("Call 08035550142");
    }
    expect(usage().briefFactsDelivered).toBe(3);
  });

  it("J5: draws both numbers of a list", async () => {
    readBrief.mockResolvedValue(
      readAnswer([
        { kind: "contact", text: "Call 0803 555 0142" },
        { kind: "contact", text: "0805 555 0199" },
      ]),
    );
    await runBrief(
      "Promote our almond croissants. Call 0803 555 0142, 0805 555 0199.",
      { image: { source: "ko" } },
    );
    for (const id of ["row-1", "row-2"]) {
      expect(drawnOf(id)).toContain("0803 555 0142");
      expect(drawnOf(id)).toContain("0805 555 0199");
    }
  });

  it("J4: draws a handle as the handle", async () => {
    readBrief.mockResolvedValue(
      readAnswer([{ kind: "contact", text: "@cake.ng" }]),
    );
    await runBrief("Promote our almond croissants. DM @cake.ng on Instagram.", {
      image: { source: "ko" },
    });
    for (const id of ["row-1", "row-2"]) {
      expect(drawnOf(id)).toContain("@cake.ng");
    }
  });

  it("drops a reader's span that is not the brief's words, and records it", async () => {
    readBrief.mockResolvedValue(
      readAnswer([
        { kind: "place", text: "9 Bourdillon Road, Thursday" },
        { kind: "time", text: "8am" },
      ]),
    );
    await runBrief(
      "Promote our almond croissants at 9 Bourdillon Road, Thursday to Sunday.",
      { image: { source: "ko" } },
    );
    for (const id of ["row-1", "row-2"]) {
      expect(drawnOf(id)).not.toContain("Bourdillon Road, Thursday");
      expect(drawnOf(id)).toContain("9 Bourdillon Road");
      expect(drawnOf(id)).not.toContain("8am");
    }
    expect(usage().briefRead.dropped).toEqual([
      { text: "8am", why: "not the brief's own words" },
    ]);
  });

  /* J7: the subject box refused, a face found: the face was taken for the
     whole subject. */
  it("J7: records an unknown subject when only a face is found", async () => {
    lookAtPhoto.mockResolvedValue({
      description: "a woman holding a tray of croissants",
      subject: null,
      face: { x: 0.42, y: 0.08, w: 0.16, h: 0.16 },
      items: ["woman", "tray of croissants"],
    });
    await run({ image: { source: "upload", key: UPLOAD_KEY } });
    const { SUBJECT_UNKNOWN } = await import("./directions/subject-layout");
    const m = usage();
    expect(m.subjectFaults).toEqual([SUBJECT_UNKNOWN, SUBJECT_UNKNOWN]);
    expect(m.subjectUnknown).toBe(2);
    expect(m.qualityFaults).toBe(2);
    for (const id of ["row-1", "row-2"]) {
      expect(delivered(id)?.rationale.reasons.join(" ")).not.toMatch(
        /drawn whole/,
      );
    }
  });

  /* J8: the look at the upload was unavailable and nothing said so. */
  it("J8: records an unknown subject when the look at the photo failed", async () => {
    lookAtPhoto.mockResolvedValue(null);
    await run({ image: { source: "upload", key: UPLOAD_KEY } });
    const m = usage();
    expect(m.subjectUnknown).toBe(2);
    expect(m.qualityFaults).toBe(2);
  });

  /* J9: "Iced coffee" grew to the plate product "ice". */
  it("J9: paints and checks the plate for the reader's phrase", async () => {
    readBrief.mockResolvedValue(
      readAnswer([], { kind: "product", phrase: "cold brew" }),
    );
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({
            productName: "Iced coffee",
            headline: "Cold brew, poured",
          }),
          contrastingDraft({
            productName: "Iced coffee",
            headline: "Your cold brew is ready",
          }),
        ],
      },
    });
    await runBrief("Launch our new cold brew. Served over ice.", {
      image: { source: "ko" },
    });
    for (const [input] of plateModel.generate.mock.calls) {
      expect(input.prompt).toMatch(/^A cold brew, clearly recognisable/);
    }
    for (const [input] of checkPlateShowsProduct.mock.calls) {
      expect(input).toMatchObject({ product: "cold brew", kind: "product" });
    }
    expect(usage().productSources).toEqual(["read", "read"]);
  });

  /* Round-4 live critic: "sourdough baking class" was checked as an object,
     and two right plates were rejected twice. Round 6: an event is painted
     as the empty place it happens in, and checked for writing and people
     only. */
  it("paints an event's plate as an empty place and checks it for writing", async () => {
    readBrief.mockResolvedValue(
      readAnswer([], { kind: "event", phrase: "teen sourdough baking class" }),
    );
    await runBrief("Teen sourdough baking class this Saturday.", {
      image: { source: "ko" },
    });
    for (const [input] of plateModel.generate.mock.calls) {
      expect(input.prompt).toMatch(
        /^A soft-focus, close-up photograph of light and texture that suits the Teen sourdough baking class/i,
      );
    }
    for (const [input] of checkPlateShowsProduct.mock.calls) {
      expect(input).toMatchObject({ product: "" });
    }
    expect(usage().plateChecks).toEqual(["scene", "scene"]);
  });

  /* Round-4 live critic: event-ko shipped with half the canvas an empty
     orange gradient, and nobody was told. */
  it("lays a direction with no passing plate out as text, and tells the user", async () => {
    checkPlateShowsProduct.mockResolvedValue({
      shows: false,
      seen: "a loaf",
      subject: null,
      items: [],
      lettering: false,
      person: false,
    });
    generateObject.mockResolvedValue({
      object: {
        directions: [
          draftOf({ layout: "split-left" }),
          contrastingDraft({ layout: "banner-bottom" }),
        ],
      },
    });
    await run({ image: { source: "ko" } });
    const { TEXT_LED_LAYOUTS } = await import("./directions/subject-layout");
    for (const id of ["row-1", "row-2"]) {
      const doc = delivered(id)?.document;
      expect(TEXT_LED_LAYOUTS).toContain(delivered(id)?.spec.layout);
      expect(
        doc.elements.some((e: { id: string }) => e.id === "accent-panel"),
      ).toBe(false);
    }
    const m = usage();
    expect(m.textLed).toBe(2);
    expect(plateModel.generate).toHaveBeenCalledTimes(4);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          message: expect.stringMatching(
            /^Both directions were laid out with words only/,
          ),
        },
      }),
    );
  });

  /* Round-3 and round-4 critics: a painted woman stood beside "with Ada
     Obi". */
  it("refuses a plate with a face when the brief names a person", async () => {
    readBrief.mockResolvedValue(
      readAnswer([], { kind: "event", phrase: "panel" }, ["Ada Obi"]),
    );
    checkPlateShowsProduct.mockResolvedValue({
      shows: true,
      seen: "a woman at a lectern",
      subject: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 },
      items: [],
      lettering: false,
      person: true,
    });
    await runBrief("Announce our panel with Ada Obi on Friday.", {
      image: { source: "ko" },
    });
    for (const [input] of plateModel.generate.mock.calls) {
      expect(input.negativePrompt).toMatch(/people, person, face/);
    }
    expect(usage().plateChecks).toEqual(["failed-people", "failed-people"]);
    expect(usage().textLed).toBe(2);
  });

  /* Round-4 live critic: on one photo both cafe directions put it on top
     with the copy below. */
  it("draws one photo in two different places, or says why not", async () => {
    lookAtPhoto.mockResolvedValue({
      description: "a cup on a bar",
      subject: { x: 0.4, y: 0.35, w: 0.2, h: 0.25 },
      face: null,
      items: ["a cup"],
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
    const { photoPlace } = await import("./directions/render");
    const { SAME_SHAPE_AS_SIBLING } = await import(
      "./directions/subject-layout"
    );
    const [a, b] = ["row-1", "row-2"].map((id) =>
      photoPlace(delivered(id)?.document),
    );
    const faults = usage().subjectFaults as (string | null)[];
    expect(
      a?.arrangement !== b?.arrangement ||
        faults.includes(SAME_SHAPE_AS_SIBLING),
    ).toBe(true);
  });
});

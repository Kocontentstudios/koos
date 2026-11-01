// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* KOOS-AI-002 gate tests for the set-of-frames job. The planner (U1) is
   mocked: these pin what the job does with a plan, not what a plan says.
   Layout choice, the document builders and the gate run for real; only the
   pixels (rasterizeDocument) and the outside world are doubled. */

process.env.FEATURE_MULTI_FRAME = "1";
process.env.FEATURE_KO_IMAGERY = "1";

interface Row {
  id: string;
  brandId: string;
  setId: string | null;
  frameIndex: number | null;
  frameCount: number | null;
  supersededBy: string | null;
  status: string;
  spec: Record<string, unknown>;
  document: unknown;
  rationale: unknown;
  imageSource: string | null;
  sourceImageKey: string | null;
  designType: string | null;
  createdAt: Date;
  [key: string]: unknown;
}

const db = {
  rows: new Map<string, Row>(),
  sets: new Map<string, Record<string, unknown>>(),
  usage: [] as { metadata: Record<string, unknown>; [k: string]: unknown }[],
  clock: 0,
  /** recordUsageEvent calls to fail, as a killed slice's would. */
  billFailures: 0,
};

const planSequence = vi.fn();
const replanFrame = vi.fn();
const rasterizeDocument = vi.fn();
const lookAtPhoto = vi.fn();
const loadDesignImage = vi.fn();
const captureServerEvent = vi.fn();
const createNotification = vi.fn();
const uploadObject = vi.fn();
const loadBestLogo = vi.fn();
const supersedeFrame = vi.fn();
const replaceDesignSetBeat = vi.fn();
const getPlateAdapter = vi.fn();
const paletteForCutout = vi.fn();
const judgeAndCorrect = vi.fn();
const failAbandonedDesignJobs = vi.fn();
const validateApprovedOutline = vi.fn();

vi.mock("@/lib/design/sequence/plan", async (importOriginal) => ({
  SequenceShipRefusedError: (
    await importOriginal<typeof import("@/lib/design/sequence/plan")>()
  ).SequenceShipRefusedError,
  planSequence: (input: unknown) => planSequence(input),
}));
vi.mock("@/lib/design/sequence/outline-validate", () => ({
  validateApprovedOutline: (raw: unknown, ctx: unknown) =>
    validateApprovedOutline(raw, ctx),
}));
vi.mock("@/lib/design/sequence/replan", () => ({
  replanFrame: (input: unknown, deps: unknown) => replanFrame(input, deps),
}));
vi.mock("@/lib/design/sequence/frame-spec", async () => {
  const { designSpecOf } = await import("./directions/schema");
  const { draftOf } = await import("./directions/fixtures");
  return {
    frameSpec: (
      plan: import("@/lib/design/sequence/contract").PlannedSequence,
      index: number,
    ) => {
      const beat = plan.frames[index];
      return designSpecOf(
        draftOf({
          layout: beat.layout,
          headline: beat.headline,
          subheadline: beat.subheadline,
          cta: beat.cta,
          footerLines: beat.footerLines,
          footerStyle: plan.footerStyle,
          palette: plan.palette,
          logoPlacement: plan.logoPlacement,
          logoFree: plan.logoFree,
          logoFreeQuote: plan.logoFreeQuote,
          backgroundPrompt: beat.backgroundPrompt,
          backgroundTreatment: plan.backgroundTreatment,
          aspectRatio: plan.aspectRatio,
        }),
      );
    },
  };
});
vi.mock("./directions/craft", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  paletteForCutout: (spec: unknown, facts: unknown) =>
    paletteForCutout(spec, facts),
}));
vi.mock("@/lib/design/quality/judge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  judgeAndCorrect: (args: unknown) => judgeAndCorrect(args),
}));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));
vi.mock("@/lib/ai/memory", () => ({ buildMemoryBlock: async () => "" }));
vi.mock("@/lib/ai/image", () => ({
  getPlateAdapter: () => getPlateAdapter(),
  getNativeAdapters: () => [],
}));
vi.mock("@/lib/db/queries", () => ({
  createDesignGeneration: async (row: Partial<Row>) => {
    const created: Row = {
      id: `row-${db.rows.size + 1}`,
      supersededBy: null,
      document: null,
      setId: null,
      frameIndex: null,
      frameCount: null,
      imageSource: null,
      sourceImageKey: null,
      designType: null,
      status: "pending",
      spec: {},
      rationale: null,
      brandId: "",
      ...row,
      createdAt: new Date(1_000_000 + db.clock++),
    } as Row;
    db.rows.set(created.id, created);
    return created;
  },
  updateDesignGeneration: async (id: string, patch: Partial<Row>) => {
    const row = db.rows.get(id);
    if (row) db.rows.set(id, { ...row, ...patch });
  },
  getDesignGenerationById: async (id: string) => db.rows.get(id) ?? null,
  listSetFrames: async (brandId: string, setId: string) =>
    [...db.rows.values()]
      .filter((r) => r.brandId === brandId && r.setId === setId)
      .sort(
        (a, b) =>
          (a.frameIndex ?? 0) - (b.frameIndex ?? 0) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      ),
  supersedeFrame: async (id: string, by: string) => {
    supersedeFrame(id, by);
    const row = db.rows.get(id);
    if (row) db.rows.set(id, { ...row, supersededBy: by });
  },
  createDesignSet: async (set: { id: string }) => {
    if (!db.sets.has(set.id)) db.sets.set(set.id, set);
  },
  getDesignSet: async (brandId: string, id: string) => {
    const set = db.sets.get(id);
    return set && set.brandId === brandId ? set : null;
  },
  replaceDesignSetBeat: async (id: string, index: number, beat: unknown) =>
    replaceDesignSetBeat(id, index, beat),
  listBilledSetGenerations: async (_brandId: string, setId: string) =>
    db.usage
      .filter((u) => u.metadata.setId === setId)
      .map((u) => u.metadata.generationId as string),
  recordUsageEvent: async (event: { metadata: Record<string, unknown> }) => {
    if (db.billFailures > 0) {
      db.billFailures -= 1;
      throw new Error("connection reset");
    }
    db.usage.push(event);
  },
  annotateSetUsage: async (
    _brandId: string,
    setId: string,
    patch: Record<string, unknown>,
  ) => {
    for (const u of db.usage) {
      if (u.metadata.setId === setId && u.metadata.regenerateOf == null) {
        u.metadata = { ...u.metadata, ...patch };
      }
    }
  },
  failPendingGeneration: async (id: string, error: string) => {
    const row = db.rows.get(id);
    if (row?.status === "pending") {
      db.rows.set(id, { ...row, status: "failed", error } as Row);
    }
  },
  failAbandonedDesignJobs: (...args: unknown[]) =>
    failAbandonedDesignJobs(...args),
  createNotification: (input: unknown) => createNotification(input),
  listDesignGenerationsForBrand: async () => [],
  updateGenerationJob: vi.fn(),
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
vi.mock("@/lib/design/quality/plate-check", () => ({
  checkPlateShowsProduct: vi.fn(),
  lookAtPhoto: (bytes: unknown) => lookAtPhoto(bytes),
}));
vi.mock("@/lib/design/render/logo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBestLogo: (args: unknown) => loadBestLogo(args),
}));

const {
  ApprovedOutlineError,
  FrameBusyError,
  FrameTargetError,
  frameCorrectionKeeps,
  framesTextLedMessage,
  frameToReplace,
  generateSequenceWork,
  heldByNeighbours,
  regenerateFrameWork,
  renderWaves,
  SequencePlanError,
  setFactsMissing,
  settleFrameJobOnFailure,
  settleSetOnFailure,
  sweepAbandonedDesignSets,
  ABANDONED_SET_ERROR,
} = await import("./run-design-sequence");
const { SequenceShipRefusedError } = await import("@/lib/design/sequence/plan");
const { ABANDONED_SET_MS } = await import("./stale");
const craft =
  await vi.importActual<typeof import("./directions/craft")>(
    "./directions/craft",
  );
const { LOGO_NOT_LEGIBLE } = await import("@/lib/design/logo-contrast");
const { JobPausedError } = await import("./run-generation");
const { MultiFrameDisabledError } = await import(
  "@/lib/design/multi-frame-flag"
);
const { BRAND_ID, designPng, directionsContext } = await import(
  "./directions/fixtures"
);
type PlannedSequence = import("@/lib/design/sequence/contract").PlannedSequence;
type FrameBeat = import("@/lib/design/sequence/contract").FrameBeat;
type DesignSpec = import("@/lib/design/spec").DesignSpec;

const PALETTE = {
  background: "#FFF4E6",
  foreground: "#3B2416",
  accent: "#C2410C",
};
const UPLOAD_KEY = `design-images/${BRAND_ID}/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.png`;
const TEXT_LAYOUTS = ["hero-center", "quote-card", "stat-highlight"] as const;

/* A real opaque photograph: a header-only PNG decodes as an empty cut-out,
   whose subject box is refused (subject.ts). */
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
const UPLOADED_PHOTO = await photo(600, 600);

function beat(i: number, n: number, over: Partial<FrameBeat> = {}): FrameBeat {
  const role = i === 0 ? "hook" : i === n - 1 ? "cta" : "body";
  return {
    role,
    title: `Frame ${i + 1}`,
    headline: [
      "Almond croissants, baked at dawn",
      "Butter from one farm",
      "Flaked almonds, toasted twice",
      "Ready before your commute",
      "Six hundred naira each",
      "Pick up on Admiralty Way",
      "Open from six every day",
      "Order ahead, skip the queue",
      "Fresh every single morning",
      "Order your box today",
    ][i % 10],
    subheadline: i === 0 ? "Crumb & Co. in Lekki" : "",
    cta: role === "cta" ? "Order for pickup" : "",
    footerLines: [],
    layout: TEXT_LAYOUTS[i % 3],
    showsImage: i % 2 === 0,
    backgroundPrompt: "a bakery counter at dawn",
    ...over,
  };
}

function planOf(n: number, frames?: FrameBeat[]): PlannedSequence {
  return {
    kind: "carousel",
    palette: PALETTE,
    logoPlacement: "top-right",
    logoFree: false,
    logoFreeQuote: "",
    backgroundTreatment: "photographic",
    footerStyle: "none",
    aspectRatio: "4:5",
    frames: frames ?? Array.from({ length: n }, (_, i) => beat(i, n)),
  };
}

function planned(plan: PlannedSequence, over: Record<string, unknown> = {}) {
  return {
    plan,
    facts: [],
    offering: null,
    problems: [],
    faults: [],
    invented: [],
    factsDrawn: [],
    modelCalls: 1,
    repaired: false,
    ...over,
  };
}

function runtimeWith(
  checkpoint: Record<string, unknown> = {},
  shouldPause: () => boolean = () => false,
) {
  const progress: { label: string; done: number; total: number }[] = [];
  return {
    progress,
    runtime: {
      jobId: "job-1",
      reportProgress: (p: (typeof progress)[number]) => progress.push(p),
      checkpoint,
      saveCheckpoint: vi.fn(async (partial: Record<string, unknown>) => {
        Object.assign(checkpoint, partial);
      }),
      shouldPause,
    },
  };
}

const carouselContext = (over: Record<string, unknown> = {}) =>
  directionsContext({ designType: "Instagram Carousel", slides: 4, ...over });

function run(
  frames: number,
  image: Record<string, unknown> = { source: "none" },
  runtime = runtimeWith().runtime,
  context = carouselContext(),
) {
  return generateSequenceWork(
    {
      context,
      userId: "u1",
      sessionId: "s1",
      request: { image: image as never, frames },
    },
    runtime as never,
  );
}

const frameRows = () =>
  [...db.rows.values()]
    .filter((r) => r.setId)
    .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0));
const headlineOf = (row: Row) =>
  (row.document as { elements: { role?: string; text?: string }[] }).elements
    .filter((e) => e.role === "headline")
    .map((e) => e.text)
    .join(" ");

let logSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FEATURE_MULTI_FRAME = "1";
  db.rows.clear();
  db.sets.clear();
  db.usage.length = 0;
  db.clock = 0;
  db.billFailures = 0;
  planSequence.mockImplementation(async (input: { frameCount: number }) =>
    planned(planOf(input.frameCount)),
  );
  validateApprovedOutline.mockImplementation((raw: unknown) => ({
    ok: true,
    outline: raw,
  }));
  uploadObject.mockResolvedValue(undefined);
  loadBestLogo.mockResolvedValue({ logo: null, fault: null });
  createNotification.mockResolvedValue(undefined);
  lookAtPhoto.mockResolvedValue(null);
  getPlateAdapter.mockReturnValue(null);
  paletteForCutout.mockImplementation(craft.paletteForCutout);
  judgeAndCorrect.mockResolvedValue(null);
  loadDesignImage.mockImplementation(async () => ({
    bytes: Buffer.from(UPLOADED_PHOTO),
    contentType: "image/png",
    width: 600,
    height: 600,
  }));
  rasterizeDocument.mockImplementation(async (input: { doc: unknown }) => ({
    bytes: designPng(1080, 1350),
    contentType: "image/png",
    width: 1080,
    height: 1350,
    document: input.doc,
    logoFault: null,
    brandFontFault: null,
  }));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("a set of frames", () => {
  it("delivers exactly the frames asked for, in order, one row each", async () => {
    const outcome = await run(4);
    const rows = frameRows();
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.frameIndex)).toEqual([0, 1, 2, 3]);
    const setId = rows[0].setId;
    for (const row of rows) {
      expect(row).toMatchObject({
        setId,
        frameCount: 4,
        status: "succeeded",
        imageSource: "none",
      });
    }
    expect(outcome.result).toEqual({
      kind: "sequence",
      setId,
      sequenceKind: "carousel",
      frameCount: 4,
      generationIds: rows.map((r) => r.id),
      failed: [],
      imageSource: "none",
    });
    expect(outcome.resultId).toBe(rows[0].id);
  });

  it("stores each frame's rationale as frameRationale: role and title, no set", async () => {
    await run(3);
    expect(frameRows().map((r) => r.rationale)).toEqual([
      { title: "Frame 1", reasons: [], role: "hook" },
      { title: "Frame 2", reasons: [], role: "body" },
      { title: "Frame 3", reasons: [], role: "cta" },
    ]);
  });

  it("draws every frame in the one palette of the set", async () => {
    await run(5);
    const palettes = frameRows().map((r) => JSON.stringify(r.spec.palette));
    expect(new Set(palettes).size).toBe(1);
    expect(JSON.parse(palettes[0])).toEqual(PALETTE);
  });

  it("draws a presentation at 16:9 whatever the plan said", async () => {
    planSequence.mockResolvedValue(
      planned({ ...planOf(3), kind: "presentation", aspectRatio: "4:5" }),
    );
    const outcome = await run(
      3,
      { source: "none" },
      runtimeWith().runtime,
      carouselContext({ designType: "Pitch deck" }),
    );
    expect(outcome.result.sequenceKind).toBe("presentation");
    expect(frameRows().map((r) => r.spec.aspectRatio)).toEqual([
      "16:9",
      "16:9",
      "16:9",
    ]);
  });

  it("never gives two neighbouring frames the same layout, even when the plan does", async () => {
    planSequence.mockResolvedValue(
      planned(
        planOf(
          4,
          Array.from({ length: 4 }, (_, i) =>
            beat(i, 4, { layout: "hero-center" }),
          ),
        ),
        {
          problems: [
            { frame: 1, rule: "layout-repeat", detail: "same as frame 0" },
          ],
        },
      ),
    );
    await run(4);
    const layouts = frameRows().map((r) => r.spec.layout);
    for (let i = 1; i < layouts.length; i += 1) {
      expect(layouts[i]).not.toBe(layouts[i - 1]);
    }
  });

  it("draws the copy the plan wrote, and the button only on the last frame", async () => {
    await run(3);
    const rows = frameRows();
    expect(rows.map(headlineOf)).toEqual([
      "Almond croissants, baked at dawn",
      "Butter from one farm",
      "Flaked almonds, toasted twice",
    ]);
    const buttons = rows.map(
      (r) =>
        (r.document as { elements: { type: string }[] }).elements.filter(
          (e) => e.type === "button",
        ).length,
    );
    expect(buttons).toEqual([0, 0, 1]);
  });

  it("reports progress as frame k of N", async () => {
    const { runtime, progress } = runtimeWith();
    await run(3, { source: "none" }, runtime);
    const labels = progress.map((p) => p.label);
    expect(labels).toContain("Planning 3 frames…");
    for (const k of [1, 2, 3]) {
      expect(labels).toContain(`Frame ${k} of 3…`);
    }
    expect(progress.every((p) => p.total === 3)).toBe(true);
  });

  it("refuses with the flag off, before planning", async () => {
    process.env.FEATURE_MULTI_FRAME = "";
    await expect(run(3)).rejects.toBeInstanceOf(MultiFrameDisabledError);
    expect(planSequence).not.toHaveBeenCalled();
    expect(db.rows.size).toBe(0);
  });

  it("fails a plan that breaks the set's promise before any row or charge", async () => {
    planSequence.mockResolvedValue(
      planned(planOf(3), {
        problems: [{ frame: 2, rule: "cta-last", detail: "no action" }],
      }),
    );
    await expect(run(3)).rejects.toBeInstanceOf(SequencePlanError);
    expect(db.rows.size).toBe(0);
    expect(db.usage).toHaveLength(0);
  });

  it("turns a planner refusal into a plan error naming the slide, before any row or charge", async () => {
    planSequence.mockRejectedValue(
      new SequenceShipRefusedError([
        {
          frame: 1,
          detail: "it makes frame 1's point again in other words",
        },
      ]),
    );
    const err = await run(3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SequencePlanError);
    expect((err as InstanceType<typeof SequencePlanError>).problems).toEqual([
      {
        frame: 1,
        rule: "blocking-fault",
        detail: "it makes frame 1's point again in other words",
      },
    ]);
    expect((err as Error).message).toBe(
      "We couldn't write slide 2 of this carousel without repeating another slide or going beyond your brief. Change point 2 in the outline, or try again.",
    );
    expect(db.rows.size).toBe(0);
    expect(db.usage).toHaveLength(0);
  });

  it("fails a plan with the wrong number of frames", async () => {
    planSequence.mockResolvedValue(planned(planOf(2)));
    await expect(run(3)).rejects.toBeInstanceOf(SequencePlanError);
    expect(db.rows.size).toBe(0);
  });

  it("delivers and bills the frames left when the planner dropped one, and reports it", async () => {
    planSequence.mockResolvedValue(planned(planOf(3), { framesDropped: [2] }));
    const outcome = await run(4);
    const rows = frameRows();
    expect(rows.map((r) => r.frameIndex)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.frameCount === 3)).toBe(true);
    expect(db.usage).toHaveLength(3);
    expect(outcome.result).toMatchObject({
      frameCount: 3,
      framesDropped: [2],
    });
  });

  it("still fails a short plan that reports no drop", async () => {
    planSequence.mockResolvedValue(planned(planOf(3), { framesDropped: [] }));
    await expect(run(4)).rejects.toBeInstanceOf(SequencePlanError);
    expect(db.rows.size).toBe(0);
  });

  it("draws the client's photo only on frames that show the image", async () => {
    await run(4, { source: "upload", key: UPLOAD_KEY });
    const imageKeys = frameRows().map((r) =>
      (
        r.document as { elements: { type: string; asset?: { key: string } }[] }
      ).elements
        .filter((e) => e.type === "image")
        .map((e) => e.asset?.key),
    );
    expect(imageKeys).toEqual([[UPLOAD_KEY], [], [UPLOAD_KEY], []]);
    expect(loadDesignImage).toHaveBeenCalledWith(UPLOAD_KEY, BRAND_ID);
    expect(new Set(frameRows().map((r) => r.sourceImageKey))).toEqual(
      new Set([UPLOAD_KEY]),
    );
  });
});

describe("billing and traces", () => {
  it("records one design_generated usage row per delivered frame", async () => {
    await run(4);
    const rows = frameRows();
    expect(db.usage).toHaveLength(4);
    for (const row of rows) {
      const usage = db.usage.filter((u) => u.metadata.generationId === row.id);
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({
        userId: "u1",
        brandId: BRAND_ID,
        kind: "design_generated",
      });
      expect(usage[0].metadata).toMatchObject({
        setId: row.setId,
        frameIndex: row.frameIndex,
        frameCount: 4,
        generationId: row.id,
        delivered: 4,
        failed: 0,
        jobFailed: false,
      });
    }
  });

  it("records what the planner shipped unvouched and what it wrote in itself (round-4 critic, HIGH 2)", async () => {
    planSequence.mockResolvedValue(
      planned(planOf(3), {
        invented: [{ frame: 1, text: "gone" }],
        factsDrawn: ["5pm to 9pm"],
      }),
    );
    await run(3);
    expect(db.usage[0].metadata).toMatchObject({
      planInvented: ["frame 2: gone"],
      planFactsDrawn: ["5pm to 9pm"],
    });
  });

  it("bills each frame as it lands, before the set completes", async () => {
    const billedWhenDrawn: number[] = [];
    rasterizeDocument.mockImplementation(async (input: { doc: unknown }) => {
      billedWhenDrawn.push(db.usage.length);
      return {
        bytes: designPng(1080, 1350),
        contentType: "image/png",
        width: 1080,
        height: 1350,
        document: input.doc,
        logoFault: null,
        brandFontFault: null,
      };
    });
    await run(3);
    expect(billedWhenDrawn[billedWhenDrawn.length - 1]).toBe(2);
  });

  it("keeps the trace line and event to one each when a completed slice is resumed", async () => {
    const checkpoint: Record<string, unknown> = {};
    await run(3, { source: "none" }, runtimeWith(checkpoint).runtime);
    expect(checkpoint.completed).toBe(true);
    const outcome = await run(
      3,
      { source: "none" },
      runtimeWith(checkpoint).runtime,
    );
    const lines = logSpy.mock.calls
      .map(([line]: unknown[]) => String(line))
      .filter((line: string) => line.startsWith("design.sequence.completed "));
    expect(lines).toHaveLength(1);
    expect(
      captureServerEvent.mock.calls.filter(
        ([e]) => (e as { event: string }).event === "design_sequence_generated",
      ),
    ).toHaveLength(1);
    expect(outcome.result.generationIds).toEqual(frameRows().map((r) => r.id));
  });

  it("tells the user when the count asked for was clamped", async () => {
    const { runtime, progress } = runtimeWith();
    await generateSequenceWork(
      {
        context: carouselContext(),
        userId: "u1",
        sessionId: "s1",
        request: { image: { source: "none" }, frames: 10, asked: 14 },
      },
      runtime as never,
    );
    expect(progress[0].label).toBe(
      "Planning 10 frames… You asked for 14 frames; a carousel holds at most 10, so this one has 10.",
    );
  });

  it("logs one design.sequence.completed line with the outcome", async () => {
    await run(3);
    const lines = logSpy.mock.calls
      .map(([line]: unknown[]) => String(line))
      .filter((line: string) => line.startsWith("design.sequence.completed "));
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(
      lines[0].slice("design.sequence.completed ".length),
    );
    expect(payload).toMatchObject({
      setId: frameRows()[0].setId,
      requested: 3,
      delivered: 3,
      failed: 0,
    });
    expect(typeof payload.ms).toBe("number");
  });

  it("captures design_sequence_generated", async () => {
    await run(3);
    expect(captureServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "u1",
        event: "design_sequence_generated",
        properties: expect.objectContaining({
          requested: 3,
          delivered: 3,
          failed: 0,
          kind: "carousel",
        }),
      }),
    );
  });

  it("measures fact coverage across the drawn frames, not per frame", async () => {
    const facts = [
      { kind: "price", text: "₦600", needs: ["600"] },
      { kind: "place", text: "Admiralty Way", needs: ["admiralty"] },
      { kind: "date", text: "Saturday 5 December", needs: ["5", "december"] },
    ];
    const frames = Array.from({ length: 3 }, (_, i) => beat(i, 3));
    frames[1] = { ...frames[1], headline: "Only ₦600 a box" };
    frames[2] = { ...frames[2], subheadline: "On Admiralty Way" };
    planSequence.mockResolvedValue(planned(planOf(3, frames), { facts }));
    await run(3);
    const metadata = db.usage[0].metadata;
    expect(metadata.setFactsMissing).toEqual(["Saturday 5 December"]);
    expect(metadata.setFaults).toEqual([
      "the set leaves off 1 of the brief's 3 facts",
    ]);
  });
});

describe("a frame that fails", () => {
  it("marks its row failed and delivers and bills the rest", async () => {
    let calls = 0;
    rasterizeDocument.mockImplementation(async (input: { doc: unknown }) => {
      calls += 1;
      if (calls === 2) throw new Error("render worker crashed");
      return {
        bytes: designPng(1080, 1350),
        contentType: "image/png",
        width: 1080,
        height: 1350,
        document: input.doc,
        logoFault: null,
        brandFontFault: null,
      };
    });
    const outcome = await run(4);
    const rows = frameRows();
    const failed = rows.filter((r) => r.status === "failed");
    expect(failed).toHaveLength(1);
    expect(outcome.result.failed).toEqual([failed[0].id]);
    expect(outcome.result.generationIds).toHaveLength(3);
    expect(db.usage).toHaveLength(3);
    expect(db.usage.map((u) => u.metadata.generationId)).not.toContain(
      failed[0].id,
    );
    expect(db.usage[0].metadata.setFaults).toContain("1 of 4 frames failed");
  });

  it("fails the job, billing nothing, when no frame is delivered", async () => {
    rasterizeDocument.mockRejectedValue(new Error("render worker crashed"));
    await expect(run(3)).rejects.toThrow("render worker crashed");
    expect(db.usage).toHaveLength(0);
    expect(frameRows().every((r) => r.status === "failed")).toBe(true);
  });
});

describe("resuming a set past the slice deadline (H8)", () => {
  it("pauses with frames left, then renders only those, never planning again", async () => {
    const checkpoint: Record<string, unknown> = {};
    let paused = false;
    const first = runtimeWith(checkpoint, () => paused);
    rasterizeDocument.mockImplementation(async (input: { doc: unknown }) => {
      paused = true;
      return {
        bytes: designPng(1080, 1350),
        contentType: "image/png",
        width: 1080,
        height: 1350,
        document: input.doc,
        logoFault: null,
        brandFontFault: null,
      };
    });
    await expect(
      run(5, { source: "none" }, first.runtime),
    ).rejects.toBeInstanceOf(JobPausedError);
    const afterFirst = rasterizeDocument.mock.calls.length;
    const deliveredFirst = frameRows().filter((r) => r.status === "succeeded");
    expect(deliveredFirst.length).toBeGreaterThan(0);
    expect(deliveredFirst.length).toBeLessThan(5);
    /* A paused slice has already paid for what it put on show: a set no
       poll ever resumes is not free (H7). */
    expect(db.usage.map((u) => u.metadata.generationId).sort()).toEqual(
      deliveredFirst.map((r) => r.id).sort(),
    );
    expect(checkpoint.setId).toBe(frameRows()[0].setId);
    expect(checkpoint.plan).toBeTruthy();

    paused = false;
    const second = runtimeWith(checkpoint, () => false);
    const outcome = await run(5, { source: "none" }, second.runtime);

    expect(planSequence).toHaveBeenCalledTimes(1);
    expect(rasterizeDocument.mock.calls.length - afterFirst).toBe(
      5 - deliveredFirst.length,
    );
    const rows = frameRows();
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.status === "succeeded")).toBe(true);
    expect(outcome.result.generationIds).toEqual(rows.map((r) => r.id));
    expect(db.usage).toHaveLength(5);
    expect(new Set(db.usage.map((u) => u.metadata.generationId)).size).toBe(5);
  });

  it("does not render a frame that already failed in an earlier slice", async () => {
    const checkpoint: Record<string, unknown> = {};
    let paused = false;
    let calls = 0;
    rasterizeDocument.mockImplementation(async (input: { doc: unknown }) => {
      calls += 1;
      paused = true;
      if (calls === 1) throw new Error("render worker crashed");
      return {
        bytes: designPng(1080, 1350),
        contentType: "image/png",
        width: 1080,
        height: 1350,
        document: input.doc,
        logoFault: null,
        brandFontFault: null,
      };
    });
    await expect(
      run(4, { source: "none" }, runtimeWith(checkpoint, () => paused).runtime),
    ).rejects.toBeInstanceOf(JobPausedError);
    const failedIndex = frameRows().find(
      (r) => r.status === "failed",
    )?.frameIndex;
    expect(failedIndex).not.toBeUndefined();
    const before = calls;
    const settledFirst = frameRows().filter(
      (r) => r.status !== "pending",
    ).length;
    paused = false;
    await run(4, { source: "none" }, runtimeWith(checkpoint).runtime);
    expect(calls - before).toBe(4 - settledFirst);
    expect(frameRows().find((r) => r.frameIndex === failedIndex)?.status).toBe(
      "failed",
    );
  });

  it("never bills a frame twice when a completed set is run again", async () => {
    const checkpoint: Record<string, unknown> = {};
    await run(3, { source: "none" }, runtimeWith(checkpoint).runtime);
    expect(db.usage).toHaveLength(3);
    await run(3, { source: "none" }, runtimeWith(checkpoint).runtime);
    expect(db.usage).toHaveLength(3);
    expect(planSequence).toHaveBeenCalledTimes(1);
  });
});

describe("renderWaves and heldByNeighbours", () => {
  it("never puts two neighbours in one wave", () => {
    expect(renderWaves([0, 1, 2, 3, 4])).toEqual([
      [0, 2, 4],
      [1, 3],
    ]);
    expect(renderWaves([1, 3])).toEqual([[1, 3]]);
    expect(renderWaves([])).toEqual([]);
  });

  it("holds a neighbour's drawn layout over its planned one", () => {
    const planned = [
      { layout: "hero-center" },
      { layout: "quote-card" },
      { layout: "stat-highlight" },
    ];
    expect(heldByNeighbours(1, new Map([[0, "split-left"]]), planned)).toEqual([
      "split-left",
      "stat-highlight",
    ]);
    expect(heldByNeighbours(0, new Map(), planned)).toEqual(["quote-card"]);
    expect(heldByNeighbours(2, new Map(), planned)).toEqual(["quote-card"]);
  });

  it("covers a fact when any one frame states it", () => {
    const fact = { kind: "price" as const, text: "₦600", needs: ["600"] };
    expect(
      setFactsMissing(
        [fact],
        [
          { headline: "Fresh croissants", footerLines: [] },
          { headline: "Only ₦600", footerLines: [] },
        ],
      ),
    ).toEqual([]);
    expect(
      setFactsMissing([fact], [{ headline: "Fresh", footerLines: [] }]),
    ).toEqual([fact]);
  });
});

describe("regenerating one frame (H9)", () => {
  async function deliveredSet(n = 3) {
    await run(n);
    return frameRows();
  }

  function regenerate(id: string, edits?: Record<string, string>) {
    return regenerateFrameWork(
      {
        context: carouselContext(),
        userId: "u1",
        sessionId: "s1",
        generationId: id,
        edits,
      },
      runtimeWith().runtime as never,
    );
  }

  it("draws the user's copy exactly as typed, on the set's palette, as a new row of the same frame", async () => {
    const rows = await deliveredSet();
    const target = rows[1];
    const set = db.sets.get(target.setId as string) as {
      plan: PlannedSequence;
    };
    replanFrame.mockImplementation(
      async (input: {
        plan: PlannedSequence;
        index: number;
        edits: object;
      }) => ({
        beat: { ...input.plan.frames[input.index], ...input.edits },
        modelCalls: 0,
        uncovered: [],
      }),
    );
    const usageBefore = db.usage.length;
    const outcome = await regenerate(target.id, {
      headline: "butter from ONE farm, really",
    });

    const fresh = db.rows.get(outcome.result.generationId) as Row;
    expect(fresh).toMatchObject({
      setId: target.setId,
      frameIndex: 1,
      frameCount: 3,
      status: "succeeded",
    });
    expect(headlineOf(fresh)).toBe("butter from ONE farm, really");
    expect(fresh.spec.palette).toEqual(target.spec.palette);
    expect(db.rows.get(target.id)?.supersededBy).toBe(fresh.id);
    expect(outcome.result).toEqual({
      kind: "frame",
      setId: target.setId,
      frameIndex: 1,
      generationId: fresh.id,
      replaced: target.id,
      uncovered: [],
    });
    expect(replanFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 1,
        plan: set.plan,
        edits: { headline: "butter from ONE farm, really" },
      }),
      expect.objectContaining({ facts: expect.any(Array) }),
    );
    expect(replaceDesignSetBeat).toHaveBeenCalledWith(
      target.setId,
      1,
      expect.objectContaining({ headline: "butter from ONE farm, really" }),
    );
    expect(db.usage.length - usageBefore).toBe(1);
    expect(db.usage.at(-1)?.metadata).toMatchObject({
      setId: target.setId,
      frameIndex: 1,
      frameCount: 3,
      generationId: fresh.id,
      regenerateOf: target.id,
    });
  });

  it("hands on the facts an edit left the set without, so the UI can warn (round-3 critic, finding 7)", async () => {
    const rows = await deliveredSet();
    replanFrame.mockImplementation(
      async (input: {
        plan: PlannedSequence;
        index: number;
        edits: object;
      }) => ({
        beat: { ...input.plan.frames[input.index], ...input.edits },
        modelCalls: 0,
        uncovered: [{ kind: "price", text: "₦2,500 a bottle" }],
      }),
    );
    const outcome = await regenerate(rows[1].id, { subheadline: "" });
    expect(outcome.result.uncovered).toEqual(["₦2,500 a bottle"]);
    expect(db.usage.at(-1)?.metadata).toMatchObject({
      uncovered: ["₦2,500 a bottle"],
    });
  });

  it("leaves the other frames untouched", async () => {
    const rows = await deliveredSet();
    const others = [rows[0], rows[2]].map((r) => ({ ...db.rows.get(r.id) }));
    replanFrame.mockImplementation(
      async (input: { plan: PlannedSequence; index: number }) => ({
        beat: { ...input.plan.frames[input.index], headline: "A new angle" },
        modelCalls: 1,
        uncovered: [],
      }),
    );
    await regenerate(rows[1].id);
    for (const before of others) {
      expect(db.rows.get(before.id as string)).toEqual(before);
    }
  });

  it("keeps a layout apart from both neighbours", async () => {
    const rows = await deliveredSet();
    replanFrame.mockImplementation(
      async (input: { plan: PlannedSequence; index: number }) => ({
        beat: {
          ...input.plan.frames[input.index],
          layout: rows[0].spec.layout,
        },
        modelCalls: 1,
        uncovered: [],
      }),
    );
    const outcome = await regenerate(rows[1].id);
    const layout = db.rows.get(outcome.result.generationId)?.spec.layout;
    expect(layout).not.toBe(rows[0].spec.layout);
    expect(layout).not.toBe(rows[2].spec.layout);
  });

  it("leaves a regenerate still rendering at the same frame to land after it", async () => {
    const rows = await deliveredSet();
    replanFrame.mockImplementation(
      async (input: { plan: PlannedSequence; index: number }) => ({
        beat: input.plan.frames[input.index],
        modelCalls: 1,
        uncovered: [],
      }),
    );
    db.rows.set("in-flight", {
      ...rows[1],
      id: "in-flight",
      status: "pending",
      createdAt: new Date(2_000_000),
    });
    const outcome = await regenerate(rows[1].id);
    expect(db.rows.get(rows[1].id)?.supersededBy).toBe(
      outcome.result.generationId,
    );
    expect(db.rows.get("in-flight")?.supersededBy).toBeNull();
  });

  it("supersedes nothing and bills nothing when the new frame fails", async () => {
    const rows = await deliveredSet();
    replanFrame.mockImplementation(
      async (input: { plan: PlannedSequence; index: number }) => ({
        beat: input.plan.frames[input.index],
        modelCalls: 1,
        uncovered: [],
      }),
    );
    rasterizeDocument.mockRejectedValue(new Error("render worker crashed"));
    const usageBefore = db.usage.length;
    await expect(regenerate(rows[1].id)).rejects.toThrow(
      "render worker crashed",
    );
    expect(supersedeFrame).not.toHaveBeenCalled();
    expect(replaceDesignSetBeat).not.toHaveBeenCalled();
    expect(db.rows.get(rows[1].id)?.supersededBy).toBeNull();
    expect(db.usage.length).toBe(usageBefore);
  });

  it("refuses a row that is not a frame, or another brand's", async () => {
    const rows = await deliveredSet();
    db.rows.set("single", {
      ...rows[0],
      id: "single",
      setId: null,
      frameIndex: null,
      frameCount: null,
    });
    await expect(regenerate("single")).rejects.toBeInstanceOf(FrameTargetError);
    db.rows.set("foreign", { ...rows[0], id: "foreign", brandId: "other" });
    await expect(regenerate("foreign")).rejects.toBeInstanceOf(
      FrameTargetError,
    );
    await expect(regenerate("missing")).rejects.toBeInstanceOf(
      FrameTargetError,
    );
    expect(replanFrame).not.toHaveBeenCalled();
  });

  it("refuses with the flag off", async () => {
    const rows = await deliveredSet();
    process.env.FEATURE_MULTI_FRAME = "";
    await expect(regenerate(rows[1].id)).rejects.toBeInstanceOf(
      MultiFrameDisabledError,
    );
  });
});

const TURNED = {
  background: PALETTE.foreground,
  foreground: PALETTE.background,
  accent: PALETTE.accent,
};

const completedLines = () =>
  logSpy.mock.calls
    .map(([line]: unknown[]) => String(line))
    .filter((line: string) => line.startsWith("design.sequence.completed "))
    .map((line: string) =>
      JSON.parse(line.slice("design.sequence.completed ".length)),
    );

function rendered(input: { doc: unknown }, over: Record<string, unknown> = {}) {
  return {
    bytes: designPng(1080, 1350),
    contentType: "image/png",
    width: 1080,
    height: 1350,
    document: input.doc,
    logoFault: null,
    brandFontFault: null,
    ...over,
  };
}

function regenerateWith(
  id: string,
  runtime = runtimeWith().runtime,
  edits?: Record<string, string>,
) {
  return regenerateFrameWork(
    {
      context: carouselContext(),
      userId: "u1",
      sessionId: "s1",
      generationId: id,
      edits,
    },
    runtime as never,
  );
}

const keepBeat = async (input: { plan: PlannedSequence; index: number }) => ({
  beat: input.plan.frames[input.index],
  modelCalls: 1,
  uncovered: [],
});

/* A first slice that pauses once `delivered` frames have rendered. */
async function pausedAfter(
  delivered: number,
  frames: number,
  image: Record<string, unknown> = { source: "none" },
) {
  const checkpoint: Record<string, unknown> = {};
  let renders = 0;
  rasterizeDocument.mockImplementation(async (input: { doc: unknown }) => {
    renders += 1;
    return rendered(input);
  });
  await expect(
    run(
      frames,
      image,
      runtimeWith(checkpoint, () => renders >= delivered).runtime,
    ),
  ).rejects.toBeInstanceOf(JobPausedError);
  return checkpoint;
}

describe("one palette for a set whose cut-out turns it (H2)", () => {
  beforeEach(() => {
    paletteForCutout.mockImplementation((spec: { palette: object }) => ({
      ...spec,
      palette: TURNED,
    }));
  });

  it("draws and writes every frame in the turned palette, not the plan's", async () => {
    await run(4, { source: "upload", key: UPLOAD_KEY });
    const rows = frameRows();
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.status).toBe("succeeded");
      expect(row.spec.palette).toEqual(TURNED);
    }
    expect(paletteForCutout).toHaveBeenCalledWith(
      { palette: PALETTE },
      expect.anything(),
    );
  });

  it("keeps a regenerated frame on the palette the set was drawn in", async () => {
    await run(3, { source: "upload", key: UPLOAD_KEY });
    const target = frameRows()[1];
    /* Measured again, the photo would no longer turn the palette: the
       frame must still match the frames beside it. */
    paletteForCutout.mockImplementation(craft.paletteForCutout);
    replanFrame.mockImplementation(keepBeat);
    const outcome = await regenerateWith(target.id);
    expect(db.rows.get(outcome.result.generationId)?.spec.palette).toEqual(
      TURNED,
    );
  });
});

describe("a set that fails for good is settled (H7)", () => {
  it("bills the frames an earlier slice delivered when a later slice cannot build its kit", async () => {
    const checkpoint = await pausedAfter(2, 5, {
      source: "upload",
      key: UPLOAD_KEY,
    });
    const delivered = frameRows().filter((r) => r.status === "succeeded");
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.length).toBeLessThan(5);
    expect(db.usage).toHaveLength(delivered.length);

    loadDesignImage.mockRejectedValue(new Error("The upload is gone."));
    await expect(
      run(
        5,
        { source: "upload", key: UPLOAD_KEY },
        runtimeWith(checkpoint).runtime,
      ),
    ).rejects.toThrow("The upload is gone.");

    const rows = frameRows();
    expect(rows.filter((r) => r.status === "pending")).toEqual([]);
    for (const row of rows.filter((r) => r.status === "failed")) {
      expect(row.error).toBe("The upload is gone.");
    }
    expect(db.usage.map((u) => u.metadata.generationId).sort()).toEqual(
      delivered.map((r) => r.id).sort(),
    );
    expect(db.usage[0].metadata).toMatchObject({
      setId: rows[0].setId,
      jobFailed: true,
      delivered: delivered.length,
      failed: 5 - delivered.length,
    });
    expect(completedLines()).toEqual([
      expect.objectContaining({
        setId: rows[0].setId,
        requested: 5,
        delivered: delivered.length,
        failed: 5 - delivered.length,
      }),
    ]);
  });

  it("bills at settlement a delivered frame its slice could not bill", async () => {
    db.billFailures = 1;
    const checkpoint = await pausedAfter(1, 4);
    const delivered = frameRows().filter((r) => r.status === "succeeded");
    expect(delivered.length).toBeGreaterThan(0);
    expect(db.usage).toHaveLength(delivered.length - 1);
    await settleSetOnFailure({
      brandId: BRAND_ID,
      userId: "u1",
      requested: 4,
      checkpoint,
      reason: "Generation stalled. Please try again.",
    });
    expect(db.usage.map((u) => u.metadata.generationId).sort()).toEqual(
      delivered.map((r) => r.id).sort(),
    );
  });

  it("never bills a frame twice when a failed set is settled again", async () => {
    const checkpoint = await pausedAfter(1, 4);
    const settle = () =>
      settleSetOnFailure({
        brandId: BRAND_ID,
        userId: "u1",
        requested: 4,
        checkpoint,
        reason: "Generation stalled. Please try again.",
      });
    await settle();
    const billed = db.usage.length;
    expect(billed).toBe(
      frameRows().filter((r) => r.status === "succeeded").length,
    );
    await settle();
    expect(db.usage).toHaveLength(billed);
    expect(frameRows().some((r) => r.status === "pending")).toBe(false);
  });

  it("writes the trace line when every frame fails", async () => {
    rasterizeDocument.mockRejectedValue(new Error("render worker crashed"));
    await expect(run(3)).rejects.toThrow("render worker crashed");
    expect(completedLines()).toEqual([
      expect.objectContaining({
        setId: frameRows()[0].setId,
        requested: 3,
        delivered: 0,
        failed: 3,
      }),
    ]);
  });

  it("writes the trace line when the plan is refused", async () => {
    planSequence.mockResolvedValue(
      planned(planOf(3), {
        problems: [{ frame: 2, rule: "cta-last", detail: "no action" }],
      }),
    );
    await expect(run(3)).rejects.toBeInstanceOf(SequencePlanError);
    expect(completedLines()).toEqual([
      expect.objectContaining({
        setId: null,
        requested: 3,
        delivered: 0,
        failed: 3,
      }),
    ]);
  });

  it("leaves no set and no rows when the kit cannot be built", async () => {
    loadDesignImage
      .mockResolvedValueOnce({
        bytes: Buffer.from(UPLOADED_PHOTO),
        contentType: "image/png",
        width: 600,
        height: 600,
      })
      .mockRejectedValue(new Error("The upload is gone."));
    const checkpoint: Record<string, unknown> = {};
    await expect(
      run(
        3,
        { source: "upload", key: UPLOAD_KEY },
        runtimeWith(checkpoint).runtime,
      ),
    ).rejects.toThrow("The upload is gone.");
    expect(db.sets.size).toBe(0);
    expect(db.rows.size).toBe(0);
    expect(completedLines()).toEqual([
      expect.objectContaining({
        setId: checkpoint.setId,
        delivered: 0,
        failed: 3,
      }),
    ]);
  });
});

describe("checkpoint writes", () => {
  it("never overlap, so the last one carries every finished frame", async () => {
    const checkpoint: Record<string, unknown> = {};
    const { runtime } = runtimeWith(checkpoint);
    let inFlight = 0;
    let maxInFlight = 0;
    const landed: string[][] = [];
    let writes = 0;
    runtime.saveCheckpoint = vi.fn(async (partial: Record<string, unknown>) => {
      const snapshot = structuredClone(partial);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      writes += 1;
      /* Earlier writes take longer, so unqueued ones would land out of
         order. */
      await new Promise((resolve) => setTimeout(resolve, 30 / writes));
      Object.assign(checkpoint, snapshot);
      if (snapshot.frames) {
        landed.push(Object.keys(snapshot.frames as object).sort());
      }
      inFlight -= 1;
    });
    await run(4, { source: "none" }, runtime);
    expect(maxInFlight).toBe(1);
    expect(landed.at(-1)).toEqual(["0", "1", "2", "3"]);
    expect(Object.keys(checkpoint.frames as object).sort()).toEqual([
      "0",
      "1",
      "2",
      "3",
    ]);
  });
});

describe("the judge's correction on a frame (W2)", () => {
  const verdict = {
    scores: {},
    weakest: "integration",
    seriousFailure: false,
    symptom: "weak-hierarchy",
    change: { field: "logoPlacement", value: "bottom-left" },
    reason: "x",
    sawImage: true,
  };

  beforeEach(() => {
    loadBestLogo.mockResolvedValue({
      logo: {
        bytes: designPng(200, 50),
        contentType: "image/png",
        darkest: 0.02,
        lightest: 0.1,
        aspect: 4,
      },
      fault: null,
    });
    replanFrame.mockImplementation(keepBeat);
  });

  async function setWithUnreadableMark() {
    await run(3);
    const target = frameRows()[1];
    rasterizeDocument
      .mockImplementationOnce(async (input: { doc: unknown }) =>
        rendered(input, { logoFault: LOGO_NOT_LEGIBLE }),
      )
      .mockImplementation(async (input: { doc: unknown }) => rendered(input));
    return target;
  }

  it("takes a move of the mark to another corner", async () => {
    const target = await setWithUnreadableMark();
    let movedTo = "";
    judgeAndCorrect.mockImplementation(async (args: { spec: DesignSpec }) => {
      movedTo =
        args.spec.logoPlacement === "bottom-left"
          ? "bottom-right"
          : "bottom-left";
      return {
        corrected: true,
        spec: { ...args.spec, logoPlacement: movedTo },
        verdict,
        applied: { field: "logoPlacement", from: "", to: movedTo },
      };
    });
    const before = rasterizeDocument.mock.calls.length;
    const outcome = await regenerateWith(target.id);
    const fresh = db.rows.get(outcome.result.generationId) as Row;
    expect(judgeAndCorrect).toHaveBeenCalledTimes(1);
    expect(rasterizeDocument.mock.calls.length - before).toBe(2);
    expect(fresh.status).toBe("succeeded");
    expect(fresh.spec.logoPlacement).toBe(movedTo);
    expect(fresh.spec.palette).toEqual(PALETTE);
  });

  it("refuses a correction to the set's palette or the frame's copy", async () => {
    for (const change of [
      { palette: TURNED },
      { headline: "A headline the judge wrote" },
      { footerStyle: "bar" },
      { logoPlacement: "none" },
    ]) {
      db.rows.clear();
      db.sets.clear();
      judgeAndCorrect.mockReset();
      const target = await setWithUnreadableMark();
      judgeAndCorrect.mockImplementation(
        async (args: { spec: DesignSpec }) => ({
          corrected: true,
          spec: { ...args.spec, ...change },
          verdict,
          applied: { field: "palette", from: "", to: "" },
        }),
      );
      const before = rasterizeDocument.mock.calls.length;
      const outcome = await regenerateWith(target.id);
      const fresh = db.rows.get(outcome.result.generationId) as Row;
      expect(judgeAndCorrect).toHaveBeenCalledTimes(1);
      expect(rasterizeDocument.mock.calls.length - before).toBe(1);
      expect(fresh.spec.palette).toEqual(PALETTE);
      expect(headlineOf(fresh)).toBe("Butter from one farm");
      expect(fresh.spec.logoPlacement).not.toBe("none");
    }
  });

  it("asks no judge once the slice is out of time", async () => {
    const target = await setWithUnreadableMark();
    await regenerateWith(target.id, runtimeWith({}, () => true).runtime);
    expect(judgeAndCorrect).not.toHaveBeenCalled();
  });

  it("frameCorrectionKeeps allows only where the mark sits", async () => {
    const { designSpecOf } = await import("./directions/schema");
    const { draftOf } = await import("./directions/fixtures");
    const spec = designSpecOf(
      draftOf({ logoPlacement: "top-right" }) as Parameters<
        typeof designSpecOf
      >[0],
    );
    expect(
      frameCorrectionKeeps(spec, { ...spec, logoPlacement: "bottom-left" }),
    ).toBe(true);
    expect(frameCorrectionKeeps(spec, { ...spec, palette: TURNED })).toBe(
      false,
    );
    expect(frameCorrectionKeeps(spec, { ...spec, cta: "Buy" })).toBe(false);
    expect(frameCorrectionKeeps(spec, { ...spec, footerLines: ["x"] })).toBe(
      false,
    );
    expect(frameCorrectionKeeps(spec, { ...spec, logoPlacement: "none" })).toBe(
      false,
    );
  });
});

describe("which frame a regenerate replaces (H9)", () => {
  const row = (over: Partial<Row>): Row =>
    ({
      id: "r",
      brandId: BRAND_ID,
      setId: "set",
      frameIndex: 1,
      frameCount: 3,
      supersededBy: null,
      status: "succeeded",
      createdAt: new Date(1),
      ...over,
    }) as Row;

  it("resolves a superseded id to the frame on show", () => {
    const old = row({ id: "old", supersededBy: "new" });
    const onShow = row({ id: "new", createdAt: new Date(2) });
    expect(frameToReplace([old, onShow] as never, old as never).id).toBe("new");
  });

  it("refuses a frame its set is still drawing", () => {
    const drawing = row({ id: "drawing", status: "pending" });
    expect(() => frameToReplace([drawing] as never, drawing as never)).toThrow(
      FrameBusyError,
    );
  });

  it("redraws a failed frame, and lets another regenerate in flight land after", () => {
    const failed = row({ id: "failed", status: "failed" });
    expect(frameToReplace([failed] as never, failed as never).id).toBe(
      "failed",
    );
    const onShow = row({ id: "on-show" });
    const inFlight = row({
      id: "in-flight",
      status: "pending",
      createdAt: new Date(3),
    });
    expect(
      frameToReplace([onShow, inFlight] as never, onShow as never).id,
    ).toBe("on-show");
  });

  it("refuses a regenerate of a frame still pending in the set job", async () => {
    const checkpoint = await pausedAfter(1, 4);
    expect(checkpoint.setId).toBeTruthy();
    const pending = frameRows().find((r) => r.status === "pending") as Row;
    replanFrame.mockImplementation(keepBeat);
    await expect(regenerateWith(pending.id)).rejects.toBeInstanceOf(
      FrameBusyError,
    );
    expect(replanFrame).not.toHaveBeenCalled();
    expect(db.rows.get(pending.id)?.supersededBy).toBeNull();
  });
});

describe("telling the user which frames lost their image", () => {
  it("names the photo for an upload and does not ask for one", () => {
    const message = framesTextLedMessage({
      kind: "carousel",
      frames: 2,
      of: 6,
      cause: "photo-fits-none",
      subject: null,
    });
    expect(message).toBe(
      "2 frames of this 6-frame carousel were laid out with words only: your photo couldn't be shown whole and clear of the words on them at this size. Regenerate them to try another layout, or upload a photo with more room around the subject.",
    );
    expect(message).not.toContain("upload your own photo");
  });

  it("tells an image service that returned nothing from imagery turned down", () => {
    expect(
      framesTextLedMessage({
        kind: "presentation",
        frames: 1,
        of: 5,
        cause: "unavailable",
        subject: "croissants",
      }),
    ).toBe(
      "One frame of this 5-frame presentation was laid out with words only: KO's image service didn't return an image just now, so none could be used. Regenerate it to try new imagery, or upload your own photo.",
    );
    expect(
      framesTextLedMessage({
        kind: "carousel",
        frames: 1,
        of: 4,
        cause: "rejected",
        subject: "croissants",
      }),
    ).toBe(
      "One frame of this 4-frame carousel was laid out with words only: the images KO made of the croissants couldn't be used: they showed the wrong thing, painted made-up writing or a face, or left no room to show the subject whole. Regenerate it to try new imagery, or upload your own photo.",
    );
  });
});

describe("a frame regenerate's own job (H11)", () => {
  function regenerateOn(
    id: string,
    runtime: ReturnType<typeof runtimeWith>["runtime"],
    edits?: Record<string, string>,
  ) {
    return regenerateFrameWork(
      {
        context: carouselContext(),
        userId: "u1",
        sessionId: "s1",
        generationId: id,
        edits,
      },
      runtime as never,
    );
  }

  it("says it is rewriting only when no copy was typed", async () => {
    await run(3);
    replanFrame.mockImplementation(keepBeat);
    const typed = runtimeWith();
    await regenerateOn(frameRows()[1].id, typed.runtime, {
      headline: "Butter from one farm",
    });
    expect(typed.progress[0].label).toBe("Setting your copy on frame 2…");
    const rewritten = runtimeWith();
    await regenerateOn(frameRows()[0].id, rewritten.runtime);
    expect(rewritten.progress[0].label).toBe("Rewriting frame 1…");
  });

  it("checkpoints its new row, so a stalled job fails the row it left pending", async () => {
    await run(3);
    replanFrame.mockImplementation(keepBeat);
    const target = frameRows()[1].id;
    const checkpoint: Record<string, unknown> = {};
    /* The render never finishes, as in a job killed mid-render: the row is
       left to whoever fails the job. */
    rasterizeDocument.mockImplementation(
      () => new Promise(() => {}) as Promise<never>,
    );
    void regenerateOn(target, runtimeWith(checkpoint).runtime);
    await vi.waitFor(() => expect(checkpoint.rowId).toBeTruthy());
    const rowId = checkpoint.rowId as string;
    expect(db.rows.get(rowId)?.status).toBe("pending");

    await settleFrameJobOnFailure(
      {
        userId: "u1",
        brandId: BRAND_ID,
        input: { regenerateFrame: target, edits: null },
        result: { checkpoint },
      },
      "Generation stalled. Please try again.",
    );
    expect(db.rows.get(rowId)).toMatchObject({
      status: "failed",
      error: "Generation stalled. Please try again.",
    });
    expect(db.rows.get(target)?.supersededBy).toBeNull();
    expect(db.usage.some((u) => u.metadata.generationId === rowId)).toBe(false);
  });
});

describe("sweeping sets nobody will resume (H7, H11)", () => {
  it("fails and settles every abandoned set job the query hands back", async () => {
    const checkpoint = await pausedAfter(1, 4);
    const delivered = frameRows().filter((r) => r.status === "succeeded");
    failAbandonedDesignJobs.mockResolvedValue([
      {
        id: "job-1",
        userId: "u1",
        brandId: BRAND_ID,
        kind: "design_render",
        input: { sequence: { frames: 4 }, image: { source: "none" } },
        result: { checkpoint },
      },
    ]);
    const now = Date.now();
    expect(await sweepAbandonedDesignSets("w1", now)).toBe(1);
    expect(failAbandonedDesignJobs).toHaveBeenCalledWith(
      "w1",
      new Date(now - ABANDONED_SET_MS),
      ABANDONED_SET_ERROR,
    );
    const rows = frameRows();
    expect(rows.filter((r) => r.status === "pending")).toEqual([]);
    for (const row of rows.filter((r) => r.status === "failed")) {
      expect(row.error).toBe(ABANDONED_SET_ERROR);
    }
    expect(db.usage.map((u) => u.metadata.generationId).sort()).toEqual(
      delivered.map((r) => r.id).sort(),
    );
    expect(db.usage[0].metadata).toMatchObject({ jobFailed: true });
  });

  it("never throws into the request it runs in", async () => {
    failAbandonedDesignJobs.mockRejectedValue(new Error("db down"));
    await expect(sweepAbandonedDesignSets("w1")).resolves.toBe(0);
  });
});

describe("a set generated from an approved outline (O4, O5)", () => {
  type ApprovedOutline =
    import("@/lib/design/sequence/contract").ApprovedOutline;

  function approved(n: number): ApprovedOutline {
    return {
      kind: "carousel",
      points: Array.from({ length: n }, (_, i) => ({
        id: i === 2 ? "u-1" : `p${i + 1}`,
        role: i === 0 ? "hook" : i === n - 1 ? "cta" : "body",
        title: `Point ${i + 1}`,
        point:
          i === 2
            ? "We bake with butter from one farm in Jos."
            : `What frame ${i + 1} says.`,
        source: i === 2 ? "user" : "brief",
      })),
    };
  }

  function runFrom(
    outline: ApprovedOutline,
    frames: number,
    runtime = runtimeWith().runtime,
  ) {
    return generateSequenceWork(
      {
        context: carouselContext(),
        userId: "u1",
        sessionId: "s1",
        request: {
          image: { source: "none" },
          frames,
          approvedOutline: outline,
        },
      },
      runtime as never,
    );
  }

  it("re-validates the outline against the brief the job resolved", async () => {
    const outline = approved(4);
    await runFrom(outline, 4);
    const context = carouselContext() as { briefText?: string | null };
    expect(validateApprovedOutline).toHaveBeenCalledWith(outline, {
      kind: "carousel",
      briefText: context.briefText ?? "",
      profileStatements: expect.any(Array),
    });
  });

  it("hands the planner the validated outline and sizes the set by its points", async () => {
    const validated = approved(5);
    validateApprovedOutline.mockReturnValue({ ok: true, outline: validated });
    const outcome = await runFrom(approved(5), 3);
    expect(planSequence).toHaveBeenCalledWith(
      expect.objectContaining({ frameCount: 5, approvedOutline: validated }),
    );
    expect(frameRows()).toHaveLength(5);
    expect(outcome.result.frameCount).toBe(5);
  });

  it("fails before planning, writing no row and billing nothing, when the outline no longer holds", async () => {
    const problems = [{ point: 1, rule: "markup", detail: "holds {{" }];
    validateApprovedOutline.mockReturnValue({ ok: false, problems });
    const err = await runFrom(approved(4), 4).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApprovedOutlineError);
    expect((err as InstanceType<typeof ApprovedOutlineError>).problems).toEqual(
      problems,
    );
    expect((err as Error).message).toMatch(/Open the outline again/);
    expect(planSequence).not.toHaveBeenCalled();
    expect(db.rows.size).toBe(0);
    expect(db.usage).toHaveLength(0);
  });

  it("stores the outline with the set's plan, and in the checkpoint", async () => {
    const outline = approved(4);
    const { runtime } = runtimeWith();
    const outcome = await runFrom(outline, 4, runtime);
    const set = db.sets.get(outcome.result.setId) as Record<string, unknown>;
    expect(set.outline).toEqual(outline);
    expect(runtime.checkpoint).toMatchObject({ outline });
  });

  it("stores no outline for a set planned without one", async () => {
    const outcome = await run(3);
    const set = db.sets.get(outcome.result.setId) as Record<string, unknown>;
    expect(set.outline).toBeNull();
    expect(validateApprovedOutline).not.toHaveBeenCalled();
    expect(planSequence.mock.calls[0][0]).not.toHaveProperty("approvedOutline");
  });

  it("keeps the checkpoint's outline on a resumed slice, never validating again", async () => {
    const outline = approved(4);
    let slices = 0;
    const checkpoint: Record<string, unknown> = {};
    const first = runtimeWith(checkpoint, () => {
      slices += 1;
      return slices > 2;
    });
    await expect(runFrom(outline, 4, first.runtime)).rejects.toBeInstanceOf(
      JobPausedError,
    );
    expect(validateApprovedOutline).toHaveBeenCalledTimes(1);
    validateApprovedOutline.mockReturnValue({
      ok: false,
      problems: [{ point: null, rule: "kind", detail: "brief changed" }],
    });
    const second = runtimeWith(checkpoint);
    const outcome = await runFrom(outline, 4, second.runtime);
    expect(validateApprovedOutline).toHaveBeenCalledTimes(1);
    expect(planSequence).toHaveBeenCalledTimes(1);
    expect(outcome.result.frameCount).toBe(4);
  });

  it("keeps a regenerated frame to the approved points the set was made from", async () => {
    const outline = approved(4);
    const outcome = await runFrom(outline, 4);
    const target = frameRows()[2];
    replanFrame.mockImplementation(
      async (input: { plan: PlannedSequence; index: number }) => ({
        beat: { ...input.plan.frames[input.index], headline: "One farm, Jos" },
        modelCalls: 1,
        uncovered: [],
      }),
    );
    await regenerateFrameWork(
      {
        context: carouselContext(),
        userId: "u1",
        sessionId: "s1",
        generationId: target.id,
      },
      runtimeWith().runtime as never,
    );
    expect(target.setId).toBe(outcome.result.setId);
    expect(replanFrame).toHaveBeenCalledWith(
      expect.objectContaining({ index: 2 }),
      expect.objectContaining({ approvedOutline: outline }),
    );
  });

  it("regenerates a frame of a set made without an outline as before", async () => {
    await run(3);
    replanFrame.mockImplementation(
      async (input: { plan: PlannedSequence; index: number }) => ({
        beat: input.plan.frames[input.index],
        modelCalls: 1,
        uncovered: [],
      }),
    );
    await regenerateFrameWork(
      {
        context: carouselContext(),
        userId: "u1",
        sessionId: "s1",
        generationId: frameRows()[1].id,
      },
      runtimeWith().runtime as never,
    );
    expect(replanFrame.mock.calls[0][1]).not.toHaveProperty("approvedOutline");
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* resumeDesignSequenceJob: what the poll route calls to continue a set in a
   fresh invocation. The work itself is covered in run-design-sequence.test. */

const executeGenerationJob = vi.fn();
const updateGenerationJob = vi.fn();
const resolveDesignContext = vi.fn();
const listSetFrames = vi.fn();
const updateDesignGeneration = vi.fn();
const recordUsageEvent = vi.fn();
const annotateSetUsage = vi.fn(async (..._args: unknown[]) => {});

vi.mock("@/lib/db/queries", () => ({
  updateGenerationJob: (id: string, patch: unknown) =>
    updateGenerationJob(id, patch),
  listSetFrames: (brandId: string, setId: string) =>
    listSetFrames(brandId, setId),
  updateDesignGeneration: (id: string, patch: unknown) =>
    updateDesignGeneration(id, patch),
  listBilledSetGenerations: async () => [],
  recordUsageEvent: (event: unknown) => recordUsageEvent(event),
  annotateSetUsage: (...args: unknown[]) => annotateSetUsage(...args),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: vi.fn(),
}));
vi.mock("@/lib/design/context", () => ({
  resolveDesignContext: (args: unknown) => resolveDesignContext(args),
  DesignContextError: class DesignContextError extends Error {},
}));
vi.mock("./run-generation", () => ({
  executeGenerationJob: (...args: unknown[]) => executeGenerationJob(...args),
  JobPausedError: class JobPausedError extends Error {},
}));

const { resumeDesignSequenceJob } = await import("./run-design-sequence");
const { DesignContextError } = await import("@/lib/design/context");
const { SEQUENCE_SLICE_BUDGET_MS } = await import("./stale");
const { MultiFrameDisabledError } = await import(
  "@/lib/design/multi-frame-flag"
);

const INPUT = {
  briefId: "11111111-1111-4111-8111-111111111111",
  calendarItemId: null,
  attachments: [{ type: "asset", id: "22222222-2222-4222-8222-222222222222" }],
  image: { source: "none" },
  regenerateOf: null,
  sequence: { frames: 6 },
  freeform: "Croissant week",
  aspectRatio: "4:5",
};

const job = (input: unknown = INPUT, result: unknown = {}) => ({
  id: "job-1",
  userId: "u1",
  brandId: "b1",
  input,
  result,
});

/* A set two slices in: frame 0 delivered, frame 1 failed, frames 2 and 3
   never drawn. */
const SET_ID = "33333333-3333-4333-8333-333333333333";
const beat = (role: string, i: number) => ({
  role,
  title: `Frame ${i + 1}`,
  headline: `Headline ${i + 1}`,
  subheadline: "",
  cta: role === "cta" ? "Order" : "",
  footerLines: [],
  layout: "hero-center",
  showsImage: false,
  backgroundPrompt: "a counter",
});
const CHECKPOINT = {
  setId: SET_ID,
  plan: {
    kind: "carousel",
    palette: { background: "#fff", foreground: "#000", accent: "#c00" },
    logoPlacement: "top-right",
    logoFree: false,
    logoFreeQuote: "",
    backgroundTreatment: "solid",
    footerStyle: "none",
    aspectRatio: "4:5",
    frames: ["hook", "body", "body", "cta"].map(beat),
  },
  facts: [],
  offering: null,
  planned: { modelCalls: 1, repaired: false, problems: [] },
  frames: {
    "0": {
      status: "succeeded",
      faults: [],
      imageCalls: 0,
      textLed: true,
      plateCheck: null,
    },
    "1": {
      status: "failed",
      faults: [],
      imageCalls: 0,
      textLed: true,
      plateCheck: null,
    },
  },
  startedAt: Date.now() - 1000,
};
const frameRow = (i: number, status: string) => ({
  id: `frame-${i}`,
  brandId: "b1",
  setId: SET_ID,
  frameIndex: i,
  frameCount: 4,
  supersededBy: null,
  status,
  spec: { layout: "hero-center" },
  document: { elements: [] },
  provider: "none",
  imageSource: "none",
  source: "brief",
  createdAt: new Date(1_000 + i),
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FEATURE_MULTI_FRAME = "1";
  resolveDesignContext.mockResolvedValue({ brand: { id: "b1" } });
  executeGenerationJob.mockResolvedValue(undefined);
  listSetFrames.mockResolvedValue([
    frameRow(0, "succeeded"),
    frameRow(1, "failed"),
    frameRow(2, "pending"),
    frameRow(3, "pending"),
  ]);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.env.FEATURE_MULTI_FRAME = "";
});

describe("resumeDesignSequenceJob", () => {
  it("resolves the context the job was made from and runs another slice", async () => {
    await resumeDesignSequenceJob(job());
    expect(resolveDesignContext).toHaveBeenCalledWith({
      brandId: "b1",
      briefId: INPUT.briefId,
      calendarItemId: null,
      attachments: INPUT.attachments,
      freeform: "Croissant week",
      aspectRatio: "4:5",
    });
    expect(executeGenerationJob).toHaveBeenCalledWith(
      "job-1",
      expect.any(Function),
      {
        softDeadlineMs: SEQUENCE_SLICE_BUDGET_MS,
        onSliceCeiling: expect.any(Function),
      },
    );
    expect(updateGenerationJob).not.toHaveBeenCalled();
  });

  it("fails the job when its input is not a set", async () => {
    await resumeDesignSequenceJob(job({ briefId: null }));
    expect(executeGenerationJob).not.toHaveBeenCalled();
    expect(updateGenerationJob).toHaveBeenCalledWith("job-1", {
      status: "failed",
      error: "Generation could not be resumed. Please try again.",
    });
  });

  it("fails the job when the flag was turned off mid-set", async () => {
    process.env.FEATURE_MULTI_FRAME = "";
    await resumeDesignSequenceJob(job());
    expect(executeGenerationJob).not.toHaveBeenCalled();
    expect(updateGenerationJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("fails the job with the reason when its brief is gone", async () => {
    resolveDesignContext.mockRejectedValue(
      new DesignContextError("Design brief not found."),
    );
    await resumeDesignSequenceJob(job());
    expect(executeGenerationJob).not.toHaveBeenCalled();
    expect(updateGenerationJob).toHaveBeenCalledWith("job-1", {
      status: "failed",
      error: "Design brief not found.",
    });
  });
});

describe("a set whose job fails for good (H7)", () => {
  function expectSettled(reason: string) {
    expect(updateDesignGeneration).toHaveBeenCalledTimes(2);
    for (const id of ["frame-2", "frame-3"]) {
      expect(updateDesignGeneration).toHaveBeenCalledWith(id, {
        status: "failed",
        error: reason,
      });
    }
    expect(recordUsageEvent).toHaveBeenCalledTimes(1);
    expect(recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        brandId: "b1",
        kind: "design_generated",
        metadata: expect.objectContaining({
          setId: SET_ID,
          frameIndex: 0,
          frameCount: 4,
          generationId: "frame-0",
        }),
      }),
    );
    expect(annotateSetUsage).toHaveBeenCalledWith(
      "b1",
      SET_ID,
      expect.objectContaining({ jobFailed: true, delivered: 1, failed: 3 }),
    );
    const lines = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line))
      .filter((line) => line.startsWith("design.sequence.completed "));
    expect(lines).toHaveLength(1);
    expect(
      JSON.parse(lines[0].slice("design.sequence.completed ".length)),
    ).toMatchObject({ setId: SET_ID, requested: 4, delivered: 1, failed: 3 });
  }

  it("bills the delivered frames and fails the rest when the flag went off mid-set", async () => {
    process.env.FEATURE_MULTI_FRAME = "";
    await resumeDesignSequenceJob(job(INPUT, { checkpoint: CHECKPOINT }));
    expect(executeGenerationJob).not.toHaveBeenCalled();
    expectSettled(new MultiFrameDisabledError().message);
  });

  it("bills the delivered frames and fails the rest when the brief is gone", async () => {
    resolveDesignContext.mockRejectedValue(
      new DesignContextError("Design brief not found."),
    );
    await resumeDesignSequenceJob(job(INPUT, { checkpoint: CHECKPOINT }));
    expectSettled("Design brief not found.");
  });

  it("settles the set when the slice ceiling fails the job", async () => {
    await resumeDesignSequenceJob(job(INPUT, { checkpoint: CHECKPOINT }));
    const { onSliceCeiling } = executeGenerationJob.mock.calls[0][2];
    await onSliceCeiling(
      CHECKPOINT,
      "Generation is taking longer than expected.",
    );
    expectSettled("Generation is taking longer than expected.");
  });

  it("writes the trace line even for a job that never planned", async () => {
    resolveDesignContext.mockRejectedValue(
      new DesignContextError("Design brief not found."),
    );
    await resumeDesignSequenceJob(job());
    expect(listSetFrames).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
    const line = vi
      .mocked(console.log)
      .mock.calls.map(([l]) => String(l))
      .find((l) => l.startsWith("design.sequence.completed "));
    expect(
      JSON.parse(String(line).slice("design.sequence.completed ".length)),
    ).toMatchObject({ setId: null, requested: 6, delivered: 0, failed: 6 });
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* resumeDesignSequenceJob: what the poll route calls to continue a set in a
   fresh invocation. The work itself is covered in run-design-sequence.test. */

const executeGenerationJob = vi.fn();
const updateGenerationJob = vi.fn();
const resolveDesignContext = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  updateGenerationJob: (id: string, patch: unknown) =>
    updateGenerationJob(id, patch),
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

const job = (input: unknown = INPUT) => ({
  id: "job-1",
  userId: "u1",
  brandId: "b1",
  input,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FEATURE_MULTI_FRAME = "1";
  resolveDesignContext.mockResolvedValue({ brand: { id: "b1" } });
  executeGenerationJob.mockResolvedValue(undefined);
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
      { softDeadlineMs: SEQUENCE_SLICE_BUDGET_MS },
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

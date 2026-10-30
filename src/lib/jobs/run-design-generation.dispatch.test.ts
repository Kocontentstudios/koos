// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Which path a design job takes. The route decides whether a request is a
   set (flag, format, image choice); generateDesignWork only follows it. */

const generateSequenceWork = vi.fn();
const generateDirectionsWork = vi.fn();

vi.mock("@/lib/db/queries", () => ({}));
vi.mock("./run-design-sequence", () => ({
  generateSequenceWork: (...args: unknown[]) => generateSequenceWork(...args),
}));
vi.mock("./run-design-directions", () => ({
  generateDirectionsWork: (...args: unknown[]) =>
    generateDirectionsWork(...args),
}));

const { generateDesignWork } = await import("./run-design-generation");

const runtime = { jobId: "job-1" } as never;
const context = { brand: { id: "b1" } } as never;
const CONTEXT_REQUEST = {
  briefId: null,
  calendarItemId: null,
  attachments: [],
  freeform: "Croissant week",
  aspectRatio: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  generateSequenceWork.mockResolvedValue({ result: "set" });
  generateDirectionsWork.mockResolvedValue({ result: "pair" });
});

describe("generateDesignWork dispatch", () => {
  it("builds a set when the request carries an image choice and a sequence", async () => {
    const outcome = await generateDesignWork(
      {
        context,
        userId: "u1",
        sessionId: "s1",
        directions: { image: { source: "none" }, regenerateOf: null },
        sequence: { frames: 6, contextRequest: CONTEXT_REQUEST },
      },
      runtime,
    );
    expect(outcome).toEqual({ result: "set" });
    expect(generateSequenceWork).toHaveBeenCalledWith(
      {
        context,
        userId: "u1",
        sessionId: "s1",
        request: { image: { source: "none" }, frames: 6 },
        contextRequest: CONTEXT_REQUEST,
      },
      runtime,
    );
    expect(generateDirectionsWork).not.toHaveBeenCalled();
  });

  it("takes the directions path, unchanged, without a sequence", async () => {
    const outcome = await generateDesignWork(
      {
        context,
        userId: "u1",
        sessionId: "s1",
        directions: { image: { source: "none" }, regenerateOf: null },
      },
      runtime,
    );
    expect(outcome).toEqual({ result: "pair" });
    expect(generateDirectionsWork).toHaveBeenCalledWith(
      {
        context,
        userId: "u1",
        sessionId: "s1",
        request: { image: { source: "none" }, regenerateOf: null },
      },
      runtime,
    );
    expect(generateSequenceWork).not.toHaveBeenCalled();
  });

  it("never builds a set without an image choice", async () => {
    process.env.FEATURE_KO_IMAGERY = "";
    await expect(
      generateDesignWork(
        { context, userId: "u1", sequence: { frames: 6 } },
        runtime,
      ),
    ).rejects.toThrow();
    expect(generateSequenceWork).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarChunk, CalendarOutline } from "@/lib/ai/calendar-schema";
import type { Strategy } from "@/lib/ai/strategy-schema";

const generateObject = vi.fn();
const getGenerationJobById = vi.fn();
const updateGenerationJob = vi.fn();
const touchGenerationJob = vi.fn();
const getStrategyById = vi.fn();
const getBrandById = vi.fn();
const createCalendar = vi.fn();
const insertCalendarItems = vi.fn();
const createNotification = vi.fn();
const recordUsageEvent = vi.fn();
const createStrategy = vi.fn();

vi.mock("ai", () => ({
  generateObject: (args: unknown) => generateObject(args),
}));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "test-model" }));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: async () => {},
}));
vi.mock("@/lib/db/queries", () => ({
  getGenerationJobById: (id: string) => getGenerationJobById(id),
  updateGenerationJob: (id: string, patch: unknown) =>
    updateGenerationJob(id, patch),
  touchGenerationJob: (id: string) => touchGenerationJob(id),
  getStrategyById: (id: string) => getStrategyById(id),
  getBrandById: (id: string) => getBrandById(id),
  createCalendar: (data: unknown) => createCalendar(data),
  insertCalendarItems: (rows: unknown) => insertCalendarItems(rows),
  createNotification: (data: unknown) => createNotification(data),
  recordUsageEvent: (data: unknown) => recordUsageEvent(data),
  createStrategy: (data: unknown) => createStrategy(data),
}));

import {
  executeGenerationJob,
  generateCalendarWork,
  JobPausedError,
  type JobRuntime,
  resumeCalendarJob,
} from "./run-generation";

function slot(dayOffset: number, title: string) {
  return {
    dayOffset,
    time: "9:00 AM",
    platform: "Instagram",
    contentType: "post",
    title,
    designRequired: false,
  };
}

const OUTLINE: CalendarOutline = {
  startDate: "2026-07-21",
  segments: [
    { theme: "Week 1", slots: [slot(0, "Kickoff")] },
    { theme: "Week 2", slots: [slot(7, "Momentum")] },
  ],
} as CalendarOutline;

const CHUNK_0: CalendarChunk = {
  briefs: [{ slotIndex: 0, brief: "**Title**\nKickoff brief" }],
};
const CHUNK_1: CalendarChunk = {
  briefs: [{ slotIndex: 0, brief: "**Title**\nMomentum brief" }],
};

const BRAND = { id: "b1", name: "Acme" } as never;
const STRATEGY_ROW = { id: "s1", structured: {} } as never;
const STRUCTURED = {} as Strategy;

function fakeRuntime(
  checkpoint: Record<string, unknown> = {},
  shouldPause: () => boolean = () => false,
): JobRuntime {
  return {
    reportProgress: vi.fn(),
    checkpoint,
    saveCheckpoint: vi.fn(async (partial: Record<string, unknown>) => {
      Object.assign(checkpoint, partial);
    }),
    shouldPause,
  };
}

function workArgs() {
  return {
    brand: BRAND,
    strategy: STRATEGY_ROW,
    structured: STRUCTURED,
    userId: "u1",
    sessionId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getGenerationJobById.mockResolvedValue({ id: "job-1", result: null });
  updateGenerationJob.mockResolvedValue({});
  createCalendar.mockResolvedValue({ id: "cal-1" });
  insertCalendarItems.mockResolvedValue(undefined);
  createNotification.mockResolvedValue({});
  recordUsageEvent.mockResolvedValue(undefined);
});

describe("executeGenerationJob", () => {
  it("keeps a paused job running instead of failing it", async () => {
    await executeGenerationJob("job-1", async (runtime) => {
      await runtime.saveCheckpoint({ outline: OUTLINE });
      throw new JobPausedError();
    });
    const statusUpdates = updateGenerationJob.mock.calls
      .map(([, patch]) => (patch as { status?: string }).status)
      .filter(Boolean);
    expect(statusUpdates).toEqual(["running"]);
  });

  it("marks a genuinely failing job as failed", async () => {
    await executeGenerationJob("job-1", async () => {
      throw new Error("model exploded");
    });
    expect(updateGenerationJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "failed", error: "model exploded" }),
    );
  });

  it("exposes the previous slice's checkpoint to the work", async () => {
    getGenerationJobById.mockResolvedValue({
      id: "job-1",
      result: { checkpoint: { outline: OUTLINE }, resumeCount: 1 },
    });
    let seen: unknown;
    await executeGenerationJob("job-1", async (runtime) => {
      seen = runtime.checkpoint;
      return { result: { ok: true } };
    });
    expect(seen).toEqual({ outline: OUTLINE });
  });

  it("honors the soft deadline via shouldPause", async () => {
    let paused: boolean | undefined;
    await executeGenerationJob(
      "job-1",
      async (runtime) => {
        paused = runtime.shouldPause();
        return { result: {} };
      },
      { softDeadlineMs: -1 },
    );
    expect(paused).toBe(true);
  });
});

describe("generateCalendarWork", () => {
  it("completes a fresh run and persists checkpoint along the way", async () => {
    generateObject
      .mockResolvedValueOnce({ object: OUTLINE })
      .mockResolvedValueOnce({ object: CHUNK_0 })
      .mockResolvedValueOnce({ object: CHUNK_1 });
    const runtime = fakeRuntime();

    const outcome = await generateCalendarWork(workArgs(), runtime);

    expect(outcome.resultId).toBe("cal-1");
    expect(generateObject).toHaveBeenCalledTimes(3);
    // Provider defaults (~4k output tokens) truncate multi-brief JSON into
    // schema failures — every calendar call must raise the cap explicitly.
    for (const [callArgs] of generateObject.mock.calls) {
      expect(
        (callArgs as { maxOutputTokens: number }).maxOutputTokens,
      ).toBeGreaterThanOrEqual(16_000);
    }
    expect(runtime.checkpoint).toMatchObject({ outline: OUTLINE });
    const inserted = insertCalendarItems.mock.calls[0][0] as Array<{
      title: string;
    }>;
    expect(inserted.map((r) => r.title)).toEqual(["Kickoff", "Momentum"]);
  });

  it("skips checkpointed work on resume — outline and finished chunks", async () => {
    generateObject.mockResolvedValueOnce({ object: CHUNK_1 });
    const runtime = fakeRuntime({
      outline: OUTLINE,
      chunks: { "0": CHUNK_0 },
    });

    const outcome = await generateCalendarWork(workArgs(), runtime);

    // Only the missing chunk (segment 1) was generated.
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(outcome.resultId).toBe("cal-1");
    const inserted = insertCalendarItems.mock.calls[0][0] as Array<{
      title: string;
      brief: string;
    }>;
    expect(inserted).toHaveLength(2);
    expect(inserted[0].brief).toContain("Kickoff brief");
    expect(inserted[1].brief).toContain("Momentum brief");
  });

  it("pauses instead of failing when the slice deadline passes", async () => {
    generateObject.mockResolvedValueOnce({ object: OUTLINE });
    const runtime = fakeRuntime({}, () => true);

    await expect(generateCalendarWork(workArgs(), runtime)).rejects.toThrow(
      JobPausedError,
    );
    // The outline slice still checkpointed before pausing.
    expect(runtime.checkpoint).toMatchObject({ outline: OUTLINE });
    expect(createCalendar).not.toHaveBeenCalled();
  });
});

describe("resumeCalendarJob", () => {
  const JOB = {
    id: "job-1",
    userId: "u1",
    brandId: "b1",
    input: { strategyId: "s1" },
  };

  it("fails the job cleanly when the strategy is gone", async () => {
    getStrategyById.mockResolvedValue(null);
    getBrandById.mockResolvedValue(BRAND);
    await resumeCalendarJob(JOB);
    expect(updateGenerationJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "failed" }),
    );
  });
});

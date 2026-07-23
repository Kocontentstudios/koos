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
const updateCalendarItemBriefs = vi.fn();
const createNotification = vi.fn();
const recordUsageEvent = vi.fn();
const createStrategy = vi.fn();
const createDesignBrief = vi.fn();

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
  updateCalendarItemBriefs: (updates: unknown) =>
    updateCalendarItemBriefs(updates),
  createNotification: (data: unknown) => createNotification(data),
  recordUsageEvent: (data: unknown) => recordUsageEvent(data),
  createStrategy: (data: unknown) => createStrategy(data),
  createDesignBrief: (data: unknown) => createDesignBrief(data),
}));

import {
  executeGenerationJob,
  generateCalendarWork,
  generateDesignBriefWork,
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
  // Mirrors insertCalendarItems returning rows in input order: give each an id.
  insertCalendarItems.mockImplementation(async (rows: object[]) =>
    rows.map((r, i) => ({ ...r, id: `item-${i}` })),
  );
  updateCalendarItemBriefs.mockResolvedValue(undefined);
  createNotification.mockResolvedValue({});
  recordUsageEvent.mockResolvedValue(undefined);
});

/** Flatten every updateCalendarItemBriefs call into one id -> brief map. */
function briefUpdatesById(): Record<string, string> {
  return Object.fromEntries(
    updateCalendarItemBriefs.mock.calls
      .flatMap(([updates]) => updates as { id: string; brief: string }[])
      .map((u) => [u.id, u.brief]),
  );
}

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

  it("marks a deliberately paused slice as ready to resume", async () => {
    await executeGenerationJob(
      "job-1",
      async () => {
        throw new JobPausedError();
      },
      { softDeadlineMs: 1 },
    );

    const persisted = vi
      .mocked(updateGenerationJob)
      .mock.calls.map(([, patch]) => patch)
      .findLast((patch) => patch.result !== undefined);
    expect(persisted?.result).toMatchObject({ paused: true, sliceCount: 1 });
  });

  it("fails a runaway paused job when MAX_SLICES ceiling is hit", async () => {
    getGenerationJobById.mockResolvedValue({
      id: "job-1",
      result: { sliceCount: 9, paused: true, checkpoint: {} },
    });
    await executeGenerationJob("job-1", async () => {
      throw new JobPausedError();
    });

    expect(updateGenerationJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        status: "failed",
        error: "Generation is taking longer than expected. Please try again.",
      }),
    );

    const pausedCalls = vi
      .mocked(updateGenerationJob)
      .mock.calls.filter(([, patch]) => patch.result?.paused);
    expect(pausedCalls).toHaveLength(0);
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
      brief: string | null;
    }>;
    expect(inserted.map((r) => r.title)).toEqual(["Kickoff", "Momentum"]);
    // The calendar is written from the outline with briefs pending — never
    // with the model's brief text, which lands later via a separate update.
    expect(inserted.every((r) => r.brief === null)).toBe(true);
    const briefs = briefUpdatesById();
    expect(briefs["item-0"]).toContain("Kickoff brief");
    expect(briefs["item-1"]).toContain("Momentum brief");
  });

  it("skips checkpointed work on resume — outline and finished units", async () => {
    generateObject.mockResolvedValueOnce({ object: CHUNK_1 });
    const runtime = fakeRuntime({
      outline: OUTLINE,
      chunks: { "0:0": CHUNK_0 },
    });

    const outcome = await generateCalendarWork(workArgs(), runtime);

    // Only the missing chunk (segment 1) was generated.
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(outcome.resultId).toBe("cal-1");
    const inserted = insertCalendarItems.mock.calls[0][0] as Array<{
      title: string;
      brief: string | null;
    }>;
    expect(inserted).toHaveLength(2);
    expect(inserted.every((r) => r.brief === null)).toBe(true);
    // Segment 1's unit ran this slice, so its brief lands via the update path.
    expect(briefUpdatesById()["item-1"]).toContain("Momentum brief");
  });

  it("splits large segments into ≤4-slot units and remaps slotIndex", async () => {
    const bigOutline = {
      startDate: "2026-07-21",
      segments: [
        {
          theme: "Week 1",
          slots: Array.from({ length: 6 }, (_, i) => slot(i, `Post ${i}`)),
        },
      ],
    } as CalendarOutline;
    // Unit 0:0 covers slots 0-3, unit 0:4 covers slots 4-5; each model
    // response uses unit-relative slotIndex.
    generateObject
      .mockResolvedValueOnce({
        object: {
          briefs: Array.from({ length: 4 }, (_, i) => ({
            slotIndex: i,
            brief: `u1-${i}`,
          })),
        },
      })
      .mockResolvedValueOnce({
        object: {
          briefs: [
            { slotIndex: 0, brief: "u2-0" },
            { slotIndex: 1, brief: "u2-1" },
          ],
        },
      });
    const runtime = fakeRuntime({ outline: bigOutline });

    await generateCalendarWork(workArgs(), runtime);

    expect(generateObject).toHaveBeenCalledTimes(2);
    const inserted = insertCalendarItems.mock.calls[0][0] as Array<{
      brief: string | null;
    }>;
    expect(inserted.every((r) => r.brief === null)).toBe(true);
    const briefs = briefUpdatesById();
    expect(
      ["item-0", "item-1", "item-2", "item-3", "item-4", "item-5"].map(
        (id) => briefs[id],
      ),
    ).toEqual(["u1-0", "u1-1", "u1-2", "u1-3", "u2-0", "u2-1"]);
  });

  it("falls back to template briefs when one unit fails every retry", async () => {
    vi.useFakeTimers();
    try {
      generateObject.mockImplementation(async (callArgs: unknown) => {
        const prompt = (callArgs as { prompt: string }).prompt;
        if (prompt.includes("Kickoff")) {
          throw new Error(
            "No object generated: response did not match schema.",
          );
        }
        return { object: CHUNK_1 };
      });
      const runtime = fakeRuntime({ outline: OUTLINE });

      const pending = generateCalendarWork(workArgs(), runtime);
      await vi.runAllTimersAsync(); // drive the retry backoffs
      const outcome = await pending;

      expect(outcome.resultId).toBe("cal-1");
      const inserted = insertCalendarItems.mock.calls[0][0] as Array<{
        brief: string | null;
      }>;
      expect(inserted.every((r) => r.brief === null)).toBe(true);
      const briefs = briefUpdatesById();
      expect(briefs["item-0"]).toContain("as planned"); // fallback brief
      expect(briefs["item-1"]).toContain("Momentum brief");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses instead of failing when the slice deadline passes", async () => {
    generateObject.mockResolvedValueOnce({ object: OUTLINE });
    const runtime = fakeRuntime({}, () => true);

    await expect(generateCalendarWork(workArgs(), runtime)).rejects.toThrow(
      JobPausedError,
    );
    // The outline slice still checkpointed before pausing.
    expect(runtime.checkpoint).toMatchObject({ outline: OUTLINE });
    // The calendar is written straight after the outline pass — it exists
    // even though the pause hit before any brief-writing unit ran.
    expect(createCalendar).toHaveBeenCalledTimes(1);
    expect(runtime.checkpoint).toMatchObject({ calendarId: "cal-1" });
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

describe("generateDesignBriefWork", () => {
  const BRIEF = {
    title: "Launch Post",
    designType: "Instagram Post (1080x1350)",
    dimensions: "1080x1350",
    briefMarkdown: "**Title**\nLaunch Post",
  };

  it("persists the brief when a conversationId is provided", async () => {
    generateObject.mockResolvedValueOnce({ object: BRIEF });
    createDesignBrief.mockResolvedValue({ id: "brief-1" });
    const outcome = await generateDesignBriefWork({
      brand: BRAND,
      conversation: "user: I need a launch post",
      conversationId: "conv-1",
      userId: "u1",
      sessionId: null,
    });
    expect(createDesignBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        brandId: "b1",
        userId: "u1",
        title: "Launch Post",
        designType: "Instagram Post (1080x1350)",
        briefMarkdown: "**Title**\nLaunch Post",
      }),
    );
    expect(outcome.result).toMatchObject({ brief: BRIEF, briefId: "brief-1" });
  });

  it("skips persistence when no conversationId is provided", async () => {
    generateObject.mockResolvedValueOnce({ object: BRIEF });
    const outcome = await generateDesignBriefWork({
      brand: BRAND,
      conversation: "user: I need a launch post",
      conversationId: null,
      userId: "u1",
      sessionId: null,
    });
    expect(createDesignBrief).not.toHaveBeenCalled();
    expect(outcome.result).toMatchObject({ brief: BRIEF, briefId: null });
  });
});

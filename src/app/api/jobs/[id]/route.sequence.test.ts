import { beforeEach, describe, expect, it, vi } from "vitest";

/* KOOS-AI-002: a design job building a set of frames resumes from this
   poll the way a calendar job does (H8). Calendar behaviour is pinned in
   route.test.ts; this file covers the dispatch by kind and input. */

const getAuthUser = vi.fn();
const getGenerationJobById = vi.fn();
const checkBrandAccess = vi.fn();
const claimPausedGenerationJob = vi.fn();
const claimStaleGenerationJob = vi.fn();
const updateGenerationJob = vi.fn();
const resumeCalendarJob = vi.fn();
const resumeDesignSequenceJob = vi.fn();
const after = vi.fn();

vi.mock("next/server", () => ({ after: (fn: () => void) => after(fn) }));
vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getGenerationJobById: (id: string) => getGenerationJobById(id),
  checkBrandAccess: (u: string, b: string, c: string) =>
    checkBrandAccess(u, b, c),
  claimPausedGenerationJob: (id: string) => claimPausedGenerationJob(id),
  claimStaleGenerationJob: (id: string, ms: number) =>
    claimStaleGenerationJob(id, ms),
  updateGenerationJob: (id: string, patch: unknown) =>
    updateGenerationJob(id, patch),
}));
vi.mock("@/lib/jobs/run-generation", () => ({
  resumeCalendarJob: (job: unknown) => resumeCalendarJob(job),
}));
vi.mock("@/lib/jobs/run-design-sequence", () => ({
  resumeDesignSequenceJob: (job: unknown) => resumeDesignSequenceJob(job),
}));

import {
  CALENDAR_STALE_MS,
  DEFAULT_STALE_MS,
  MAX_RESUMES,
} from "@/lib/jobs/stale";
import { GET } from "./route";

const JOB_ID = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const params = { params: Promise.resolve({ id: JOB_ID }) };
const req = new Request("http://x");
const SEQUENCE_INPUT = {
  briefId: null,
  calendarItemId: null,
  attachments: [],
  image: { source: "none" },
  regenerateOf: null,
  sequence: { frames: 6 },
  freeform: "Croissant week",
  aspectRatio: null,
};

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    kind: "design_render",
    userId: "u1",
    brandId: "b1",
    status: "running",
    input: SEQUENCE_INPUT,
    result: { paused: true },
    updatedAt: new Date(),
    ...overrides,
  };
}

async function pollAndRunDeferred() {
  const res = await GET(req, params);
  for (const [deferred] of after.mock.calls) {
    await (deferred as () => Promise<void>)();
  }
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "b1" } });
  resumeCalendarJob.mockResolvedValue(undefined);
  resumeDesignSequenceJob.mockResolvedValue(undefined);
});

describe("GET /api/jobs/[id] resuming a set of frames", () => {
  it("continues a paused sequence job with the sequence work", async () => {
    const paused = job();
    getGenerationJobById.mockResolvedValue(paused);
    claimPausedGenerationJob.mockResolvedValue(paused);

    await pollAndRunDeferred();

    expect(claimPausedGenerationJob).toHaveBeenCalledWith(JOB_ID);
    expect(resumeDesignSequenceJob).toHaveBeenCalledWith(paused);
    expect(resumeCalendarJob).not.toHaveBeenCalled();
  });

  it("resumes a sequence job whose worker went silent, on the calendar window", async () => {
    const silent = job({
      result: { resumeCount: 0 },
      updatedAt: new Date(Date.now() - CALENDAR_STALE_MS - 1000),
    });
    getGenerationJobById.mockResolvedValue(silent);
    claimStaleGenerationJob.mockResolvedValue(silent);

    await pollAndRunDeferred();

    expect(claimStaleGenerationJob).toHaveBeenCalledWith(
      JOB_ID,
      CALENDAR_STALE_MS,
    );
    expect(resumeDesignSequenceJob).toHaveBeenCalledTimes(1);
    expect(updateGenerationJob).not.toHaveBeenCalled();
  });

  it("fails a silent sequence job once its resumes are spent", async () => {
    getGenerationJobById.mockResolvedValue(
      job({
        result: { resumeCount: MAX_RESUMES },
        updatedAt: new Date(Date.now() - CALENDAR_STALE_MS - 1000),
      }),
    );

    const res = await pollAndRunDeferred();

    expect(await res.json()).toMatchObject({ status: "failed" });
    expect(resumeDesignSequenceJob).not.toHaveBeenCalled();
  });

  it("still fails, never resumes, a single design job that went silent", async () => {
    getGenerationJobById.mockResolvedValue(
      job({
        input: { briefId: null, attachments: [] },
        result: {},
        updatedAt: new Date(Date.now() - DEFAULT_STALE_MS - 1000),
      }),
    );

    const res = await pollAndRunDeferred();

    expect(await res.json()).toMatchObject({
      status: "failed",
      error: "Generation stalled. Please try again.",
    });
    expect(claimStaleGenerationJob).not.toHaveBeenCalled();
    expect(resumeDesignSequenceJob).not.toHaveBeenCalled();
  });

  it("leaves a single design job alone inside the long window", async () => {
    getGenerationJobById.mockResolvedValue(
      job({
        input: { briefId: null, attachments: [] },
        result: {},
        updatedAt: new Date(Date.now() - CALENDAR_STALE_MS - 1000),
      }),
    );

    const res = await pollAndRunDeferred();

    expect(await res.json()).toMatchObject({ status: "running" });
    expect(updateGenerationJob).not.toHaveBeenCalled();
  });

  it("fails a paused job it has no work to resume with", async () => {
    const paused = job({ input: { briefId: null } });
    getGenerationJobById.mockResolvedValue(paused);
    claimPausedGenerationJob.mockResolvedValue(paused);

    await pollAndRunDeferred();

    expect(resumeDesignSequenceJob).not.toHaveBeenCalled();
    expect(resumeCalendarJob).not.toHaveBeenCalled();
    expect(updateGenerationJob).toHaveBeenCalledWith(JOB_ID, {
      status: "failed",
      error: "Generation could not be resumed. Please try again.",
    });
  });

  it("still resumes a calendar job with the calendar work", async () => {
    const paused = job({ kind: "calendar", input: { strategyId: "s1" } });
    getGenerationJobById.mockResolvedValue(paused);
    claimPausedGenerationJob.mockResolvedValue(paused);

    await pollAndRunDeferred();

    expect(resumeCalendarJob).toHaveBeenCalledWith(paused);
    expect(resumeDesignSequenceJob).not.toHaveBeenCalled();
  });
});

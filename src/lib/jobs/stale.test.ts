import { describe, expect, it } from "vitest";
import {
  ABANDONED_SET_MS,
  CALENDAR_STALE_MS,
  DEFAULT_STALE_MS,
  isPausedForResume,
  isRegenerateFrameJobInput,
  isResumableJob,
  isSequenceJobInput,
  MAX_RESUMES,
  resolveStaleAction,
  resumeCountFrom,
  SEQUENCE_SLICE_BUDGET_MS,
  staleMsFor,
} from "./stale";

const NOW = 1_700_000_000_000;

function job(
  overrides: Partial<Parameters<typeof resolveStaleAction>[0]> = {},
): Parameters<typeof resolveStaleAction>[0] {
  return {
    kind: "calendar",
    status: "running",
    updatedAt: new Date(NOW),
    resumeCount: 0,
    ...overrides,
  };
}

describe("resolveStaleAction", () => {
  it("does nothing for a job with a fresh heartbeat", () => {
    expect(resolveStaleAction(job(), NOW)).toBe("none");
    expect(
      resolveStaleAction(
        job({ updatedAt: new Date(NOW - CALENDAR_STALE_MS) }),
        NOW,
      ),
    ).toBe("none");
  });

  it("does nothing for terminal jobs however old", () => {
    for (const status of ["succeeded", "failed"]) {
      expect(
        resolveStaleAction(
          job({ status, updatedAt: new Date(NOW - 10 * DEFAULT_STALE_MS) }),
          NOW,
        ),
      ).toBe("none");
    }
  });

  it("resumes a silent calendar job while attempts remain", () => {
    const stale = job({ updatedAt: new Date(NOW - CALENDAR_STALE_MS - 1) });
    expect(resolveStaleAction(stale, NOW)).toBe("resume");
    expect(
      resolveStaleAction({ ...stale, resumeCount: MAX_RESUMES - 1 }, NOW),
    ).toBe("resume");
  });

  it("fails a calendar job once resumes are exhausted", () => {
    expect(
      resolveStaleAction(
        job({
          updatedAt: new Date(NOW - CALENDAR_STALE_MS - 1),
          resumeCount: MAX_RESUMES,
        }),
        NOW,
      ),
    ).toBe("fail");
  });

  it("keeps the long fail-only window for non-resumable kinds", () => {
    const strategy = job({ kind: "strategy" });
    expect(
      resolveStaleAction(
        { ...strategy, updatedAt: new Date(NOW - CALENDAR_STALE_MS - 1) },
        NOW,
      ),
    ).toBe("none");
    expect(
      resolveStaleAction(
        { ...strategy, updatedAt: new Date(NOW - DEFAULT_STALE_MS - 1) },
        NOW,
      ),
    ).toBe("fail");
  });
});

describe("resumeCountFrom", () => {
  it("reads the counter from a running job's result payload", () => {
    expect(resumeCountFrom({ resumeCount: 2, progress: {} })).toBe(2);
  });

  it("defaults to zero for missing or malformed payloads", () => {
    expect(resumeCountFrom(null)).toBe(0);
    expect(resumeCountFrom({})).toBe(0);
    expect(resumeCountFrom({ resumeCount: "3" })).toBe(0);
    expect(resumeCountFrom("junk")).toBe(0);
  });
});

describe("isPausedForResume", () => {
  it("is true when the worker parked a deliberate pause", () => {
    expect(isPausedForResume({ paused: true })).toBe(true);
  });

  it("is false once the flag is cleared by a claim", () => {
    expect(isPausedForResume({ paused: false })).toBe(false);
  });

  it("is false for a job that never paused", () => {
    expect(isPausedForResume({ progress: { done: 1, total: 4 } })).toBe(false);
  });

  it("is false for null or non-object state", () => {
    expect(isPausedForResume(null)).toBe(false);
    expect(isPausedForResume("paused")).toBe(false);
  });
});

/* KOOS-AI-002: a design job that builds a set of frames checkpoints like a
   calendar and resumes the same way (H8); every other design job does not. */
describe("resumable design jobs", () => {
  const sequenceInput = { image: { source: "none" }, sequence: { frames: 6 } };

  it("names a set-of-frames design job resumable, and no other design job", () => {
    expect(
      isResumableJob({ kind: "design_render", input: sequenceInput }),
    ).toBe(true);
    expect(
      isResumableJob({ kind: "design_render", input: { image: {} } }),
    ).toBe(false);
    expect(isResumableJob({ kind: "design_render", input: null })).toBe(false);
    expect(isResumableJob({ kind: "calendar" })).toBe(true);
    expect(isResumableJob({ kind: "strategy", input: sequenceInput })).toBe(
      false,
    );
  });

  it("reads only a numeric frame count as a sequence", () => {
    expect(isSequenceJobInput({ sequence: { frames: "6" } })).toBe(false);
    expect(isSequenceJobInput({ sequence: null })).toBe(false);
    expect(isSequenceJobInput("sequence")).toBe(false);
  });

  it("watches a resumable design job on the calendar's short window", () => {
    expect(staleMsFor("design_render", true)).toBe(CALENDAR_STALE_MS);
    expect(staleMsFor("design_render")).toBe(DEFAULT_STALE_MS);
    expect(staleMsFor("calendar")).toBe(CALENDAR_STALE_MS);
  });

  it("resumes a silent set-of-frames job and fails it once resumes are spent", () => {
    const silent = job({
      kind: "design_render",
      resumable: true,
      updatedAt: new Date(NOW - CALENDAR_STALE_MS - 1),
    });
    expect(resolveStaleAction(silent, NOW)).toBe("resume");
    expect(
      resolveStaleAction({ ...silent, resumeCount: MAX_RESUMES }, NOW),
    ).toBe("fail");
  });

  it("reads a frame regenerate by its target id", () => {
    expect(
      isRegenerateFrameJobInput({ regenerateFrame: "f1", edits: null }),
    ).toBe(true);
    expect(isRegenerateFrameJobInput({ regenerateOf: "f1" })).toBe(false);
    expect(isRegenerateFrameJobInput({ regenerateFrame: 3 })).toBe(false);
    expect(isRegenerateFrameJobInput(null)).toBe(false);
  });

  /* The sweep must never take a set a live slice or a watching poller
     still holds: the worker beats every 20s within a 300s invocation, and
     a poller resumes within CALENDAR_STALE_MS of the last beat. */
  it("calls a set abandoned only well past a slice and every resume window", () => {
    expect(ABANDONED_SET_MS).toBeGreaterThan(300_000);
    expect(ABANDONED_SET_MS).toBeGreaterThan(
      SEQUENCE_SLICE_BUDGET_MS + CALENDAR_STALE_MS * 2,
    );
    expect(ABANDONED_SET_MS).toBeGreaterThan(DEFAULT_STALE_MS);
  });

  it("keeps a single design job on the long fail-only window", () => {
    const single = job({ kind: "design_render" });
    expect(
      resolveStaleAction(
        { ...single, updatedAt: new Date(NOW - CALENDAR_STALE_MS - 1) },
        NOW,
      ),
    ).toBe("none");
    expect(
      resolveStaleAction(
        { ...single, updatedAt: new Date(NOW - DEFAULT_STALE_MS - 1) },
        NOW,
      ),
    ).toBe("fail");
  });
});

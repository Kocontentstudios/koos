import { describe, expect, it } from "vitest";
import {
  CALENDAR_STALE_MS,
  DEFAULT_STALE_MS,
  MAX_RESUMES,
  resolveStaleAction,
  resumeCountFrom,
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

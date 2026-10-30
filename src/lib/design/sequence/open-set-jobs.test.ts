import { describe, expect, it } from "vitest";
import { openSetJobOf, parseOpenSetJobs } from "./open-set-jobs";
import { frameMarkFor, sequenceMarkFor, sequenceMarkOf } from "./progress-mark";

const SET = "9b1d7c1e-5f7e-4d4b-8f43-2f8f0c1a0b11";
const at = new Date("2026-10-30T12:00:00.000Z");

const row = (result: unknown, status = "running") => ({
  id: "job-1",
  status,
  result,
  createdAt: at,
});

describe("openSetJobOf", () => {
  it("reads a running set job by the mark on its progress", () => {
    expect(
      openSetJobOf(
        row({
          progress: {
            stage: "render",
            done: 1,
            total: 5,
            ...sequenceMarkFor("carousel", SET),
          },
        }),
      ),
    ).toEqual({
      jobId: "job-1",
      kind: "set",
      sequenceKind: "carousel",
      setId: SET,
      startedAt: at.getTime(),
    });
  });

  it("knows a set job before its plan is saved, with no set yet", () => {
    expect(
      openSetJobOf(
        row({
          progress: { stage: "brief", ...sequenceMarkFor("presentation") },
        }),
      )?.setId,
    ).toBeNull();
  });

  it("reads a regenerate-frame job as a frame job", () => {
    expect(
      openSetJobOf(row({ progress: frameMarkFor("carousel", SET, 3) }))?.kind,
    ).toBe("frame");
  });

  /* A directions run reports {stage, done, total} too; only the mark makes
     a job a set's. */
  it("leaves out a directions run, a finished job and a job with no report", () => {
    expect(
      openSetJobOf(row({ progress: { stage: "render", done: 0, total: 2 } })),
    ).toBeNull();
    expect(
      openSetJobOf(
        row({ progress: sequenceMarkFor("carousel", SET) }, "succeeded"),
      ),
    ).toBeNull();
    expect(openSetJobOf(row(null, "pending"))).toBeNull();
  });
});

describe("sequenceMarkOf", () => {
  it("keeps a frame index only with a set and a whole, non-negative index", () => {
    expect(sequenceMarkOf(frameMarkFor("carousel", SET, 0))).toEqual({
      sequenceKind: "carousel",
      setId: SET,
      frameIndex: 0,
    });
    expect(sequenceMarkOf({ sequenceKind: "carousel", frameIndex: 2 })).toEqual(
      { sequenceKind: "carousel" },
    );
    expect(
      sequenceMarkOf({ sequenceKind: "carousel", setId: SET, frameIndex: -1 }),
    ).toEqual({ sequenceKind: "carousel", setId: SET });
  });
});

describe("parseOpenSetJobs", () => {
  it("keeps well-formed jobs and drops the rest", () => {
    const good = {
      jobId: "j1",
      kind: "set",
      sequenceKind: "carousel",
      setId: null,
      startedAt: 1,
    };
    expect(
      parseOpenSetJobs({
        jobs: [good, { ...good, kind: "x" }, { jobId: 7 }, null],
      }),
    ).toEqual([good]);
    expect(parseOpenSetJobs(null)).toEqual([]);
    expect(parseOpenSetJobs({ jobs: "no" })).toEqual([]);
  });
});

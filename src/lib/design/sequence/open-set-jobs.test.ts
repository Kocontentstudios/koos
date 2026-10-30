import { describe, expect, it } from "vitest";
import { openSetJobOf, parseOpenSetJobs } from "./open-set-jobs";
import { frameMarkFor, sequenceMarkFor, sequenceMarkOf } from "./progress-mark";

const SET = "9b1d7c1e-5f7e-4d4b-8f43-2f8f0c1a0b11";
const at = new Date("2026-10-30T12:00:00.000Z");

const row = (result: unknown, status = "running", input: unknown = null) => ({
  id: "job-1",
  status,
  input,
  result,
  createdAt: at,
});

/* The inputs the generate and regenerate-frame routes write (U2). */
const SET_INPUT = {
  briefId: null,
  calendarItemId: null,
  attachments: [],
  image: { source: "none" },
  regenerateOf: null,
  sequence: { frames: 5, asked: 5 },
};
const FRAME_INPUT = { regenerateFrame: "gen-3", edits: null };
const DIRECTIONS_INPUT = {
  briefId: null,
  calendarItemId: null,
  attachments: [],
  image: { source: "none" },
  regenerateOf: null,
};

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

  /* Round 4 M3: the sequence job does not put the mark on its progress
     yet, so a list that read only the mark was always empty. */
  it("knows an unmarked set job by its input, and its set by its checkpoint", () => {
    expect(
      openSetJobOf(
        row(
          { progress: { stage: "brief", done: 0, total: 5 } },
          "running",
          SET_INPUT,
        ),
      ),
    ).toEqual({
      jobId: "job-1",
      kind: "set",
      sequenceKind: null,
      setId: null,
      startedAt: at.getTime(),
    });
    expect(
      openSetJobOf(
        row(
          {
            progress: { stage: "render", done: 2, total: 5 },
            checkpoint: { setId: SET, plan: { kind: "presentation" } },
          },
          "running",
          SET_INPUT,
        ),
      ),
    ).toMatchObject({ kind: "set", sequenceKind: "presentation", setId: SET });
    expect(openSetJobOf(row(null, "pending", SET_INPUT))?.kind).toBe("set");
  });

  it("knows an unmarked regenerate-frame job by its input", () => {
    expect(openSetJobOf(row(null, "pending", FRAME_INPUT))).toMatchObject({
      kind: "frame",
      setId: null,
    });
  });

  it("fills a mark that names no set from the checkpoint", () => {
    expect(
      openSetJobOf(
        row({
          progress: sequenceMarkFor("carousel"),
          checkpoint: { setId: SET },
        }),
      )?.setId,
    ).toBe(SET);
  });

  /* A directions run reports {stage, done, total} too, and its input has
     no sequence. */
  it("leaves out a directions run, a finished job and a job with no report", () => {
    expect(
      openSetJobOf(
        row(
          { progress: { stage: "render", done: 0, total: 2 } },
          "running",
          DIRECTIONS_INPUT,
        ),
      ),
    ).toBeNull();
    expect(
      openSetJobOf(row({ checkpoint: { setId: SET } }, "succeeded", SET_INPUT)),
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
    const unplanned = { ...good, jobId: "j2", sequenceKind: null };
    expect(
      parseOpenSetJobs({
        jobs: [
          good,
          unplanned,
          { ...good, kind: "x" },
          { ...good, sequenceKind: "deck" },
          { jobId: 7 },
          null,
        ],
      }),
    ).toEqual([good, unplanned]);
    expect(parseOpenSetJobs(null)).toEqual([]);
    expect(parseOpenSetJobs({ jobs: "no" })).toEqual([]);
  });
});

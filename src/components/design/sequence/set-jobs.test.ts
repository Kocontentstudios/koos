import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetSetJob,
  rememberSetJob,
  SET_JOB_TTL_MS,
  setJobsFor,
} from "./set-jobs";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the set jobs this browser started", () => {
  it("keeps each job once, per brand, until it is forgotten", () => {
    rememberSetJob({ jobId: "j1", brandId: "b1", kind: "set" }, 1000);
    rememberSetJob({ jobId: "j1", brandId: "b1", kind: "set" }, 2000);
    rememberSetJob({ jobId: "j2", brandId: "b2", kind: "frame" }, 2000);
    expect(setJobsFor("b1", 3000)).toEqual([
      { jobId: "j1", brandId: "b1", kind: "set", startedAt: 2000 },
    ]);
    forgetSetJob("j1", 3000);
    expect(setJobsFor("b1", 3000)).toEqual([]);
    expect(setJobsFor("b2", 3000)).toHaveLength(1);
  });

  it("drops a job past the point it could still be resumed", () => {
    rememberSetJob({ jobId: "j1", brandId: "b1", kind: "set" }, 0);
    expect(setJobsFor("b1", SET_JOB_TTL_MS + 1)).toEqual([]);
  });

  it("reads nothing from storage it cannot parse or trust", () => {
    window.localStorage.setItem("koos.design.setJobs.v1", "{not json");
    expect(setJobsFor("b1")).toEqual([]);
    window.localStorage.setItem(
      "koos.design.setJobs.v1",
      JSON.stringify([{ jobId: 7 }, { jobId: "j", brandId: "b1", kind: "x" }]),
    );
    expect(setJobsFor("b1")).toEqual([]);
  });

  /* Round 3: what this browser knew at the start (the kind the dialog
     expected, a frame job's set) travels with the job, so the grid can say
     "carousel" and stop only the set a failed job was building. */
  it("keeps a job's kind and set, and refuses a malformed one", () => {
    rememberSetJob(
      {
        jobId: "j1",
        brandId: "b1",
        kind: "frame",
        sequenceKind: "presentation",
        setId: "set-1",
      },
      1000,
    );
    expect(setJobsFor("b1", 2000)).toEqual([
      {
        jobId: "j1",
        brandId: "b1",
        kind: "frame",
        sequenceKind: "presentation",
        setId: "set-1",
        startedAt: 1000,
      },
    ]);
    window.localStorage.setItem(
      "koos.design.setJobs.v1",
      JSON.stringify([
        {
          jobId: "j",
          brandId: "b1",
          kind: "set",
          startedAt: 1,
          sequenceKind: "reel",
        },
        { jobId: "k", brandId: "b1", kind: "set", startedAt: 1, setId: 4 },
      ]),
    );
    expect(setJobsFor("b1", 2)).toEqual([]);
  });

  /* Private mode and blocked site data throw on access. */
  it("keeps working when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() =>
      rememberSetJob({ jobId: "j1", brandId: "b1", kind: "set" }),
    ).not.toThrow();
    expect(setJobsFor("b1")).toEqual([]);
    expect(() => forgetSetJob("j1")).not.toThrow();
  });
});

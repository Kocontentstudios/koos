import { describe, expect, it } from "vitest";
import { BRAND, frameRow, frameRows } from "./fixtures";
import { buildSet, type DesignSet } from "./set-model";
import {
  type LiveSetJob,
  placeholderJobs,
  STALLED_AFTER_MS,
  stalledSets,
} from "./use-set-watch";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");

function building(createdAt: string, setId = "set-a"): DesignSet {
  const rows = frameRows(3).map((r) => ({
    ...r,
    id: `${setId}-${r.id}`,
    createdAt,
    frame: r.frame ? { ...r.frame, setId, count: 3 } : null,
  }));
  rows[2] = {
    ...frameRow(2, { count: 3, status: "pending", url: null, createdAt }),
    id: `${setId}-f2`,
    frame: { setId, index: 2, count: 3, role: "cta", title: "Book now" },
  };
  return buildSet(BRAND, rows) as DesignSet;
}

const live = (
  setId: string | null = null,
  startedAt = NOW - 120_000,
  jobId = "j1",
): LiveSetJob => ({
  jobId,
  setId,
  kind: "carousel",
  frameCount: 3,
  done: 2,
  rendering: true,
  startedAt,
});

const none = new Set<string>();
const recently = new Date(NOW - 60_000).toISOString();
const longAgo = new Date(NOW - STALLED_AFTER_MS - 1).toISOString();

describe("stalledSets", () => {
  it("keeps a set coming while a job of ours could be building it", () => {
    expect(
      stalledSets([building(longAgo)], [live()], new Set(["set-a"]), NOW).size,
    ).toBe(0);
    expect(
      stalledSets([building(longAgo)], [live("set-a")], none, NOW).size,
    ).toBe(0);
  });

  it("stops a set once the job known to build it ended without delivering", () => {
    expect([
      ...stalledSets([building(recently)], [], new Set(["set-a"]), NOW),
    ]).toEqual(["set-a"]);
  });

  it("stops a set past any set's time with no job of ours to ask", () => {
    expect([...stalledSets([building(longAgo)], [], none, NOW)]).toEqual([
      "set-a",
    ]);
    expect(stalledSets([building(recently)], [], none, NOW).size).toBe(0);
  });

  it("does not count a job building another set", () => {
    expect([
      ...stalledSets([building(longAgo)], [live("set-b")], none, NOW),
    ]).toEqual(["set-a"]);
  });

  it("leaves a finished set alone", () => {
    const done = buildSet(BRAND, frameRows(3)) as DesignSet;
    expect(stalledSets([done], [], new Set([done.setId]), NOW).size).toBe(0);
  });

  /* Round 3 M2: one ended job used to stop every building set for the rest
     of the session, and offer a billed retry on frames another job was
     still drawing. */
  it("stops only the set whose job ended, never a recent set it did not build", () => {
    const a = building(recently, "set-a");
    const b = building(recently, "set-b");
    expect([...stalledSets([a, b], [], new Set(["set-a"]), NOW)]).toEqual([
      "set-a",
    ]);
  });
});

describe("placeholderJobs", () => {
  it("holds a place for a job whose set has no card yet", () => {
    expect(placeholderJobs([live("set-x")], [building(recently)])).toEqual([
      live("set-x"),
    ]);
    expect(placeholderJobs([live()], [])).toEqual([live()]);
  });

  /* Round 3 L6: in the checks stage the finished card and a "Frame 5 of
     5…" placeholder showed side by side. */
  it("shows no placeholder for a job whose set already has its card", () => {
    expect(placeholderJobs([live("set-a")], [building(recently)])).toEqual([]);
    const done = buildSet(BRAND, frameRows(3)) as DesignSet;
    expect(
      placeholderJobs(
        [live(null, Date.parse(frameRows(3)[0]?.createdAt ?? ""))],
        [done],
      ),
    ).toEqual([]);
  });

  /* Round 3 L6: another set still building hid the placeholder of a new
     one. */
  it("keeps a new job's placeholder while an older set is still building", () => {
    const older = building(new Date(NOW - 600_000).toISOString(), "set-old");
    const fresh = live(null, NOW - 5_000, "j-new");
    expect(placeholderJobs([fresh], [older])).toEqual([fresh]);
  });

  it("gives each unnamed job at most one set, the first written after it", () => {
    const first = building(new Date(NOW - 100_000).toISOString(), "set-1");
    const second = building(new Date(NOW - 10_000).toISOString(), "set-2");
    const early = live(null, NOW - 110_000, "j-early");
    const late = live(null, NOW - 20_000, "j-late");
    const third = live(null, NOW - 1_000, "j-third");
    expect(
      placeholderJobs([early, late, third], [first, second]).map(
        (j) => j.jobId,
      ),
    ).toEqual(["j-third"]);
  });
});

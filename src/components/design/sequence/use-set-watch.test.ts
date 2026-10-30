import { describe, expect, it } from "vitest";
import { BRAND, frameRow, frameRows } from "./fixtures";
import { buildSet, type DesignSet } from "./set-model";
import {
  type LiveSetJob,
  STALLED_AFTER_MS,
  stalledSets,
} from "./use-set-watch";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");

function building(createdAt: string, setId = "set-a"): DesignSet {
  const rows = frameRows(3).map((r) => ({
    ...r,
    frame: r.frame ? { ...r.frame, setId, count: 3 } : null,
  }));
  rows[2] = {
    ...frameRow(2, { count: 3, status: "pending", url: null, createdAt }),
    frame: { setId, index: 2, count: 3, role: "cta", title: "Book now" },
  };
  return buildSet(BRAND, rows) as DesignSet;
}

const live = (setId: string | null = null): LiveSetJob => ({
  jobId: "j1",
  setId,
  kind: "carousel",
  frameCount: 3,
  done: 2,
  rendering: true,
});

const recently = new Date(NOW - 60_000).toISOString();
const longAgo = new Date(NOW - STALLED_AFTER_MS - 1).toISOString();

describe("stalledSets", () => {
  it("keeps a set coming while a job of ours could be building it", () => {
    expect(stalledSets([building(longAgo)], [live()], true, NOW).size).toBe(0);
    expect(
      stalledSets([building(longAgo)], [live("set-a")], false, NOW).size,
    ).toBe(0);
  });

  it("stops a set once a job of ours ended without delivering it", () => {
    expect([...stalledSets([building(recently)], [], true, NOW)]).toEqual([
      "set-a",
    ]);
  });

  it("stops a set past any set's time with no job of ours to ask", () => {
    expect([...stalledSets([building(longAgo)], [], false, NOW)]).toEqual([
      "set-a",
    ]);
    expect(stalledSets([building(recently)], [], false, NOW).size).toBe(0);
  });

  it("does not count a job building another set", () => {
    expect([
      ...stalledSets([building(longAgo)], [live("set-b")], false, NOW),
    ]).toEqual(["set-a"]);
  });

  it("leaves a finished set alone", () => {
    const done = buildSet(BRAND, frameRows(3)) as DesignSet;
    expect(stalledSets([done], [], true, NOW).size).toBe(0);
  });
});

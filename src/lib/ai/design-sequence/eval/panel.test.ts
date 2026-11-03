import { describe, expect, it } from "vitest";
import {
  blockingFaults,
  calibrationChecks,
  type GroupSummary,
  type PanelGroup,
  type PanelJudgment,
  panelGate,
  panelJobs,
  summarizeGroup,
} from "./panel";

const ids = ["a", "b"];

function judgments(
  group: PanelGroup,
  perFixture: Record<string, [number, number, number][]>,
): PanelJudgment[] {
  return Object.entries(perFixture).flatMap(([fixtureId, passes]) =>
    passes.map(([hook, lastAction, nonRepetitive], pass) => ({
      group,
      fixtureId,
      pass,
      scores: { hook, lastAction, nonRepetitive },
    })),
  );
}

const flat = (
  hook: number,
  lastAction: number,
  nonRepetitive: number,
): GroupSummary => ({
  means: { hook, lastAction, nonRepetitive },
  withinSd: { hook: 0, lastAction: 0, nonRepetitive: 0 },
  judged: 24,
  failed: 0,
});

const failedNames = (checks: { name: string; pass: boolean }[]) =>
  checks.filter((c) => !c.pass).map((c) => c.name);

describe("panelJobs", () => {
  it("judges every group's set each pass, in a shuffled order", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const jobs = panelJobs(ids, 3, random);
    expect(jobs).toHaveLength(18);
    const key = (j: { group: string; fixtureId: string; pass: number }) =>
      `${j.group}/${j.fixtureId}/${j.pass}`;
    expect(new Set(jobs.map(key)).size).toBe(18);
    expect(jobs.map(key)).not.toEqual(
      ["expert", "ours", "floor"].flatMap((g) =>
        ids.flatMap((id) => [0, 1, 2].map((p) => `${g}/${id}/${p}`)),
      ),
    );
  });
});

describe("summarizeGroup", () => {
  it("means every judgment and averages each set's spread across passes", () => {
    const all = [
      ...judgments("expert", {
        a: [
          [3, 5, 3],
          [4, 5, 3],
          [5, 5, 3],
        ],
        b: [
          [4, 5, 4],
          [4, 5, 4],
          [4, 5, 4],
        ],
      }),
      { group: "expert" as const, fixtureId: "b", pass: 3, scores: null },
      ...judgments("floor", { a: [[1, 2, 1]] }),
    ];
    const s = summarizeGroup(all, "expert");
    expect(s.means.hook).toBeCloseTo(4);
    expect(s.means.nonRepetitive).toBeCloseTo(3.5);
    expect(s.withinSd.hook).toBeCloseTo(Math.sqrt(2 / 3) / 2);
    expect(s.withinSd.lastAction).toBe(0);
    expect(s.judged).toBe(6);
    expect(s.failed).toBe(1);
  });

  it("reports an unjudged group as not measured", () => {
    const s = summarizeGroup([], "ours");
    expect(s.means.hook).toBeNull();
    expect(s.judged).toBe(0);
  });
});

describe("panelGate", () => {
  const expert = flat(3.6, 4.96, 3.4);
  const floor = flat(1.4, 2.2, 1.0);

  it("passes ours within 0.2 of expert, 1.5 above floor, at 4 where expert is", () => {
    const checks = panelGate({
      summary: { expert, ours: flat(3.4, 4.8, 3.2), floor },
      blockingFaultsShipped: 0,
    });
    expect(failedNames(checks)).toEqual([]);
    expect(checks.map((c) => c.name)).toContain(
      "lastAction: ours >= 4 (expert reaches it)",
    );
    expect(checks.map((c) => c.name)).not.toContain(
      "hook: ours >= 4 (expert reaches it)",
    );
  });

  it("holds ours to exactly expert - 0.2, despite floating point", () => {
    const checks = panelGate({
      summary: { expert, ours: flat(3.4, 4.76, 3.2), floor },
      blockingFaultsShipped: 0,
    });
    expect(failedNames(checks)).toEqual([]);
    const under = panelGate({
      summary: { expert, ours: flat(3.39, 4.76, 3.2), floor },
      blockingFaultsShipped: 0,
    });
    expect(failedNames(under)).toEqual(["hook: ours >= expert - 0.2"]);
  });

  it("fails an axis too close to the floor", () => {
    const low = flat(2.0, 1.0, 1.0);
    const checks = panelGate({
      summary: { expert: low, ours: flat(2.0, 1.0, 2.6), floor: low },
      blockingFaultsShipped: 0,
    });
    expect(failedNames(checks)).toEqual([
      "hook: ours >= floor + 1.5",
      "lastAction: ours >= floor + 1.5",
    ]);
  });

  it("applies the absolute 4.0 only where expert reaches it", () => {
    const checks = panelGate({
      summary: {
        expert: flat(4.1, 5, 3.4),
        ours: flat(3.95, 4.9, 3.3),
        floor,
      },
      blockingFaultsShipped: 0,
    });
    expect(failedNames(checks)).toEqual([
      "hook: ours >= 4 (expert reaches it)",
    ]);
  });

  it("fails a blocking fault shipped, a failed judge call and an unmeasured axis", () => {
    const ours: GroupSummary = {
      ...flat(3.6, 5, 3.4),
      means: { hook: null, lastAction: 5, nonRepetitive: 3.4 },
      failed: 2,
    };
    const checks = panelGate({
      summary: { expert, ours, floor },
      blockingFaultsShipped: 1,
    });
    expect(failedNames(checks)).toEqual([
      "hook: ours >= expert - 0.2",
      "hook: ours >= floor + 1.5",
      "blocking faults shipped = 0",
      "every judgment measured",
    ]);
  });
});

describe("calibrationChecks", () => {
  it("accepts a judge that rejects the floor by 1.5 and agrees with itself", () => {
    const summary = {
      expert: flat(3.6, 4.96, 3.4),
      ours: flat(3.3, 4.96, 3.1),
      floor: flat(1.4, 2.2, 1.0),
    };
    expect(failedNames(calibrationChecks(summary))).toEqual([]);
  });

  it("refuses a judge that lifts the floor or disagrees across passes", () => {
    const noisy: GroupSummary = {
      ...flat(3.3, 4.96, 3.1),
      withinSd: { hook: 0.5, lastAction: 0, nonRepetitive: 0 },
    };
    const summary = {
      expert: flat(3.6, 4.96, 3.4),
      ours: noisy,
      floor: flat(1.4, 2.2, 2.0),
    };
    expect(failedNames(calibrationChecks(summary))).toEqual([
      "hook: within-set sd <= 0.4",
      "nonRepetitive: expert - floor >= 1.5",
    ]);
  });
});

describe("blockingFaults", () => {
  it("counts what the planner reports and what the job would refuse", () => {
    expect(
      blockingFaults({
        frameCount: 5,
        plannedFrames: 4,
        refused: [{ frame: 2, detail: "repeats frame 2" }],
        problems: [
          { frame: 0, rule: "offering-unnamed", detail: "no offering" },
          { frame: 3, rule: "copy-length", detail: "long" },
        ],
      }),
    ).toEqual([
      "frame 3: repeats frame 2",
      "frame 1: offering-unnamed: no offering",
      "set: count: planned 4 of 5",
    ]);
  });

  it("is empty for a set production ships", () => {
    expect(
      blockingFaults({
        frameCount: 5,
        plannedFrames: 5,
        refused: [],
        problems: [],
      }),
    ).toEqual([]);
  });
});

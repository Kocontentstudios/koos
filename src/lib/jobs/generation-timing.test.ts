import { describe, expect, it } from "vitest";
import { percentile, summariseGeneration } from "./generation-timing";

describe("percentile", () => {
  /* Nearest-rank, not interpolated: these are wall-clock samples of real
     calls, and "the 95th slowest call took X" is the sentence an operator
     wants. An interpolated value names a duration nothing actually took. */
  it("returns a value that was actually observed", () => {
    const xs = [10, 20, 30, 40, 100];
    expect(xs).toContain(percentile(xs, 50));
    expect(xs).toContain(percentile(xs, 95));
  });

  it("puts p50 in the middle and p95 near the tail", () => {
    const xs = [10, 20, 30, 40, 100];
    expect(percentile(xs, 50)).toBe(30);
    expect(percentile(xs, 95)).toBe(100);
  });

  it("does not care what order the samples arrive in", () => {
    expect(percentile([100, 10, 40, 20, 30], 50)).toBe(30);
  });

  it("handles a single sample and an empty set", () => {
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("summariseGeneration", () => {
  const units = [
    { key: "0:0", slots: 4, ms: 8_000, inputTokens: 3_000, outputTokens: 900 },
    { key: "0:4", slots: 4, ms: 12_000, inputTokens: 3_100, outputTokens: 950 },
    { key: "1:0", slots: 2, ms: 30_000, inputTokens: 2_800, outputTokens: 500 },
  ];

  it("reports the shape an operator needs to set a budget", () => {
    const s = summariseGeneration({
      outlineMs: 40_000,
      totalMs: 95_000,
      concurrency: 5,
      units,
    });

    expect(s.outlineMs).toBe(40_000);
    expect(s.totalMs).toBe(95_000);
    expect(s.unitCount).toBe(3);
    expect(s.slotCount).toBe(10);
    expect(s.unitMs.p50).toBe(12_000);
    expect(s.unitMs.max).toBe(30_000);
  });

  /* The number that decides whether prompt-trimming or concurrency is the
     lever: input tokens are paid on every unit call and are dominated by
     whatever the prompt re-sends. */
  it("totals tokens and reports the per-call input cost", () => {
    const s = summariseGeneration({
      outlineMs: 40_000,
      totalMs: 95_000,
      concurrency: 5,
      units,
    });
    expect(s.tokens.input).toBe(8_900);
    expect(s.tokens.output).toBe(2_350);
    expect(s.tokens.inputPerUnit).toBe(Math.round(8_900 / 3));
  });

  /* Waves are what concurrency actually buys: 3 units at 5 wide is one wave,
     and raising the limit cannot help a run that is already one wave deep. */
  it("derives how many waves the concurrency produced", () => {
    expect(
      summariseGeneration({ outlineMs: 0, totalMs: 0, concurrency: 5, units })
        .waves,
    ).toBe(1);
    expect(
      summariseGeneration({ outlineMs: 0, totalMs: 0, concurrency: 2, units })
        .waves,
    ).toBe(2);
  });

  /* The outline is serial and blocking, so the share it takes is the ceiling
     on what parallelising the rest can ever win back. */
  it("reports the outline's share of the run", () => {
    const s = summariseGeneration({
      outlineMs: 40_000,
      totalMs: 100_000,
      concurrency: 5,
      units,
    });
    expect(s.outlineShare).toBeCloseTo(0.4, 5);
  });

  it("survives a run with no brief units", () => {
    const s = summariseGeneration({
      outlineMs: 40_000,
      totalMs: 40_000,
      concurrency: 5,
      units: [],
    });
    expect(s.unitCount).toBe(0);
    expect(s.unitMs.p50).toBeNull();
    expect(s.waves).toBe(0);
  });

  it("renders one machine-readable line for the log", () => {
    const line = summariseGeneration({
      outlineMs: 40_000,
      totalMs: 95_000,
      concurrency: 5,
      units,
    }).logLine;
    expect(line).toContain("calendar-timing");
    expect(() =>
      JSON.parse(line.replace("calendar-timing ", "")),
    ).not.toThrow();
  });
});

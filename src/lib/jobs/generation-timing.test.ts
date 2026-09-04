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

  it("clamps the ends", () => {
    const xs = [10, 20, 30];
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 100)).toBe(30);
  });

  /* Nearest-rank at n=2 puts p50 on the lower sample. Surprising enough to
     pin, so nobody "fixes" it into an interpolated value. */
  it("takes the lower of two samples for p50", () => {
    expect(percentile([10, 20], 50)).toBe(10);
  });
});

describe("summariseGeneration", () => {
  const units = [
    {
      key: "0:0",
      slots: 4,
      ms: 8_000,
      attempts: 1,
      inputTokens: 3_000,
      outputTokens: 900,
    },
    {
      key: "0:4",
      slots: 4,
      ms: 12_000,
      attempts: 1,
      inputTokens: 3_100,
      outputTokens: 950,
    },
    {
      key: "1:0",
      slots: 2,
      ms: 30_000,
      attempts: 3,
      inputTokens: 2_800,
      outputTokens: 500,
    },
  ];

  const base = {
    jobId: "job-1",
    outcome: "complete" as const,
    outlineMs: 40_000,
    totalMs: 95_000,
    concurrency: 5,
    outlineTokens: { input: 2_894, output: 5_123 },
    units,
  };

  it("reports the shape a budget gets argued from", () => {
    const s = summariseGeneration(base);
    expect(s.jobId).toBe("job-1");
    expect(s.outcome).toBe("complete");
    expect(s.unitCount).toBe(3);
    expect(s.slotCount).toBe(10);
    expect(s.unitMs.p50).toBe(12_000);
    expect(s.unitMs.max).toBe(30_000);
  });

  /* A slow run WITH retries is a throttling story; a slow run without them is
     a decode story, and they need opposite fixes. */
  it("counts units that had to retry", () => {
    expect(summariseGeneration(base).retriedUnits).toBe(1);
  });

  it("keeps the outline's tokens separate from the units'", () => {
    const s = summariseGeneration(base);
    expect(s.tokens.input).toBe(8_900);
    expect(s.tokens.outlineInput).toBe(2_894);
    expect(s.tokens.outlineOutput).toBe(5_123);
  });

  /* "Free" and "unknown" are different answers to a cost question, and
     withRetry only returns the last attempt's usage. */
  it("reports null rather than zero when no usage was reported", () => {
    const s = summariseGeneration({
      ...base,
      units: [{ key: "0:0", slots: 4, ms: 8_000, attempts: 1 }],
    });
    expect(s.tokens.inputPerUnit).toBeNull();
    expect(s.tokens.unitsWithUsage).toBe(0);
  });

  it("averages over only the units that reported usage", () => {
    const s = summariseGeneration({
      ...base,
      units: [
        { key: "a", slots: 4, ms: 1, attempts: 1, inputTokens: 1_000 },
        { key: "b", slots: 4, ms: 1, attempts: 3 },
      ],
    });
    expect(s.tokens.inputPerUnit).toBe(1_000);
    expect(s.tokens.unitsWithUsage).toBe(1);
  });

  it("reports the outline's share of the run", () => {
    expect(
      summariseGeneration({ ...base, totalMs: 100_000 }).outlineShare,
    ).toBeCloseTo(0.4, 5);
  });

  it("does not divide by zero on an instant run", () => {
    expect(summariseGeneration({ ...base, totalMs: 0 }).outlineShare).toBe(0);
  });

  it("survives a run with no brief units", () => {
    const s = summariseGeneration({ ...base, units: [] });
    expect(s.unitCount).toBe(0);
    expect(s.unitMs.p50).toBeNull();
    expect(s.retriedUnits).toBe(0);
  });

  /* The whole object is the log payload — a consumer strips a fixed prefix and
     pipes the rest to jq, so it must be serialisable with nothing nested. */
  it("serialises cleanly", () => {
    expect(() =>
      JSON.parse(JSON.stringify(summariseGeneration(base))),
    ).not.toThrow();
  });
});

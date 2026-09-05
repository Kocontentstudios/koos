import { describe, expect, it } from "vitest";
import {
  bucketByPeriod,
  formatDuration,
  formatPercentChange,
  median,
  percentChange,
  toBarPercentages,
} from "./rollup";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

describe("bucketByPeriod", () => {
  it("returns one bucket per period, oldest first", () => {
    const buckets = bucketByPeriod([], { now: NOW, periodDays: 7, periods: 4 });
    expect(buckets).toHaveLength(4);
    expect(buckets[0].start.getTime()).toBeLessThan(buckets[3].start.getTime());
    expect(buckets[3].end.getTime()).toBe(NOW.getTime());
  });

  /* A chart that drops quiet periods compresses its own x-axis and reads as
     steady activity. Empty buckets have to survive. */
  it("keeps empty periods rather than dropping them", () => {
    const buckets = bucketByPeriod([daysAgo(1)], {
      now: NOW,
      periodDays: 7,
      periods: 3,
    });
    expect(buckets.map((b) => b.count)).toEqual([0, 0, 1]);
  });

  it("places a timestamp in the period that contains it", () => {
    const buckets = bucketByPeriod([daysAgo(1), daysAgo(8), daysAgo(15)], {
      now: NOW,
      periodDays: 7,
      periods: 3,
    });
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 1]);
  });

  it("ignores timestamps older than the window", () => {
    const buckets = bucketByPeriod([daysAgo(400)], {
      now: NOW,
      periodDays: 7,
      periods: 2,
    });
    expect(buckets.map((b) => b.count)).toEqual([0, 0]);
  });

  it("ignores timestamps in the future", () => {
    const future = new Date(NOW.getTime() + DAY_MS);
    const buckets = bucketByPeriod([future], {
      now: NOW,
      periodDays: 7,
      periods: 2,
    });
    expect(buckets.map((b) => b.count)).toEqual([0, 0]);
  });

  /* Exactly-now divides into one index past the last bucket. Without the
     clamp this writes to buckets[periods], silently losing the event. */
  it("counts a timestamp landing exactly on now", () => {
    const buckets = bucketByPeriod([new Date(NOW)], {
      now: NOW,
      periodDays: 7,
      periods: 2,
    });
    expect(buckets[1].count).toBe(1);
  });

  it("counts a timestamp on a period boundary in the later period", () => {
    const buckets = bucketByPeriod([daysAgo(7)], {
      now: NOW,
      periodDays: 7,
      periods: 2,
    });
    expect(buckets.map((b) => b.count)).toEqual([0, 1]);
  });

  it("returns nothing for a zero or negative period count", () => {
    expect(bucketByPeriod([], { now: NOW, periodDays: 7, periods: 0 })).toEqual(
      [],
    );
    expect(bucketByPeriod([], { now: NOW, periodDays: 0, periods: 4 })).toEqual(
      [],
    );
  });

  it("produces contiguous windows with no gap or overlap", () => {
    const buckets = bucketByPeriod([], { now: NOW, periodDays: 7, periods: 5 });
    for (let i = 1; i < buckets.length; i += 1) {
      expect(buckets[i].start.getTime()).toBe(buckets[i - 1].end.getTime());
    }
  });
});

describe("percentChange", () => {
  it("computes an ordinary increase", () => {
    expect(percentChange(120, 100)).toBeCloseTo(20);
  });

  it("computes a decrease as negative", () => {
    expect(percentChange(80, 100)).toBeCloseTo(-20);
  });

  /* 0 to 5 is not "+500%", it has no percentage. Rendering one is a lie that
     looks authoritative. */
  it("is null when the previous period was empty", () => {
    expect(percentChange(5, 0)).toBeNull();
  });

  it("is null for zero over zero rather than NaN", () => {
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe("formatPercentChange", () => {
  it("marks direction with an arrow", () => {
    expect(formatPercentChange(18)).toBe("↑18%");
    expect(formatPercentChange(-4)).toBe("↓4%");
  });

  it("shows a dash when there is no comparison", () => {
    expect(formatPercentChange(null)).toBe("—");
  });

  it("shows flat rather than a zero-width arrow", () => {
    expect(formatPercentChange(0.2)).toBe("0%");
  });

  it("survives a non-finite value", () => {
    expect(formatPercentChange(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("median", () => {
  it("takes the middle of an odd-length set", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middles of an even-length set", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is null for an empty set", () => {
    expect(median([])).toBeNull();
  });

  it("does not mutate its input", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  /* Default sort is lexicographic, which puts 10 before 9. */
  it("sorts numerically, not lexicographically", () => {
    expect(median([1, 9, 10])).toBe(9);
  });
});

describe("formatDuration", () => {
  it("uses days above a day", () => {
    expect(formatDuration(2.3 * DAY_MS)).toBe("2.3d");
  });

  it("uses hours below a day", () => {
    expect(formatDuration(5 * 3_600_000)).toBe("5h");
  });

  it("never rounds a real duration down to zero minutes", () => {
    expect(formatDuration(10_000)).toBe("1m");
  });

  it("shows a dash for no data", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("toBarPercentages", () => {
  it("scales against the largest value", () => {
    expect(toBarPercentages([5, 10])).toEqual([50, 100]);
  });

  /* Every bar full-width would read as "all equal" instead of "no data". */
  it("returns all zeroes when every value is zero", () => {
    expect(toBarPercentages([0, 0])).toEqual([0, 0]);
  });

  it("handles an empty series", () => {
    expect(toBarPercentages([])).toEqual([]);
  });
});

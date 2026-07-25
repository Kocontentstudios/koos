import { describe, expect, it, vi } from "vitest";
import type { CalendarOutline, CalendarSlot } from "@/lib/ai/calendar-schema";
import {
  assembleCalendarItems,
  fallbackBrief,
  mapWithConcurrency,
  withRetry,
} from "./calendar-assembly";

function slot(overrides: Partial<CalendarSlot> = {}): CalendarSlot {
  return {
    dayOffset: 0,
    time: "9:00 AM",
    platform: "Instagram",
    contentType: "carousel",
    title: "Launch teaser",
    designRequired: true,
    designType: "carousel",
    dimensions: "1080x1350",
    ...overrides,
  };
}

describe("withRetry", () => {
  it("returns the first successful result", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries after a failure and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("schema mismatch"))
      .mockResolvedValueOnce("ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error once attempts are exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still broken"));
    await expect(withRetry(fn, 3, { sleep: async () => {} })).rejects.toThrow(
      "still broken",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("backs off between attempts but not after the last one", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new Error("throttled"));
    await expect(withRetry(fn, 3, { sleep })).rejects.toThrow("throttled");
    // Two waits for three attempts, growing exponentially.
    expect(sleep).toHaveBeenCalledTimes(2);
    const [first, second] = sleep.mock.calls.map(([ms]) => ms as number);
    expect(first).toBeGreaterThanOrEqual(2000);
    expect(second).toBeGreaterThanOrEqual(8000);
  });

  it("does not sleep when the first attempt succeeds", async () => {
    const sleep = vi.fn();
    await expect(withRetry(async () => "ok", 3, { sleep })).resolves.toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in the results", async () => {
    const results = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 5));
      return n * 10;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
      },
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("rejects when any item fails", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("handles an empty list", async () => {
    await expect(mapWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });
});

describe("assembleCalendarItems", () => {
  const segments: CalendarOutline["segments"] = [
    {
      theme: "Week 1: launch hype",
      slots: [slot({ dayOffset: 0 }), slot({ dayOffset: 2, title: "Poll" })],
    },
    {
      theme: "Week 2: social proof",
      slots: [slot({ dayOffset: 7, title: "Testimonial" })],
    },
  ];

  it("pairs briefs to slots by index and keeps slot fields authoritative", () => {
    const items = assembleCalendarItems(segments, [
      {
        briefs: [
          { slotIndex: 0, brief: "**Title**\nTeaser brief" },
          { slotIndex: 1, brief: "**Title**\nPoll brief" },
        ],
      },
      { briefs: [{ slotIndex: 0, brief: "**Title**\nTestimonial brief" }] },
    ]);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      dayOffset: 0,
      title: "Launch teaser",
      brief: "**Title**\nTeaser brief",
    });
    expect(items[2]).toMatchObject({
      dayOffset: 7,
      title: "Testimonial",
      brief: "**Title**\nTestimonial brief",
    });
  });

  it("falls back to a generated brief when a chunk misses a slot", () => {
    const items = assembleCalendarItems(segments, [
      { briefs: [{ slotIndex: 0, brief: "**Title**\nTeaser brief" }] },
      { briefs: [{ slotIndex: 0, brief: "**Title**\nTestimonial brief" }] },
    ]);
    expect(items[1].brief).toBe(fallbackBrief(segments[0].slots[1]));
    expect(items[1].brief).toContain("Poll");
  });

  it("ignores out-of-range slot indexes and null chunks", () => {
    const items = assembleCalendarItems(segments, [
      { briefs: [{ slotIndex: 99, brief: "orphan brief" }] },
      null,
    ]);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.brief).not.toBe("orphan brief");
      expect(item.brief.length).toBeGreaterThan(0);
    }
  });

  it("never drops or reorders slots regardless of chunk order", () => {
    const items = assembleCalendarItems(segments, [
      {
        briefs: [
          { slotIndex: 1, brief: "second" },
          { slotIndex: 0, brief: "first" },
        ],
      },
      { briefs: [{ slotIndex: 0, brief: "third" }] },
    ]);
    expect(items.map((i) => i.brief)).toEqual(["first", "second", "third"]);
  });
});

describe("assembleCalendarItems slot keys", () => {
  it("assigns a segment-and-slot key to every item", () => {
    const segments = [
      {
        theme: "Launch",
        slots: [
          {
            dayOffset: 0,
            time: "9:00 AM",
            platform: "Instagram",
            contentType: "post",
            title: "A",
            designRequired: false,
          },
          {
            dayOffset: 1,
            time: "9:00 AM",
            platform: "Instagram",
            contentType: "post",
            title: "B",
            designRequired: false,
          },
        ],
      },
      {
        theme: "Grow",
        slots: [
          {
            dayOffset: 7,
            time: "9:00 AM",
            platform: "Instagram",
            contentType: "post",
            title: "C",
            designRequired: false,
          },
        ],
      },
    ];
    const items = assembleCalendarItems(segments, [null, null]);
    expect(items.map((i) => i.slotKey)).toEqual(["0:0", "0:1", "1:0"]);
  });
});

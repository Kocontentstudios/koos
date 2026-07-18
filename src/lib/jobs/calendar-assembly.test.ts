import { describe, expect, it, vi } from "vitest";
import type { CalendarOutline, CalendarSlot } from "@/lib/ai/calendar-schema";
import {
  assembleCalendarItems,
  fallbackBrief,
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
    await expect(withRetry(fn, 3)).rejects.toThrow("still broken");
    expect(fn).toHaveBeenCalledTimes(3);
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

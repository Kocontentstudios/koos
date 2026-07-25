import { describe, expect, it } from "vitest";
import {
  itemDate,
  parseTimeToMinutes,
  resolveStartDate,
  toCalendarRows,
  utcMidnight,
} from "./schedule";

describe("resolveStartDate", () => {
  const today = new Date("2026-07-11T15:00:00Z");

  it("uses a valid future date from the plan", () => {
    expect(resolveStartDate("2026-08-01", today).toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });
  it("clamps a past date to today (UTC midnight)", () => {
    expect(resolveStartDate("2026-07-01", today).toISOString()).toBe(
      "2026-07-11T00:00:00.000Z",
    );
  });
  it("falls back to today when the plan omits or malforms the date", () => {
    expect(resolveStartDate(undefined, today).toISOString()).toBe(
      "2026-07-11T00:00:00.000Z",
    );
    expect(resolveStartDate("August 1st", today).toISOString()).toBe(
      "2026-07-11T00:00:00.000Z",
    );
    expect(resolveStartDate("2026-13-45", today).toISOString()).toBe(
      "2026-07-11T00:00:00.000Z",
    );
  });
  it("falls back to today when the date is more than a year out", () => {
    expect(resolveStartDate("2028-01-01", today).toISOString()).toBe(
      "2026-07-11T00:00:00.000Z",
    );
  });
});

describe("itemDate", () => {
  it("adds whole days to the start", () => {
    const start = utcMidnight(new Date("2026-06-15T00:00:00Z"));
    expect(itemDate(start, 0).toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(itemDate(start, 8).toISOString()).toBe("2026-06-23T00:00:00.000Z");
  });
});

describe("parseTimeToMinutes", () => {
  it("parses 12-hour and 24-hour times", () => {
    expect(parseTimeToMinutes("9:00 AM")).toBe(540);
    expect(parseTimeToMinutes("12:00 PM")).toBe(720);
    expect(parseTimeToMinutes("12:00 AM")).toBe(0);
    expect(parseTimeToMinutes("13:30")).toBe(810);
  });
  it("falls back to 0 for unparseable input", () => {
    expect(parseTimeToMinutes("whenever")).toBe(0);
  });
});

describe("toCalendarRows", () => {
  const start = new Date("2026-06-15T00:00:00Z"); // Monday
  const plan = {
    startDate: "2026-06-15",
    items: [
      {
        dayOffset: 2,
        time: "9:00 AM",
        platform: "Instagram",
        contentType: "Reel",
        title: "B",
        brief: "b",
        designRequired: true,
        designType: "Reel",
        dimensions: "1080x1920",
        slotKey: "0:0",
      },
      {
        dayOffset: 0,
        time: "3:00 PM",
        platform: "Blog",
        contentType: "Post",
        title: "A2",
        brief: "a2",
        designRequired: false,
        slotKey: "0:1",
      },
      {
        dayOffset: 0,
        time: "8:00 AM",
        platform: "Email",
        contentType: "Blast",
        title: "A1",
        brief: "a1",
        designRequired: false,
        slotKey: "0:2",
      },
    ],
  };

  it("computes dates, sorts by date then time, and assigns sortOrder", () => {
    const { startDate, endDate, rows } = toCalendarRows(plan, start);
    expect(startDate.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(endDate.toISOString()).toBe("2026-06-17T00:00:00.000Z");
    expect(rows.map((r) => r.title)).toEqual(["A1", "A2", "B"]);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.slotKey)).toEqual(["0:2", "0:1", "0:0"]);
    expect(rows[2].date.toISOString()).toBe("2026-06-17T00:00:00.000Z");
  });
});

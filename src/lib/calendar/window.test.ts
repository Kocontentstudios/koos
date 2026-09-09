import { describe, expect, it } from "vitest";
import {
  dateBounds,
  dateInputValue,
  expandWindow,
  parseDateInput,
  withinDateBounds,
} from "./window";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const WINDOW = { startDate: d("2026-09-01"), endDate: d("2026-11-29") };

describe("expandWindow", () => {
  it("returns null for a date inside the window", () => {
    expect(expandWindow(WINDOW, d("2026-10-15"))).toBeNull();
  });

  it("returns null on the exact start and end boundaries", () => {
    expect(expandWindow(WINDOW, d("2026-09-01"))).toBeNull();
    expect(expandWindow(WINDOW, d("2026-11-29"))).toBeNull();
  });

  it("moves the start back for an earlier date", () => {
    expect(expandWindow(WINDOW, d("2026-08-20"))).toEqual({
      startDate: d("2026-08-20"),
    });
  });

  it("moves the end forward for a later date", () => {
    expect(expandWindow(WINDOW, d("2026-12-05"))).toEqual({
      endDate: d("2026-12-05"),
    });
  });

  it("moves only one bound, never both", () => {
    const before = expandWindow(WINDOW, d("2026-01-01"));
    expect(Object.keys(before ?? {})).toEqual(["startDate"]);
    const after = expandWindow(WINDOW, d("2027-01-01"));
    expect(Object.keys(after ?? {})).toEqual(["endDate"]);
  });

  it("handles a single-day calendar", () => {
    const single = { startDate: d("2026-09-01"), endDate: d("2026-09-01") };
    expect(expandWindow(single, d("2026-09-01"))).toBeNull();
    expect(expandWindow(single, d("2026-09-02"))).toEqual({
      endDate: d("2026-09-02"),
    });
    expect(expandWindow(single, d("2026-08-31"))).toEqual({
      startDate: d("2026-08-31"),
    });
  });

  it("normalizes a window whose bounds carry a time component", () => {
    // Generation writes UTC midnight, but a hand-edited row could carry one.
    const messy = {
      startDate: new Date("2026-09-01T14:30:00Z"),
      endDate: new Date("2026-11-29T23:59:00Z"),
    };
    expect(expandWindow(messy, d("2026-09-01"))).toBeNull();
    expect(expandWindow(messy, d("2026-11-29"))).toBeNull();
  });
});

describe("parseDateInput", () => {
  it("survives a value → Date → value round trip", () => {
    const parsed = parseDateInput("2026-09-12");
    expect(parsed).not.toBeNull();
    expect(dateInputValue(parsed as Date)).toBe("2026-09-12");
  });

  it("parses to UTC midnight regardless of the host timezone", () => {
    expect((parseDateInput("2026-09-12") as Date).toISOString()).toBe(
      "2026-09-12T00:00:00.000Z",
    );
  });

  it("accepts a real leap day", () => {
    expect(parseDateInput("2028-02-29")).toEqual(d("2028-02-29"));
  });

  // new Date() silently rolls these over, which would store an entry on a day
  // the user never picked.
  it.each([
    ["2026-02-31", "February 31st"],
    ["2026-02-29", "February 29th in a non-leap year"],
    ["2026-04-31", "April 31st"],
    ["2026-13-01", "month 13"],
    ["2026-00-10", "month 0"],
    ["2026-09-00", "day 0"],
    ["2026-09-32", "day 32"],
  ])("rejects %s (%s)", (value) => {
    expect(parseDateInput(value)).toBeNull();
  });

  it("rejects a malformed string outright", () => {
    expect(parseDateInput("not-a-date")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });
});

describe("date bounds", () => {
  const NOW = d("2026-08-24");

  it("spans five years either side of the current year", () => {
    expect(dateBounds(NOW)).toEqual({ min: "2021-01-01", max: "2031-12-31" });
  });

  it.each(["2026-09-12", "2021-01-01", "2031-12-31"])("accepts %s", (value) => {
    expect(withinDateBounds(value, NOW)).toBe(true);
  });

  // A year typo is one keystroke on a native date spinner, and the calendar
  // window only ever widens — an absurd year would be unrecoverable from the UI.
  it.each([
    "0202-09-12",
    "9999-12-31",
    "0001-01-01",
    "2020-12-31",
    "2032-01-01",
  ])("rejects %s", (value) => {
    expect(withinDateBounds(value, NOW)).toBe(false);
  });
});

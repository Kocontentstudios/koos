import { describe, expect, it } from "vitest";
import { resolvePickGuidance } from "./pick-guidance";
import type { CalendarItem } from "./types";

const FOCUSED = new Date("2026-08-24T00:00:00.000Z");

function item(id: string, date: string): CalendarItem {
  return {
    id,
    date: new Date(`${date}T00:00:00.000Z`),
    time: null,
    platform: "Instagram",
    contentType: "Post",
    title: `Item ${id}`,
    brief: null,
    caption: null,
    notes: null,
    designRequired: true,
    designType: "Flyer",
    dimensions: null,
    status: "draft",
    source: "ai",
  };
}

const none = new Set<string>();

describe("resolvePickGuidance", () => {
  it("says pick when the agenda lists something clickable", () => {
    expect(
      resolvePickGuidance("agenda", [item("a", "2026-08-28")], FOCUSED, none),
    ).toBe("pick");
  });

  /* Agenda only lists items from the focused date onward, so items that all
     fall earlier leave the user staring at an empty list. */
  it("says none when every agenda item is behind the focused date", () => {
    expect(
      resolvePickGuidance("agenda", [item("a", "2026-08-01")], FOCUSED, none),
    ).toBe("none");
  });

  /* Month renders items inside pointer-events-none containers — telling the
     user to click one there is an instruction they cannot follow. */
  it("tells month users to open a day first", () => {
    expect(
      resolvePickGuidance("month", [item("a", "2026-08-28")], FOCUSED, none),
    ).toBe("openDay");
  });

  it("says pick for a week that contains an item", () => {
    expect(
      resolvePickGuidance("week", [item("a", "2026-08-25")], FOCUSED, none),
    ).toBe("pick");
  });

  /* The window must be the Mon-start one WeekView renders (week-view.tsx uses
     weekDays); a Sunday-aligned window would print "nothing here" above a
     clickable card. */
  it("matches the Mon–Sun window week view actually renders", () => {
    // FOCUSED is Mon 2026-08-24, so the week runs 24th–30th.
    expect(
      resolvePickGuidance("week", [item("a", "2026-08-30")], FOCUSED, none),
    ).toBe("pick");
    expect(
      resolvePickGuidance("week", [item("a", "2026-08-23")], FOCUSED, none),
    ).toBe("none");
  });

  it("says none for a week with nothing in it", () => {
    expect(
      resolvePickGuidance("week", [item("a", "2026-09-20")], FOCUSED, none),
    ).toBe("none");
  });

  it("says pick only for the focused day in day view", () => {
    expect(
      resolvePickGuidance("day", [item("a", "2026-08-24")], FOCUSED, none),
    ).toBe("pick");
    expect(
      resolvePickGuidance("day", [item("a", "2026-08-25")], FOCUSED, none),
    ).toBe("none");
  });

  /* A submitted item shows a disabled "Design Ticket Submitted" button, so it
     is visible but cannot be picked. */
  it("ignores items that already have a ticket", () => {
    const items = [item("a", "2026-08-28")];
    expect(resolvePickGuidance("agenda", items, FOCUSED, new Set(["a"]))).toBe(
      "none",
    );
    expect(resolvePickGuidance("month", items, FOCUSED, new Set(["a"]))).toBe(
      "none",
    );
  });

  it("says none when the calendar is empty", () => {
    expect(resolvePickGuidance("agenda", [], FOCUSED, none)).toBe("none");
  });

  /* Paging the month arrows past the last post leaves an empty grid; telling
     the user to open a day there is the same dead end in a new place. */
  it("says none for a month grid with no posts on it", () => {
    expect(
      resolvePickGuidance(
        "month",
        [item("a", "2026-11-15")],
        new Date("2026-09-15T00:00:00.000Z"),
        none,
      ),
    ).toBe("none");
  });

  /* MonthView renders monthMatrixSunday: 6 Sunday-aligned weeks including
     adjacent-month padding days, whose chips and day cells are both live. A
     Monday-aligned or same-month-only window would print "nothing here" over a
     visible, drillable post. */
  it.each([
    ["leading padding day", "2026-08-30"],
    ["trailing padding day", "2026-10-05"],
  ])("counts posts on the %s of the month grid", (_label, date) => {
    expect(
      resolvePickGuidance(
        "month",
        [item("a", date)],
        new Date("2026-09-15T00:00:00.000Z"),
        none,
      ),
    ).toBe("openDay");
  });

  it("still says openDay when the month grid does hold posts", () => {
    expect(
      resolvePickGuidance(
        "month",
        [item("a", "2026-09-20")],
        new Date("2026-09-15T00:00:00.000Z"),
        none,
      ),
    ).toBe("openDay");
  });
});

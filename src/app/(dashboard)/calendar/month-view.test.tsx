import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MonthView } from "./month-view";
import type { CalendarItem } from "./types";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function item(over: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: "i1",
    date: d("2026-09-12"),
    time: null,
    platform: "Instagram",
    contentType: "Post",
    title: "Launch teaser",
    brief: null,
    caption: null,
    notes: null,
    designRequired: false,
    designType: null,
    dimensions: null,
    status: "draft",
    source: "ai",
    ...over,
  };
}

function setup(items: CalendarItem[] = []) {
  const onSelectDay = vi.fn();
  const onAddDay = vi.fn();
  render(
    <MonthView
      focused={d("2026-09-01")}
      items={items}
      today={d("2026-09-05")}
      onSelectDay={onSelectDay}
      onAddDay={onAddDay}
    />,
  );
  return { onSelectDay, onAddDay };
}

describe("MonthView add affordance", () => {
  it("gives every day both a view target and an add target", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "View Saturday, September 12" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Add post on Saturday, September 12",
      }),
    ).toBeInTheDocument();
  });

  it("passes the clicked day to onAddDay without drilling into Day view", async () => {
    const { onSelectDay, onAddDay } = setup();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Add post on Saturday, September 12",
      }),
    );
    expect(onAddDay).toHaveBeenCalledTimes(1);
    expect(onAddDay.mock.calls[0][0].toISOString()).toBe(
      "2026-09-12T00:00:00.000Z",
    );
    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it("still drills into Day view when the cell itself is clicked", async () => {
    const { onSelectDay, onAddDay } = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "View Saturday, September 12" }),
    );
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay.mock.calls[0][0].toISOString()).toBe(
      "2026-09-12T00:00:00.000Z",
    );
    expect(onAddDay).not.toHaveBeenCalled();
  });

  it("nests no button inside another button", () => {
    setup([item()]);
    for (const btn of screen.getAllByRole("button")) {
      expect(btn.querySelector("button")).toBeNull();
    }
  });
});

/*
 * jsdom loads no CSS, so the only honest gate for a CSS-only behaviour is the
 * class contract itself. The rule being pinned: hiding the "+" at rest must be
 * gated on hover capability, never on a width breakpoint — a tablet is wide
 * but cannot hover, and an opacity-0 button there is an invisible tap target.
 */
describe("MonthView add button visibility contract", () => {
  it("hides at rest only where hover exists, and never behind a width query", () => {
    setup();
    const add = screen.getByRole("button", {
      name: "Add post on Saturday, September 12",
    });
    const cls = add.className;
    expect(cls).toContain("opacity-60");
    expect(cls).toContain("[@media(hover:hover)]:opacity-0");
    expect(cls).toContain("[@media(hover:hover)]:group-hover:opacity-100");
    // A bare `opacity-0` or a `sm:`/`md:` gate would leave it invisible on touch.
    expect(cls).not.toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(cls).not.toMatch(/(^|\s)(sm|md|lg):opacity-0(\s|$)/);
  });

  /* jsdom computes neither z-index nor pointer-events, so the layering that
     makes the cell one drill-in target with a clickable "+" on top is only
     assertable as a class contract. Without this, raising the overlay above
     the "+" (unclickable in a real browser) still passes. */
  it("keeps the + above the full-cell drill overlay", () => {
    setup();
    const view = screen.getByRole("button", {
      name: "View Saturday, September 12",
    });
    const add = screen.getByRole("button", {
      name: "Add post on Saturday, September 12",
    });
    expect(view.className).toMatch(/(^|\s)z-0(\s|$)/);
    expect(add.className).toMatch(/(^|\s)z-10(\s|$)/);
    expect(view.className).toContain("absolute inset-0");
  });

  it("keeps cell content click-through so the whole cell drills in", () => {
    setup([item()]);
    const chip = screen.getByText("Launch teaser").closest("div");
    expect(chip?.className).toContain("pointer-events-none");
    const dayNumber = screen.getByText("12");
    expect(dayNumber.className).toContain("pointer-events-none");
  });

  it("stays keyboard-revealable on devices with no hover", () => {
    setup();
    const add = screen.getByRole("button", {
      name: "Add post on Saturday, September 12",
    });
    expect(add.className).toMatch(/(^|\s)focus-visible:opacity-100(\s|$)/);
  });
});

describe("MonthView source marks", () => {
  it("marks a manual entry and leaves an AI entry unmarked", () => {
    setup([
      item({ id: "a", source: "ai", title: "Launch teaser" }),
      item({ id: "m", source: "manual", title: "Sale announcement" }),
    ]);
    expect(screen.getByText("Sale announcement")).toBeInTheDocument();
    expect(screen.getByText("Launch teaser")).toBeInTheDocument();
    // Exactly one ✎ mark, on the manual entry's chip.
    const marks = screen.getAllByLabelText("Added by you");
    expect(marks).toHaveLength(1);
    expect(marks[0].parentElement).toHaveTextContent("Sale announcement");
  });

  it("renders no mark when every entry is AI-generated", () => {
    setup([item({ source: "ai" })]);
    expect(screen.queryByLabelText("Added by you")).toBeNull();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CalendarItem } from "./types";
import { WeekView } from "./week-view";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function item(over: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: "i1",
    date: d("2026-09-10"),
    time: "9:00 AM",
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
  const onSelect = vi.fn();
  const onAddDay = vi.fn();
  render(
    <WeekView
      focused={d("2026-09-10")}
      items={items}
      today={d("2026-09-10")}
      onSelect={onSelect}
      onAddDay={onAddDay}
    />,
  );
  return { onSelect, onAddDay };
}

describe("WeekView add affordance", () => {
  it("offers an add target on every day of the week", () => {
    setup();
    const adds = screen
      .getAllByRole("button")
      .filter((b) => /^Add post on /.test(b.getAttribute("aria-label") ?? ""));
    expect(adds).toHaveLength(7);
  });

  it("passes the clicked day through", async () => {
    const { onAddDay, onSelect } = setup();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Add post on Thursday, September 10",
      }),
    );
    expect(onAddDay).toHaveBeenCalledTimes(1);
    expect(onAddDay.mock.calls[0][0].toISOString()).toBe(
      "2026-09-10T00:00:00.000Z",
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  /* Same contract as month view: hiding at rest must be gated on hover
     capability, never a width breakpoint, or a tablet gets an invisible tap
     target. week-view.tsx carries a byte-identical class string. */
  it("hides at rest only where hover exists", () => {
    setup();
    const cls = screen.getByRole("button", {
      name: "Add post on Thursday, September 10",
    }).className;
    expect(cls).toContain("opacity-60");
    expect(cls).toContain("[@media(hover:hover)]:opacity-0");
    expect(cls).toContain("[@media(hover:hover)]:group-hover:opacity-100");
    expect(cls).not.toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(cls).not.toMatch(/(^|\s)(sm|md|lg):opacity-0(\s|$)/);
  });

  it("opens an entry rather than the add drawer when a card is clicked", async () => {
    const { onSelect, onAddDay } = setup([item()]);
    await userEvent.click(
      screen.getByRole("button", { name: "Open Launch teaser" }),
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onAddDay).not.toHaveBeenCalled();
  });

  it("marks a manual entry and leaves an AI entry unmarked", () => {
    setup([
      item({ id: "a", source: "ai", title: "Launch teaser" }),
      item({ id: "m", source: "manual", title: "Sale announcement" }),
    ]);
    expect(screen.getAllByText("Added by you")).toHaveLength(1);
  });
});

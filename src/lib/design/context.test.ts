import { beforeEach, describe, expect, it, vi } from "vitest";

const getBrandById = vi.fn();
const getCalendarItemById = vi.fn();
const getDesignBriefById = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  getBrandById: (id: string) => getBrandById(id),
  getCalendarItemById: (id: string) => getCalendarItemById(id),
  getDesignBriefById: (id: string) => getDesignBriefById(id),
}));

import { resolveDesignContext } from "./context";

const BRAND = { id: "b1", name: "Acme" };

function calendarItem(over: Record<string, unknown> = {}) {
  return {
    id: "i1",
    title: "Friday sale announcement",
    brief: null,
    caption: null,
    designType: null,
    contentType: "Post",
    dimensions: null,
    platform: "Instagram",
    date: new Date("2026-09-12T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  getBrandById.mockResolvedValue(BRAND);
});

describe("resolveDesignContext from a calendar item", () => {
  it("prefers the AI brief when there is one", async () => {
    getCalendarItemById.mockResolvedValue(
      calendarItem({ brief: "Tease the drop.", caption: "50% off today" }),
    );
    const ctx = await resolveDesignContext({
      brandId: "b1",
      calendarItemId: "i1",
    });
    expect(ctx.briefText).toBe("Tease the drop.");
  });

  /* A manually added entry has no brief by construction — the add form hides
     the field. Falling straight through to the title briefed the model on a
     headline and silently dropped the copy the user actually wrote. */
  it("falls back to the caption for a manual entry with no brief", async () => {
    getCalendarItemById.mockResolvedValue(
      calendarItem({ brief: null, caption: "50% off everything, today only." }),
    );
    const ctx = await resolveDesignContext({
      brandId: "b1",
      calendarItemId: "i1",
    });
    expect(ctx.briefText).toBe("50% off everything, today only.");
  });

  it("falls back to the title only when there is no brief and no caption", async () => {
    getCalendarItemById.mockResolvedValue(calendarItem());
    const ctx = await resolveDesignContext({
      brandId: "b1",
      calendarItemId: "i1",
    });
    expect(ctx.briefText).toBe("Friday sale announcement");
  });

  it("rejects an unknown calendar item", async () => {
    getCalendarItemById.mockResolvedValue(null);
    await expect(
      resolveDesignContext({ brandId: "b1", calendarItemId: "nope" }),
    ).rejects.toThrow("Calendar item not found.");
  });
});

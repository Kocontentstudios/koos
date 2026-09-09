import { beforeEach, describe, expect, it, vi } from "vitest";

const getBrandById = vi.fn();
const getCalendarItemForBrand = vi.fn();
const getDesignBriefById = vi.fn();
const getDesignTicketById = vi.fn();
const getStrategyById = vi.fn();
const getBrandAssets = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  // Brands in these tests have no synthesized voice guide.
  getBrandVoiceGuide: async () => null,
  getBrandById: (id: string) => getBrandById(id),
  getCalendarItemForBrand: (id: string, brandId: string) =>
    getCalendarItemForBrand(id, brandId),
  getDesignBriefById: (id: string) => getDesignBriefById(id),
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  getStrategyById: (id: string) => getStrategyById(id),
  getBrandAssets: (brandId: string) => getBrandAssets(brandId),
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
    getCalendarItemForBrand.mockResolvedValue(
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
    getCalendarItemForBrand.mockResolvedValue(
      calendarItem({ brief: null, caption: "50% off everything, today only." }),
    );
    const ctx = await resolveDesignContext({
      brandId: "b1",
      calendarItemId: "i1",
    });
    expect(ctx.briefText).toBe("50% off everything, today only.");
  });

  it("falls back to the title only when there is no brief and no caption", async () => {
    getCalendarItemForBrand.mockResolvedValue(calendarItem());
    const ctx = await resolveDesignContext({
      brandId: "b1",
      calendarItemId: "i1",
    });
    expect(ctx.briefText).toBe("Friday sale announcement");
  });

  it("rejects an unknown calendar item", async () => {
    getCalendarItemForBrand.mockResolvedValue(null);
    await expect(
      resolveDesignContext({ brandId: "b1", calendarItemId: "nope" }),
    ).rejects.toThrow("Calendar item not found.");
  });
});

/* The ids arrive from the client. Every type must be re-proved against the
   requested brand, or a user could attach another brand's content and read it
   back out of the generated design. Calendar items were the live hole: they
   reach their brand only through calendars, and nothing checked it. */
describe("resolveDesignContext attachment ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBrandById.mockResolvedValue(BRAND);
  });

  it("scopes a calendar item to the brand in the query itself", async () => {
    getCalendarItemForBrand.mockResolvedValue(calendarItem());
    await resolveDesignContext({
      brandId: "b1",
      attachments: [{ type: "calendar_item", id: "i1" }],
    });
    expect(getCalendarItemForBrand).toHaveBeenCalledWith("i1", "b1");
  });

  it("rejects a calendar item that is not this brand's", async () => {
    getCalendarItemForBrand.mockResolvedValue(null);
    await expect(
      resolveDesignContext({
        brandId: "b1",
        attachments: [{ type: "calendar_item", id: "other" }],
      }),
    ).rejects.toThrow("Calendar item not found.");
  });

  it("rejects another brand's design brief", async () => {
    getDesignBriefById.mockResolvedValue({ id: "x", brandId: "b2" });
    await expect(
      resolveDesignContext({
        brandId: "b1",
        attachments: [{ type: "brief", id: "x" }],
      }),
    ).rejects.toThrow("Design brief not found.");
  });

  it("rejects another brand's design request", async () => {
    getDesignTicketById.mockResolvedValue({ id: "x", brandId: "b2" });
    await expect(
      resolveDesignContext({
        brandId: "b1",
        attachments: [{ type: "ticket", id: "x" }],
      }),
    ).rejects.toThrow("Design request not found.");
  });

  it("rejects another brand's strategy", async () => {
    getStrategyById.mockResolvedValue({ id: "x", brandId: "b2" });
    await expect(
      resolveDesignContext({
        brandId: "b1",
        attachments: [{ type: "strategy", id: "x" }],
      }),
    ).rejects.toThrow("Campaign strategy not found.");
  });

  /* Assets are listed by brand, so an id outside that list cannot resolve. */
  it("rejects an asset that is not in this brand's library", async () => {
    getBrandAssets.mockResolvedValue([{ id: "a1", fileName: "logo.png" }]);
    await expect(
      resolveDesignContext({
        brandId: "b1",
        attachments: [{ type: "asset", id: "a2" }],
      }),
    ).rejects.toThrow("Brand asset not found.");
  });
});

describe("resolveDesignContext with several attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBrandById.mockResolvedValue(BRAND);
    getDesignBriefById.mockResolvedValue({
      id: "br1",
      brandId: "b1",
      title: "Launch brief",
      briefMarkdown: "Bold and bright.",
      designType: "Flyer",
      dimensions: "1080x1350",
    });
    getCalendarItemForBrand.mockResolvedValue(
      calendarItem({ brief: "Tease the drop." }),
    );
    getBrandAssets.mockResolvedValue([
      { id: "a1", fileName: "logo.png", fileUrl: "https://cdn/logo.png" },
    ]);
  });

  it("merges every attachment into one context", async () => {
    const ctx = await resolveDesignContext({
      brandId: "b1",
      freeform: "Make it an Instagram post.",
      attachments: [
        { type: "calendar_item", id: "i1" },
        { type: "brief", id: "br1" },
        { type: "asset", id: "a1" },
      ],
    });

    expect(ctx.briefText).toContain("Make it an Instagram post.");
    expect(ctx.briefText).toContain("Bold and bright.");
    expect(ctx.briefText).toContain("Tease the drop.");
    // Brief outranks the calendar item for a field both supply.
    expect(ctx.designType).toBe("Flyer");
    // The calendar item is still the only source of the platform.
    expect(ctx.platform).toBe("Instagram");
    expect(ctx.referenceUrls).toEqual(["https://cdn/logo.png"]);
  });

  it("records what it was built from", async () => {
    const ctx = await resolveDesignContext({
      brandId: "b1",
      attachments: [
        { type: "brief", id: "br1" },
        { type: "calendar_item", id: "i1" },
      ],
    });
    expect(ctx.attachments).toEqual([
      { type: "brief", id: "br1", label: "Launch brief" },
      { type: "calendar_item", id: "i1", label: "Friday sale announcement" },
    ]);
  });

  /* The calendar and chat entry points still send bare ids. Sending both forms
     of the same thing must not brief the model on it twice. */
  it("dedupes a bare id against the same attachment", async () => {
    const ctx = await resolveDesignContext({
      brandId: "b1",
      briefId: "br1",
      attachments: [{ type: "brief", id: "br1" }],
    });
    expect(ctx.attachments).toHaveLength(1);
    expect(getDesignBriefById).toHaveBeenCalledTimes(1);
  });

  it("still honours a bare briefId on its own", async () => {
    const ctx = await resolveDesignContext({ brandId: "b1", briefId: "br1" });
    expect(ctx.source).toBe("chat_brief");
    expect(ctx.briefId).toBe("br1");
    expect(ctx.briefText).toBe("Bold and bright.");
  });
});

import { describe, expect, it } from "vitest";
import type { Strategy } from "@/lib/ai/strategy-schema";
import {
  campaignChannelLine,
  campaignRecap,
  campaignSummary,
  campaignTimelineLine,
  isCampaignSaved,
  nextChatTitle,
  toCampaignCard,
} from "./campaign-card";

const strategy: Strategy = {
  campaignName: "Ramadan Gift Bundles",
  objective: "Sell 500 gift bundles before Eid",
  targetAudience: "Lagos professionals buying family gifts",
  keyMessage: "Give a bundle, not a guess",
  channels: [
    { name: "Instagram", rationale: "highest reach" },
    { name: "WhatsApp", rationale: "closes sales" },
  ],
  contentMix: [{ type: "Reel", count: 4 }],
  timeline: [
    { phase: "Tease", dateRange: "Week 1", focus: "build anticipation" },
    { phase: "Launch", dateRange: "Week 2", focus: "drive orders" },
    { phase: "Last call", dateRange: "Week 3", focus: "urgency" },
  ],
  themes: [{ title: "Generosity", description: "gifting as care" }],
  postingSchedule: [{ channel: "Instagram", cadence: "4x weekly" }],
};

const row = {
  id: "s1",
  name: "Ramadan Gift Bundles",
  structured: strategy,
  status: "draft",
  updatedAt: new Date("2026-08-25T10:00:00.000Z"),
};

describe("toCampaignCard", () => {
  it("derives the card from a stored row", () => {
    expect(toCampaignCard(row)).toEqual({
      id: "s1",
      campaignName: "Ramadan Gift Bundles",
      objective: "Sell 500 gift bundles before Eid",
      channels: ["Instagram", "WhatsApp"],
      phaseCount: 3,
      timelineSpan: "Tease → Last call",
      status: "draft",
    });
  });

  it("returns null when the stored shape no longer parses", () => {
    expect(
      toCampaignCard({ ...row, structured: { campaignName: "x" } }),
    ).toBeNull();
    expect(toCampaignCard({ ...row, structured: null })).toBeNull();
  });

  it("prefers the row name so a renamed campaign stays consistent", () => {
    const card = toCampaignCard({ ...row, name: "Eid Bundles v2" });
    expect(card?.campaignName).toBe("Eid Bundles v2");
  });

  it("falls back to the structured name when the row name is empty", () => {
    const card = toCampaignCard({ ...row, name: "" });
    expect(card?.campaignName).toBe("Ramadan Gift Bundles");
  });

  it("spans a single-phase timeline without an arrow", () => {
    const card = toCampaignCard({
      ...row,
      structured: {
        ...strategy,
        timeline: [{ phase: "Launch", dateRange: "Week 1", focus: "go" }],
      },
    });
    expect(card?.timelineSpan).toBe("Launch");
  });
});

describe("campaignSummary", () => {
  it("names the channels and spans the timeline", () => {
    expect(campaignSummary(strategy)).toEqual({
      campaignName: "Ramadan Gift Bundles",
      objective: "Sell 500 gift bundles before Eid",
      channels: ["Instagram", "WhatsApp"],
      phaseCount: 3,
      timelineSpan: "Tease → Last call",
    });
  });
});

describe("campaignChannelLine", () => {
  const card = toCampaignCard(row);
  if (!card) throw new Error("card expected");

  /* "Instagram, WhatsApp" tells the user something "2 channels" does not. */
  it("names the channels rather than counting them", () => {
    expect(campaignChannelLine(card)).toBe("Instagram, WhatsApp");
  });

  it("caps the list and counts the overflow", () => {
    expect(
      campaignChannelLine({
        ...card,
        channels: ["Instagram", "WhatsApp", "TikTok", "X", "LinkedIn"],
      }),
    ).toBe("Instagram, WhatsApp, TikTok +2");
  });

  it("is empty rather than a stray separator when there are none", () => {
    expect(campaignChannelLine({ ...card, channels: [] })).toBe("");
  });
});

describe("campaignTimelineLine", () => {
  const card = toCampaignCard(row);
  if (!card) throw new Error("card expected");

  /* Regression: the span shared a clamped line with the channels, so the one
     fact here the sidebar does not already show was always truncated away. */
  it("keeps the phase span on its own line", () => {
    expect(campaignTimelineLine(card)).toBe("3 phases: Tease → Last call");
  });

  it("uses singular for one phase", () => {
    expect(campaignTimelineLine({ ...card, phaseCount: 1 })).toBe(
      "1 phase: Tease → Last call",
    );
  });

  it("drops the colon when there is no span", () => {
    expect(campaignTimelineLine({ ...card, timelineSpan: "" })).toBe(
      "3 phases",
    );
  });

  it("is empty when there are no phases", () => {
    expect(campaignTimelineLine({ ...card, phaseCount: 0 })).toBe("");
  });
});

describe("isCampaignSaved", () => {
  it("is true only for active", () => {
    expect(isCampaignSaved({ status: "active" })).toBe(true);
    expect(isCampaignSaved({ status: "draft" })).toBe(false);
    expect(isCampaignSaved({ status: "archived" })).toBe(false);
  });
});

describe("campaignRecap", () => {
  const recap = campaignRecap(strategy);

  it("names the campaign and its anchors so refinement has context", () => {
    expect(recap).toContain("Ramadan Gift Bundles");
    expect(recap).toContain("Sell 500 gift bundles before Eid");
    expect(recap).toContain("Instagram, WhatsApp");
    expect(recap).toContain("Give a bundle, not a guess");
  });

  /* Regression: joining fields with a single newline rendered them as one
     run-on paragraph, because the chat renders assistant text as markdown and
     markdown collapses a lone newline into a space. Review is the "scan and
     refine" path, so the artifact has to be scannable. */
  it("emits markdown list items, not a run-on paragraph", () => {
    for (const field of ["Objective", "Audience", "Key message", "Channels"]) {
      expect(recap).toContain(`- **${field}:**`);
    }
    expect(recap.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(4);
  });

  it("separates the list from the surrounding prose with blank lines", () => {
    const lines = recap.split("\n");
    expect(lines[1]).toBe("");
    expect(lines[lines.length - 2]).toBe("");
  });
});

describe("nextChatTitle", () => {
  it("names an untitled chat after the campaign", () => {
    expect(nextChatTitle(undefined, "Ramadan Gift Bundles")).toBe(
      "Ramadan Gift Bundles",
    );
    expect(
      nextChatTitle(
        { title: "what should i post", titleCustom: false },
        "Ramadan Gift Bundles",
      ),
    ).toBe("Ramadan Gift Bundles");
  });

  /* Mirrors the server's `title_custom = false` predicate. Showing the campaign
     name here while the database keeps the user's would desync the sidebar. */
  it("never overwrites a title the user typed", () => {
    expect(
      nextChatTitle(
        { title: "My Eid push", titleCustom: true },
        "Ramadan Gift Bundles",
      ),
    ).toBe("My Eid push");
  });

  it("keeps a user-owned but empty title empty rather than inventing one", () => {
    expect(
      nextChatTitle({ title: null, titleCustom: true }, "Ramadan"),
    ).toBeNull();
  });
});

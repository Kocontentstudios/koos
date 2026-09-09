import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CampaignCard } from "@/lib/strategy/campaign-card";
import { ChatFooterCards } from "./chat-footer-cards";
import type { PersistedDesignBrief } from "./design-brief-card";

const campaign: CampaignCard = {
  id: "s1",
  campaignName: "Ramadan Gift Bundles",
  objective: "Sell 500 bundles",
  channels: ["Instagram", "WhatsApp"],
  phaseCount: 3,
  timelineSpan: "Tease → Launch",
  status: "draft",
};

const brief: PersistedDesignBrief = {
  id: "b1",
  title: "Launch flyer",
  designType: "Flyer",
  dimensions: "1080x1350",
  slides: null,
  briefMarkdown: "**Launch flyer**",
  notes: null,
  ticketId: null,
  createdAt: "2026-08-25T10:00:00.000Z",
};

const handlers = {
  onOpenBrief: vi.fn(),
  onOpenCampaign: vi.fn(),
  onReviewCampaign: vi.fn(),
  onSaveCampaign: vi.fn(),
  onGenerateCalendar: vi.fn(),
  opening: false,
  saving: false,
  reviewing: false,
  generatingCalendar: false,
  cardError: null,
};

describe("ChatFooterCards", () => {
  it("pins the campaign in a strategy chat", () => {
    render(
      <ChatFooterCards
        isDesignMode={false}
        briefs={[]}
        campaign={campaign}
        {...handlers}
      />,
    );
    expect(
      screen.getByRole("article", { name: "Ramadan Gift Bundles" }),
    ).toBeInTheDocument();
  });

  /* The two modes must not blur: a design chat is not a campaign chat, so a
     campaign card must never appear in one even if state carries one. */
  it("shows briefs and never a campaign card in a design chat", () => {
    render(
      <ChatFooterCards
        isDesignMode
        briefs={[brief]}
        campaign={campaign}
        {...handlers}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Open design brief/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("shows a campaign card and never briefs in a strategy chat", () => {
    render(
      <ChatFooterCards
        isDesignMode={false}
        briefs={[brief]}
        campaign={campaign}
        {...handlers}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Open design brief/ }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the chat has no cards yet", () => {
    const { container } = render(
      <ChatFooterCards
        isDesignMode={false}
        briefs={[]}
        campaign={null}
        {...handlers}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing in a design chat with no briefs", () => {
    const { container } = render(
      <ChatFooterCards
        isDesignMode
        briefs={[]}
        campaign={campaign}
        {...handlers}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

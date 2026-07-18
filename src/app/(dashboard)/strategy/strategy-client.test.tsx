import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { loadStrategy } from "./actions";
import { StrategyClient } from "./strategy-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./actions", () => ({
  loadStrategy: vi.fn(),
  markStrategyActive: vi.fn(),
}));

const brandContext = {
  brandProfile: "Acme",
  audience: "",
  brandVoice: "",
  existingCampaigns: "",
  previousConversations: "",
};

const savedStrategy = {
  campaignName: "Q3 Launch",
  objective: "Grow awareness",
  targetAudience: "Founders",
  keyMessage: "Ship faster",
  channels: [{ name: "Instagram", rationale: "Reach" }],
  contentMix: [{ type: "carousel", count: 3 }],
  timeline: [{ phase: "Tease", dateRange: "Week 1", focus: "Hype" }],
  themes: [{ title: "Momentum", description: "Progress updates" }],
  postingSchedule: [{ channel: "Instagram", cadence: "3x/week" }],
};

describe("StrategyClient restore", () => {
  it("renders restored messages passed from the server", () => {
    const initialMessages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Remembered question" }],
      },
    ] as UIMessage[];
    render(
      <StrategyClient
        brandId="b1"
        brandName="Acme"
        brandContext={brandContext}
        initialMessages={initialMessages}
        initialConversationId="c1"
      />,
    );
    expect(screen.getByText("Remembered question")).toBeInTheDocument();
  });
});

describe("StrategyClient sidebar", () => {
  const conversations = [
    {
      id: "c1",
      title: "Launch chat",
      updatedAt: new Date(),
      mode: "strategy" as const,
      strategyId: "s1",
    },
  ];

  it("lists chats with a Strategy badge and an Older Strategies group", () => {
    render(
      <StrategyClient
        brandId="b1"
        brandName="Acme"
        brandContext={brandContext}
        conversations={conversations}
        olderStrategies={[
          {
            id: "s9",
            name: "Old campaign",
            updatedAt: new Date(),
            status: "draft",
          },
        ]}
      />,
    );
    // Desktop panel + mobile drawer both render the sidebar.
    expect(screen.getAllByText("Launch chat").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Strategy").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Older Strategies").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Old campaign").length).toBeGreaterThan(0);
  });

  it("collapses the history panel to a rail and expands it back", async () => {
    const user = userEvent.setup();
    render(
      <StrategyClient
        brandId="b1"
        brandName="Acme"
        brandContext={brandContext}
        conversations={conversations}
        olderStrategies={[]}
      />,
    );
    await user.click(screen.getByLabelText("Collapse history panel"));
    expect(screen.getByLabelText("Expand history panel")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Expand history panel"));
    expect(screen.getByLabelText("Collapse history panel")).toBeInTheDocument();
  });

  it("View Strategy opens the panel without clobbering the chat", async () => {
    vi.mocked(loadStrategy).mockResolvedValue({
      ok: true,
      strategy: savedStrategy,
      name: "Q3 Launch",
      status: "draft",
    });
    const user = userEvent.setup();
    const initialMessages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Original chat message" }],
      },
    ] as UIMessage[];
    render(
      <StrategyClient
        brandId="b1"
        brandName="Acme"
        brandContext={brandContext}
        conversations={conversations}
        olderStrategies={[]}
        initialMessages={initialMessages}
        initialConversationId="c1"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "View this chat's strategy" }),
    );
    expect(loadStrategy).toHaveBeenCalledWith("s1");
    expect(await screen.findAllByText("Q3 Launch")).not.toHaveLength(0);
    // The conversation itself is untouched.
    expect(screen.getByText("Original chat message")).toBeInTheDocument();
  });
});

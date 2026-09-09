import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignCard } from "@/lib/strategy/campaign-card";
import { addStrategyRecap, loadStrategy, saveStrategy } from "./actions";
import { StrategyClient } from "./strategy-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./actions", () => ({
  loadStrategy: vi.fn(),
  saveStrategy: vi.fn(),
  addStrategyRecap: vi.fn(),
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

const campaign: CampaignCard = {
  id: "s1",
  campaignName: "Q3 Launch",
  objective: "Grow awareness",
  channels: ["Instagram"],
  phaseCount: 1,
  timelineSpan: "Tease",
  status: "draft",
};

const conversations = [
  {
    id: "c1",
    title: "Launch chat",
    updatedAt: new Date("2026-08-20T10:00:00.000Z"),
    mode: "strategy" as const,
    strategyId: "s1",
  },
  {
    id: "c2",
    title: "Ramadan bundles",
    updatedAt: new Date("2026-08-21T10:00:00.000Z"),
    mode: "strategy" as const,
    strategyId: "s2",
  },
];

const chatMessage = (text: string): UIMessage[] =>
  [
    { id: "u1", role: "user", parts: [{ type: "text", text }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "Got it." }] },
  ] as UIMessage[];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StrategyClient restore", () => {
  it("renders restored messages passed from the server", () => {
    render(
      <StrategyClient
        brandId="b1"
        brandName="Acme"
        brandContext={brandContext}
        initialMessages={chatMessage("Remembered question")}
        initialConversationId="c1"
      />,
    );
    expect(screen.getByText("Remembered question")).toBeInTheDocument();
  });
});

describe("StrategyClient sidebar", () => {
  it("lists chats with a Campaign badge and an Older Strategies group", () => {
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
    expect(screen.getAllByText("Campaign").length).toBeGreaterThan(0);
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

  it("renames a chat and keeps the new title", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "c1", title: "Eid Bundles" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <StrategyClient
        brandId="b1"
        brandName="Acme"
        brandContext={brandContext}
        conversations={[conversations[0]]}
        olderStrategies={[]}
      />,
    );
    await user.click(screen.getAllByLabelText("Rename chat: Launch chat")[0]);
    const input = screen.getAllByLabelText("Rename chat: Launch chat")[0];
    await user.clear(input);
    await user.type(input, "Eid Bundles{Enter}");

    await waitFor(() =>
      expect(screen.getAllByText("Eid Bundles").length).toBeGreaterThan(0),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/conversations/c1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});

describe("StrategyClient campaign card", () => {
  const renderWithCampaign = (overrides: Partial<CampaignCard> = {}) =>
    render(
      <StrategyClient
        brandId="b1"
        brandName="Acme"
        brandContext={brandContext}
        conversations={conversations}
        olderStrategies={[]}
        initialMessages={chatMessage("Original chat message")}
        initialConversationId="c1"
        initialCampaign={{ ...campaign, ...overrides }}
      />,
    );

  it("pins the chat's campaign under the messages", () => {
    renderWithCampaign();
    expect(
      screen.getByRole("article", { name: "Q3 Launch" }),
    ).toBeInTheDocument();
  });

  it("Open shows the strategy without clobbering the chat", async () => {
    vi.mocked(loadStrategy).mockResolvedValue({
      ok: true,
      strategy: savedStrategy,
      name: "Q3 Launch",
      status: "draft",
    });
    const user = userEvent.setup();
    renderWithCampaign();

    await user.click(screen.getByRole("button", { name: /^Open strategy/ }));
    expect(loadStrategy).toHaveBeenCalledWith("s1");
    expect(await screen.findAllByText("Grow awareness")).not.toHaveLength(0);
    expect(screen.getByText("Original chat message")).toBeInTheDocument();
  });

  /* Review must APPEND. Replacing the transcript was the old behavior and it
     lost every turn that produced the campaign. */
  it("Review appends the recap and keeps the transcript", async () => {
    vi.mocked(addStrategyRecap).mockResolvedValue({
      ok: true,
      id: "m9",
      text: 'Here\'s your campaign strategy, "Q3 Launch".',
    });
    const user = userEvent.setup();
    renderWithCampaign();

    await user.click(screen.getByRole("button", { name: /^Review strategy/ }));
    expect(
      await screen.findByText(/Here's your campaign strategy/),
    ).toBeInTheDocument();
    expect(screen.getByText("Original chat message")).toBeInTheDocument();
  });

  /* Regression: Open was disabled whenever the client still HELD the strategy,
     which is not the same as the panel SHOWING it. Review closes the mobile
     drawer, so the very next tap on Open hit a dead control whose label
     claimed the panel was already open. */
  it("keeps Open live after Review closes the summary drawer", async () => {
    vi.mocked(addStrategyRecap).mockResolvedValue({
      ok: true,
      id: "m9",
      text: "recap",
    });
    vi.mocked(loadStrategy).mockResolvedValue({
      ok: true,
      strategy: savedStrategy,
      name: "Q3 Launch",
      status: "draft",
    });
    const user = userEvent.setup();
    renderWithCampaign();

    await user.click(screen.getByRole("button", { name: /^Open strategy/ }));
    await screen.findAllByText("Grow awareness");
    await user.click(screen.getByRole("button", { name: /^Review strategy/ }));
    await screen.findByText("recap");

    const open = screen.getByRole("button", { name: /^Open strategy/ });
    expect(open).toBeEnabled();
    await user.click(open);
    expect(await screen.findAllByText("Grow awareness")).not.toHaveLength(0);
  });

  it("Save commits the campaign and swaps in the calendar action", async () => {
    vi.mocked(saveStrategy).mockResolvedValue({
      ok: true,
      card: { ...campaign, status: "active" },
    });
    const user = userEvent.setup();
    renderWithCampaign();

    await user.click(screen.getByRole("button", { name: /^Save strategy/ }));
    expect(saveStrategy).toHaveBeenCalledWith("s1");
    expect(
      await screen.findByRole("button", {
        name: /Generate Calendar for/,
      }),
    ).toBeInTheDocument();
  });

  /* Regression: a failed calendar generation wrote only calendarError, which
     the panel renders solely alongside a loaded strategy — and the card offers
     Generate Calendar without one. Before a jobId exists the GenerationWatcher
     owns nothing either, so the user's most expensive click failed in total
     silence. */
  it("surfaces a failed calendar generation on the card", async () => {
    vi.mocked(saveStrategy).mockResolvedValue({
      ok: true,
      card: { ...campaign, status: "active" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Calendar generation failed" }),
      }),
    );
    const user = userEvent.setup();
    renderWithCampaign({ status: "active" });

    await user.click(
      screen.getByRole("button", { name: /Generate Calendar for/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Calendar generation failed",
    );
  });

  it("surfaces a save that fails inside the calendar path", async () => {
    vi.mocked(saveStrategy).mockResolvedValue({
      ok: false,
      error: "Could not save strategy.",
    });
    const user = userEvent.setup();
    renderWithCampaign({ status: "active" });

    await user.click(
      screen.getByRole("button", { name: /Generate Calendar for/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save strategy.",
    );
  });

  it("surfaces a failed save on the card", async () => {
    vi.mocked(saveStrategy).mockResolvedValue({
      ok: false,
      error: "Could not save strategy.",
    });
    const user = userEvent.setup();
    renderWithCampaign();

    await user.click(screen.getByRole("button", { name: /^Save strategy/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save strategy.",
    );
  });

  /* The whole point of one-campaign-per-chat: a new chat must not inherit the
     previous campaign's card. */
  it("New chat clears the campaign and the transcript", async () => {
    const user = userEvent.setup();
    renderWithCampaign();

    await user.click(screen.getAllByRole("button", { name: "New Chat" })[0]);
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("Original chat message")).not.toBeInTheDocument();
  });

  it("reopening a chat restores its campaign card", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [],
        briefs: [],
        strategy: {
          ...campaign,
          id: "s2",
          campaignName: "Ramadan Gift Bundles",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithCampaign();

    await user.click(screen.getAllByText("Ramadan bundles")[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      await screen.findByRole("article", { name: "Ramadan Gift Bundles" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/conversations/c2");
  });

  it("reopening a chat with no campaign shows no card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], briefs: [], strategy: null }),
      }),
    );
    const user = userEvent.setup();
    renderWithCampaign();

    await user.click(screen.getAllByText("Ramadan bundles")[0]);
    await waitFor(() =>
      expect(screen.queryByRole("article")).not.toBeInTheDocument(),
    );
  });

  it("offers a rebuild rather than hiding the build button once a campaign exists", () => {
    renderWithCampaign();
    expect(
      screen.getByRole("button", {
        name: "Rebuild strategy from conversation",
      }),
    ).toBeInTheDocument();
  });
});

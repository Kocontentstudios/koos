import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
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

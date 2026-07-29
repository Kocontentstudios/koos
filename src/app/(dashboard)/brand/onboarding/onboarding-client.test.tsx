import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-voice-io", () => ({
  useVoiceIo: () => ({
    supported: false,
    listening: false,
    transcript: "",
    start: vi.fn(),
    stop: vi.fn(),
    speak: vi.fn(),
  }),
}));

import { OnboardingClient } from "./onboarding-client";

const brandContext = {
  brandProfile: "Acme",
  audience: "",
  brandVoice: "",
  existingCampaigns: "",
  previousConversations: "",
};

describe("OnboardingClient", () => {
  it("hides the mic when voice is unsupported", () => {
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);
    expect(screen.queryByRole("button", { name: /mic|voice/i })).toBeNull();
  });

  it("shows the Fill my brand profile button", () => {
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);
    expect(
      screen.getByRole("button", { name: /fill my brand profile/i }),
    ).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const speak = vi.fn();
const startVoice = vi.fn();
const voice = {
  supported: false,
  listening: false,
  transcript: "",
  start: startVoice,
  stop: vi.fn(),
  speak,
};
const chatState: { messages: unknown[]; status: string } = {
  messages: [],
  status: "ready",
};

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));
vi.mock("@/hooks/use-voice-io", () => ({ useVoiceIo: () => voice }));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatState.messages,
    status: chatState.status,
    sendMessage: vi.fn(),
    stop: vi.fn(),
    error: undefined,
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
  beforeEach(() => {
    vi.clearAllMocks();
    voice.supported = false;
    voice.listening = false;
    chatState.messages = [];
    chatState.status = "ready";
  });

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

  it("shows the mic when the browser supports voice", () => {
    voice.supported = true;
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);
    expect(
      screen.getByRole("button", { name: /start voice input/i }),
    ).toBeInTheDocument();
  });

  /* The "call" half of the feature: once the user has engaged voice mode, KO
     reads its replies aloud so the exchange is a conversation, not just
     dictation into a text box. */
  it("speaks a finished reply aloud after voice mode is engaged", async () => {
    voice.supported = true;
    const { rerender } = render(
      <OnboardingClient brandId="b1" brandContext={brandContext} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start voice input/i }));

    chatState.messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello there" }],
      },
    ];
    rerender(<OnboardingClient brandId="b1" brandContext={brandContext} />);

    expect(speak).toHaveBeenCalledWith("Hello there");
  });

  it("stays silent when the user never engaged voice mode", () => {
    voice.supported = true;
    const { rerender } = render(
      <OnboardingClient brandId="b1" brandContext={brandContext} />,
    );
    chatState.messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello there" }],
      },
    ];
    rerender(<OnboardingClient brandId="b1" brandContext={brandContext} />);
    expect(speak).not.toHaveBeenCalled();
  });

  it("does not speak a reply that is still streaming", () => {
    voice.supported = true;
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);
    fireEvent.click(screen.getByRole("button", { name: /start voice input/i }));
    chatState.status = "streaming";
    chatState.messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Partial" }],
      },
    ];
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);
    expect(speak).not.toHaveBeenCalled();
  });
});

/* The ticket's flow hangs off this hop: onboarding finishes, the user reviews
   the profile at /brand, and only then reaches the dashboard where the tour
   fires. Without the redirect the user is left sitting in the chat. */
describe("OnboardingClient handoff to the brand profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatState.messages = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "We sell bags" }],
      },
    ];
    chatState.status = "ready";
  });

  function stubFetch(brandCompleted: boolean) {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes("/extract")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            proposal: {
              kind: "brand_fields",
              summary: "Captured brand",
              data: { fields: { overview: "Handwoven bags" } },
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, brandCompleted }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  async function captureThenConfirm(brandCompleted: boolean) {
    stubFetch(brandCompleted);
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);
    fireEvent.click(
      screen.getByRole("button", { name: /fill my brand profile/i }),
    );
    const confirm = await screen.findByRole("button", { name: /confirm/i });
    fireEvent.click(confirm);
  }

  it("sends the user to the brand profile once the brand is complete", async () => {
    await captureThenConfirm(true);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/brand"));
    // Without the refresh the profile page can render the pre-write brand.
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("stays in the chat when the capture left the brand incomplete", async () => {
    // /brand redirects an incomplete brand straight back into onboarding, so
    // pushing here would bounce the user in a loop.
    await captureThenConfirm(false);
    // The confirm resolved (the card is gone) but no navigation followed.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull(),
    );
    expect(push).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

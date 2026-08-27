import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const speak = vi.fn();
const cancel = vi.fn();
const startVoice = vi.fn();
const voice = {
  supported: false,
  listening: false,
  transcript: "",
  start: startVoice,
  stop: vi.fn(),
  speak,
  cancel,
  speakingId: null as string | null,
  speaking: false,
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
    voice.speakingId = null;
    voice.speaking = false;
    chatState.messages = [];
    chatState.status = "ready";
  });

  it("shows the Fill my brand profile button", () => {
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);
    expect(
      screen.getByRole("button", { name: /fill my brand profile/i }),
    ).toBeInTheDocument();
  });

  /* KOS-V1-BUG-003: the mic rendered but could never work — the app sends
     Permissions-Policy: microphone=(), which gates the Web Speech API, and the
     failure was swallowed silently. It stays hidden until a real speech-to-text
     service is wired up, including where the browser claims support. */
  it("renders no mic control, even where the browser supports voice", () => {
    voice.supported = true;
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);
    expect(screen.queryByRole("button", { name: /voice input/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mic/i })).toBeNull();
    expect(startVoice).not.toHaveBeenCalled();
  });

  /* KOS-V1-BUG-004: replies used to be spoken automatically once the mic had
     been tapped even once, because voiceModeRef was latched on and never
     cleared. Nothing may speak without a deliberate click. */
  it("never speaks a finished reply on its own", () => {
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

  it("stays silent when the browser reports voice support", () => {
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

  it("offers a read-aloud control on an assistant reply, not on the user's own", () => {
    chatState.messages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "We sell bags" }],
      },
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello there" }],
      },
    ];
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);

    expect(screen.getAllByRole("button", { name: /read aloud/i })).toHaveLength(
      1,
    );
  });

  it("speaks that message, tagged with its id, when read aloud is clicked", () => {
    chatState.messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello there" }],
      },
    ];
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);
    fireEvent.click(screen.getByRole("button", { name: /read aloud/i }));

    expect(speak).toHaveBeenCalledWith("Hello there", "m1");
  });

  it("turns into a Stop control that cancels the message being spoken", () => {
    chatState.messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello there" }],
      },
    ];
    voice.speakingId = "m1";
    voice.speaking = true;
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);

    const stopButton = screen.getByRole("button", {
      name: /stop reading aloud/i,
    });
    expect(stopButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(stopButton);

    expect(cancel).toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  /* Only the speaking message shows Stop. Keying this to one shared boolean
     would make every reply claim to be the one talking. */
  it("keeps the other replies on Read aloud while one is speaking", () => {
    chatState.messages = [
      { id: "m1", role: "assistant", parts: [{ type: "text", text: "First" }] },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "Second" }],
      },
    ];
    voice.speakingId = "m1";
    voice.speaking = true;
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);

    expect(
      screen.getAllByRole("button", { name: /stop reading aloud/i }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: /^read aloud$/i }),
    ).toHaveLength(1);
  });

  it("offers no read-aloud control on an empty reply", () => {
    chatState.messages = [
      { id: "m1", role: "assistant", parts: [{ type: "text", text: "   " }] },
    ];
    render(<OnboardingClient brandId="b1" brandContext={brandContext} />);

    expect(screen.queryByRole("button", { name: /read aloud/i })).toBeNull();
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

import { beforeEach, describe, expect, it, vi } from "vitest";

const createMessage = vi.fn();
const setBrandOnboardingConversation = vi.fn();
const buildOnboardingPrompt = vi.fn().mockReturnValue("onboarding prompt");
const summarizeIntoMemory = vi.fn();
const streamText = vi.fn();
const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("ai", () => ({
  convertToModelMessages: (m: unknown) => m,
  stepCountIs: () => 6,
  streamText: (opts: unknown) => streamText(opts),
}));
vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => checkRateLimit(),
  tooManyRequests: () => Response.json({ error: "slow" }, { status: 429 }),
}));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: () => checkBrandAccess(),
  createConversation: vi.fn(),
  createMessage: (args: unknown) => createMessage(args),
  getConversationById: vi.fn(),
  touchConversation: vi.fn(),
  updateConversationTitle: vi.fn(),
  setBrandOnboardingConversation: (b: string, c: string | null) =>
    setBrandOnboardingConversation(b, c),
}));
const { ensureConversation } = vi.hoisted(() => ({
  ensureConversation: vi.fn(),
}));
vi.mock("./ensure-conversation", () => ({
  conversationTitleFrom: (t: string) => t,
  ensureConversation: (...args: unknown[]) => ensureConversation(...args),
}));
vi.mock("./title", () => ({
  buildTitlePrompt: (t: string) => t,
  cleanGeneratedTitle: (t: string) => t,
}));
vi.mock("@/lib/ai/memory", () => ({
  buildMemoryBlock: vi.fn().mockResolvedValue(""),
  summarizeIntoMemory: (args: unknown) => summarizeIntoMemory(args),
}));
const deferred: (() => unknown)[] = [];
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    deferred.push(fn);
  },
}));
vi.mock("@/lib/ai/prompts/onboarding", () => ({
  buildOnboardingPrompt: (c: unknown, o: unknown) =>
    buildOnboardingPrompt(c, o),
}));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));
vi.mock("@/lib/ai/provider-config", () => ({
  resolveProviderConfig: () => ({ provider: "bedrock" }),
}));
vi.mock("@/lib/ai/tools", () => ({
  buildBrandTools: () => ({}),
  providerSupportsTools: () => false,
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: vi.fn(),
}));
vi.mock("@/lib/analytics/session-id", () => ({
  getAnalyticsSessionId: vi.fn().mockResolvedValue("s1"),
}));

import { POST } from "./route";

const BRAND = "11111111-1111-4111-8111-111111111111";
const CONVO = "22222222-2222-4222-8222-222222222222";

function req(body: Record<string, unknown>) {
  return new Request("http://x/api/chat", {
    method: "POST",
    body: JSON.stringify({
      brandId: BRAND,
      conversationId: CONVO,
      mode: "onboarding",
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      brandContext: {
        brandProfile: "",
        audience: "",
        brandVoice: "",
        existingCampaigns: "",
        previousConversations: "",
      },
      ...body,
    }),
  });
}

/** Runs the route, then fires the onFinish the handler registered. */
async function finishWith(text: string) {
  const res = await POST(req({}));
  if (streamText.mock.calls.length === 0) {
    throw new Error(`route returned ${res.status}: ${await res.text()}`);
  }
  const opts = streamText.mock.calls[0][0] as {
    onFinish: (r: { text: string }) => Promise<void>;
  };
  await opts.onFinish({ text });
}

beforeEach(() => {
  vi.clearAllMocks();
  deferred.length = 0;
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: BRAND } });
  checkRateLimit.mockResolvedValue({ ok: true });
  createMessage.mockResolvedValue({ id: "m1" });
  ensureConversation.mockResolvedValue({ ok: true, created: false });
  streamText.mockReturnValue({
    toUIMessageStreamResponse: () => new Response("ok"),
  });
});

describe("POST /api/chat persistence", () => {
  /* An onboarding chat is persisted as a `strategy` conversation, so Recent
     Chats reopens it and renders the stored content. The strip has to happen
     here — a renderer-only fix leaves the raw protocol in the database and on
     any other surface that reads it. */
  it("never stores a poll marker", async () => {
    await finishWith("What do you do better? [[poll:differentiation]]");

    const assistant = createMessage.mock.calls
      .map(([args]) => args as { role: string; content: string })
      .find((a) => a.role === "assistant");
    expect(assistant?.content).toBe("What do you do better?");
  });

  it("strips a fragment left by a Stop mid-marker", async () => {
    await finishWith("What do you do better?\n\n[[poll:differentiati");

    const assistant = createMessage.mock.calls
      .map(([args]) => args as { role: string; content: string })
      .find((a) => a.role === "assistant");
    expect(assistant?.content).toBe("What do you do better?");
  });

  /* The memory summary feeds buildMemoryBlock into the strategy prompt, so a
     marker surviving here reaches a later model call as brand context. */
  it("keeps the marker out of the memory summary", async () => {
    await finishWith("Noted. What sets you apart? [[poll:differentiation]]");

    const summarised = JSON.stringify(summarizeIntoMemory.mock.calls);
    expect(summarised).not.toContain("[[poll:");
  });

  /* Strategy and design answers are markdown, and this text is written to the
     database — reformatting it here is not recoverable in a renderer. */
  it("stores ordinary markdown byte-for-byte", async () => {
    const markdown = "Channels:\n\n- Instagram\n  - Reels 3x/wk\n- TikTok";
    await finishWith(markdown);

    const assistant = createMessage.mock.calls
      .map(([args]) => args as { role: string; content: string })
      .find((a) => a.role === "assistant");
    expect(assistant?.content).toBe(markdown);
  });
});

/* KOOS-V1-BUG-025. A client could read KO's question, type an answer, press
   Enter, and have it silently discarded — repeatedly, with no error.
   `toUIMessageStreamResponse()` keeps the stream open until onFinish resolves,
   and onFinish awaited a second LLM call (the memory summary, plus title
   generation on a first turn). Until it returned, useChat stayed at
   status "streaming", so `isLoading` was true and handleSend refused to send.
   Measured: a 3s onFinish held the stream 3.0s past the last text chunk; the
   real call is unbounded. Post-processing must therefore outlive the response
   instead of gating it. */
describe("POST /api/chat does not gate the stream on post-processing", () => {
  it("finishes the turn even while the memory summary is still running", async () => {
    summarizeIntoMemory.mockReturnValue(new Promise(() => {}));

    await expect(
      finishWith("What does success look like for you?"),
    ).resolves.toBeUndefined();
  });

  it("still runs the memory summary, after the response", async () => {
    summarizeIntoMemory.mockResolvedValue(undefined);

    await finishWith("What does success look like for you?");
    expect(summarizeIntoMemory).not.toHaveBeenCalled();

    await Promise.all(deferred.map((fn) => fn()));
    expect(summarizeIntoMemory).toHaveBeenCalledTimes(1);
  });
});

/* KOOS-V1-BUG-027. OnboardingClient minted a new conversation id on every
   mount, so a refresh lost the thread and KO began again from question one.
   Resuming needs the brand to remember which conversation was the onboarding
   one — conversations themselves only carry 'strategy' | 'design'. */
describe("POST /api/chat linking the onboarding conversation", () => {
  it("records the conversation the first time an onboarding chat is created", async () => {
    ensureConversation.mockResolvedValue({ ok: true, created: true });

    await POST(req({ mode: "onboarding" }));

    expect(setBrandOnboardingConversation).toHaveBeenCalledWith(BRAND, CONVO);
  });

  it("does not relink a conversation that already exists", async () => {
    ensureConversation.mockResolvedValue({ ok: true, created: false });

    await POST(req({ mode: "onboarding" }));

    expect(setBrandOnboardingConversation).not.toHaveBeenCalled();
  });

  /* A strategy chat is not an onboarding session and must never claim the slot
     the brand resumes from. */
  it("never links a strategy chat", async () => {
    ensureConversation.mockResolvedValue({ ok: true, created: true });

    await POST(req({ mode: "strategy" }));

    expect(setBrandOnboardingConversation).not.toHaveBeenCalled();
  });
});

/* KOOS-V1-BUG-028: a brand whose profile was already filled in was put through
   the questionnaire again. Completeness is decided from the brand row the
   access check already loaded, never from the client. */
describe("POST /api/chat onboarding prompt selection", () => {
  /* isBasicsComplete's REQUIRED_FIELDS: name, overview, businessType, stage. */
  const complete = {
    id: BRAND,
    name: "Acme",
    overview: "We roast coffee",
    businessType: "Product",
    stage: "Growing",
  };

  it("tells the prompt when the profile is already complete", async () => {
    checkBrandAccess.mockResolvedValue({ ok: true, brand: complete });

    await POST(req({ mode: "onboarding" }));

    expect(buildOnboardingPrompt.mock.calls[0][1]).toMatchObject({
      profileComplete: true,
    });
  });

  it("interviews a brand that is still incomplete", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: true,
      brand: { id: BRAND, name: "Acme" },
    });

    await POST(req({ mode: "onboarding" }));

    expect(buildOnboardingPrompt.mock.calls[0][1]).toMatchObject({
      profileComplete: false,
    });
  });
});

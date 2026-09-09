import { beforeEach, describe, expect, it, vi } from "vitest";

const createMessage = vi.fn();
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
}));
vi.mock("./ensure-conversation", () => ({
  conversationTitleFrom: (t: string) => t,
  ensureConversation: vi.fn().mockResolvedValue({ ok: true, created: false }),
}));
vi.mock("./title", () => ({
  buildTitlePrompt: (t: string) => t,
  cleanGeneratedTitle: (t: string) => t,
}));
vi.mock("@/lib/ai/memory", () => ({
  buildMemoryBlock: vi.fn().mockResolvedValue(""),
  summarizeIntoMemory: (args: unknown) => summarizeIntoMemory(args),
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
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  checkBrandAccess.mockResolvedValue({ ok: true });
  checkRateLimit.mockResolvedValue({ ok: true });
  createMessage.mockResolvedValue({ id: "m1" });
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

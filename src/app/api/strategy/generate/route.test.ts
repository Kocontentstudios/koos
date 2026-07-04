import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getBrandById = vi.fn();
const createStrategy = vi.fn();
const recordUsageEvent = vi.fn();
const generateObject = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getBrandById: (id: string) => getBrandById(id),
  createStrategy: (data: unknown) => createStrategy(data),
  recordUsageEvent: (data: unknown) => recordUsageEvent(data),
}));
vi.mock("ai", () => ({ generateObject: (opts: unknown) => generateObject(opts) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => ({}) }));
vi.mock("@/lib/ai/strategy-schema", () => ({ strategySchema: {} }));
vi.mock("@/lib/ai/prompts/strategy", () => ({
  buildStrategistSystemPrompt: () => "sys",
  buildStrategyGenerationPrompt: () => "prompt",
}));

import { POST } from "./route";

describe("strategy generate route", () => {
  const BRAND_ID = "11111111-1111-4111-8111-111111111111";
  const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    getBrandById.mockResolvedValue({
      id: BRAND_ID,
      userId: "u1",
      name: "Acme",
    });
    generateObject.mockResolvedValue({ object: { campaignName: "Camp" } });
    createStrategy.mockResolvedValue({ id: "s1" });
  });

  it("stores the conversationId on the created strategy", async () => {
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({
        brandId: BRAND_ID,
        conversation: "user: hi",
        conversationId: CONVERSATION_ID,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(createStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: BRAND_ID,
        conversationId: CONVERSATION_ID,
      }),
    );
  });

  it("still works when conversationId is omitted (null)", async () => {
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({ brandId: BRAND_ID, conversation: "user: hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(createStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null }),
    );
  });

  it("rejects a malformed conversationId with 400", async () => {
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({
        brandId: BRAND_ID,
        conversation: "user: hi",
        conversationId: "bad",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(createStrategy).not.toHaveBeenCalled();
  });
});

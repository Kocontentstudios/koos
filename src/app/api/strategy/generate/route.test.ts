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
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    getBrandById.mockResolvedValue({ id: "b1", userId: "u1", name: "Acme" });
    generateObject.mockResolvedValue({ object: { campaignName: "Camp" } });
    createStrategy.mockResolvedValue({ id: "s1" });
  });

  it("stores the conversationId on the created strategy", async () => {
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({
        brandId: "b1",
        conversation: "user: hi",
        conversationId: "c1",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(createStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: "b1", conversationId: "c1" }),
    );
  });

  it("still works when conversationId is omitted (null)", async () => {
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({ brandId: "b1", conversation: "user: hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(createStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null }),
    );
  });
});

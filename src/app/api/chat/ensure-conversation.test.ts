import { describe, expect, it, vi } from "vitest";
import { ensureConversation } from "./ensure-conversation";

function deps(over: Partial<Parameters<typeof ensureConversation>[0]> = {}) {
  return {
    getConversationById: vi.fn().mockResolvedValue(null),
    createConversation: vi.fn().mockResolvedValue({ id: "c1" }),
    ...over,
  };
}

const args = { conversationId: "c1", brandId: "b1", userId: "u1" };

describe("ensureConversation", () => {
  it("creates the conversation when it does not exist, owned by the user+brand", async () => {
    const d = deps();
    const res = await ensureConversation(d, args);
    expect(res.ok).toBe(true);
    expect(d.createConversation).toHaveBeenCalledWith({
      id: "c1",
      brandId: "b1",
      userId: "u1",
    });
  });

  it("accepts an existing conversation owned by the same user", async () => {
    const d = deps({
      getConversationById: vi
        .fn()
        .mockResolvedValue({ id: "c1", userId: "u1", brandId: "b1" }),
    });
    const res = await ensureConversation(d, args);
    expect(res.ok).toBe(true);
    expect(d.createConversation).not.toHaveBeenCalled();
  });

  it("rejects an existing conversation owned by another user (403)", async () => {
    const d = deps({
      getConversationById: vi
        .fn()
        .mockResolvedValue({ id: "c1", userId: "someone-else", brandId: "b1" }),
    });
    const res = await ensureConversation(d, args);
    expect(res).toEqual({ ok: false, status: 403, error: expect.any(String) });
    expect(d.createConversation).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  conversationTitleFrom,
  ensureConversation,
} from "./ensure-conversation";

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
    expect(res).toEqual({ ok: true, created: true });
    expect(d.createConversation).toHaveBeenCalledWith({
      id: "c1",
      brandId: "b1",
      userId: "u1",
      title: null,
    });
  });

  it("stores the provided title on a newly created conversation", async () => {
    const d = deps();
    await ensureConversation(d, { ...args, title: "Launch my skincare kit" });
    expect(d.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Launch my skincare kit" }),
    );
  });

  it("accepts an existing conversation owned by the same user", async () => {
    const d = deps({
      getConversationById: vi
        .fn()
        .mockResolvedValue({ id: "c1", userId: "u1", brandId: "b1" }),
    });
    const res = await ensureConversation(d, args);
    expect(res).toEqual({ ok: true, created: false });
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

describe("conversationTitleFrom", () => {
  it("collapses whitespace and trims", () => {
    expect(conversationTitleFrom("  Launch\n my   kit  ")).toBe(
      "Launch my kit",
    );
  });

  it("returns null for empty text", () => {
    expect(conversationTitleFrom("   \n ")).toBeNull();
  });

  it("truncates long messages to ~60 chars with an ellipsis", () => {
    const title = conversationTitleFrom("x".repeat(100));
    expect(title).toHaveLength(58);
    expect(title?.endsWith("…")).toBe(true);
  });
});

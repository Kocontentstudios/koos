import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/ai/strategy-schema";

const requireBrand = vi.fn();
const getStrategyById = vi.fn();
const updateStrategy = vi.fn();
const archiveSupersededStrategies = vi.fn();
const createMessage = vi.fn();
const touchConversation = vi.fn();
const captureServerEvent = vi.fn();

vi.mock("@/lib/auth/require-brand", () => ({
  requireBrand: () => requireBrand(),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: (e: unknown) => captureServerEvent(e),
}));
vi.mock("@/lib/db/queries", () => ({
  getStrategyById: (id: string) => getStrategyById(id),
  updateStrategy: (id: string, data: unknown) => updateStrategy(id, data),
  archiveSupersededStrategies: (c: string, k: string) =>
    archiveSupersededStrategies(c, k),
  createMessage: (data: unknown) => createMessage(data),
  touchConversation: (id: string) => touchConversation(id),
}));

import { addStrategyRecap, saveStrategy } from "./actions";

const strategy: Strategy = {
  campaignName: "Ramadan Gift Bundles",
  objective: "Sell 500 bundles",
  targetAudience: "Lagos professionals",
  keyMessage: "Give a bundle, not a guess",
  channels: [{ name: "Instagram", rationale: "reach" }],
  contentMix: [{ type: "Reel", count: 4 }],
  timeline: [{ phase: "Launch", dateRange: "Week 1", focus: "orders" }],
  themes: [{ title: "Generosity", description: "gifting as care" }],
  postingSchedule: [{ channel: "Instagram", cadence: "4x weekly" }],
};

const row = {
  id: "s1",
  brandId: "brand-1",
  conversationId: "conv-1",
  name: "Ramadan Gift Bundles",
  structured: strategy,
  status: "draft",
  updatedAt: new Date("2026-08-25T10:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  requireBrand.mockResolvedValue({
    brand: { id: "brand-1" },
    dbUser: { id: "user-1" },
  });
  updateStrategy.mockImplementation(
    async (_id: string, data: { status: string }) => ({
      ...row,
      ...data,
    }),
  );
  archiveSupersededStrategies.mockResolvedValue(1);
  createMessage.mockResolvedValue({ id: "msg-1" });
  captureServerEvent.mockResolvedValue(undefined);
});

describe("saveStrategy", () => {
  /* Regression: this action shipped with NO authorization at all — no session
     check, no ownership check. Server actions are reachable POST endpoints, so
     any caller could flip any strategy id to active. */
  it("authorizes the caller before writing anything", async () => {
    getStrategyById.mockResolvedValue(row);
    const res = await saveStrategy("s1");
    expect(res.ok).toBe(true);
    expect(requireBrand).toHaveBeenCalled();
    expect(
      requireBrand.mock.invocationCallOrder[0],
      "authorization must run before the write",
    ).toBeLessThan(updateStrategy.mock.invocationCallOrder[0]);
  });

  it("commits the strategy and returns the saved card", async () => {
    getStrategyById.mockResolvedValue(row);
    const res = await saveStrategy("s1");
    expect(updateStrategy).toHaveBeenCalledWith("s1", { status: "active" });
    if (!res.ok) throw new Error("expected ok");
    expect(res.card).toMatchObject({
      id: "s1",
      campaignName: "Ramadan Gift Bundles",
      status: "active",
    });
  });

  it("archives the chat's earlier versions but never the saved one", async () => {
    getStrategyById.mockResolvedValue(row);
    await saveStrategy("s1");
    expect(archiveSupersededStrategies).toHaveBeenCalledWith("conv-1", "s1");
  });

  it("skips archiving for a strategy with no chat", async () => {
    getStrategyById.mockResolvedValue({ ...row, conversationId: null });
    const res = await saveStrategy("s1");
    expect(res.ok).toBe(true);
    expect(archiveSupersededStrategies).not.toHaveBeenCalled();
  });

  it("refuses a strategy belonging to another brand", async () => {
    getStrategyById.mockResolvedValue({ ...row, brandId: "someone-else" });
    const res = await saveStrategy("s1");
    expect(res).toEqual({ ok: false, error: "Strategy not found." });
    expect(updateStrategy).not.toHaveBeenCalled();
    expect(archiveSupersededStrategies).not.toHaveBeenCalled();
  });

  it("refuses a strategy that does not exist, without leaking that fact", async () => {
    getStrategyById.mockResolvedValue(null);
    const res = await saveStrategy("nope");
    expect(res).toEqual({ ok: false, error: "Strategy not found." });
    expect(updateStrategy).not.toHaveBeenCalled();
  });

  it("reports failure instead of throwing when the write fails", async () => {
    getStrategyById.mockResolvedValue(row);
    updateStrategy.mockRejectedValue(new Error("db down"));
    const res = await saveStrategy("s1");
    expect(res).toEqual({ ok: false, error: "Could not save strategy." });
  });
});

describe("addStrategyRecap", () => {
  it("persists the recap as an assistant message in the strategy's chat", async () => {
    getStrategyById.mockResolvedValue(row);
    const res = await addStrategyRecap("s1");
    if (!res.ok) throw new Error("expected ok");
    expect(res.text).toContain("Ramadan Gift Bundles");
    expect(createMessage).toHaveBeenCalledWith({
      conversationId: "conv-1",
      role: "assistant",
      content: res.text,
    });
    expect(touchConversation).toHaveBeenCalledWith("conv-1");
  });

  it("refuses a strategy belonging to another brand", async () => {
    getStrategyById.mockResolvedValue({ ...row, brandId: "someone-else" });
    const res = await addStrategyRecap("s1");
    expect(res).toEqual({ ok: false, error: "Strategy not found." });
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("reports a strategy with no chat rather than writing a stray message", async () => {
    getStrategyById.mockResolvedValue({ ...row, conversationId: null });
    const res = await addStrategyRecap("s1");
    expect(res).toEqual({
      ok: false,
      error: "This strategy isn't attached to a chat.",
    });
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("reports an unparseable strategy instead of posting an empty recap", async () => {
    getStrategyById.mockResolvedValue({ ...row, structured: { nope: true } });
    const res = await addStrategyRecap("s1");
    expect(res).toEqual({
      ok: false,
      error: "This strategy could not be loaded.",
    });
    expect(createMessage).not.toHaveBeenCalled();
  });
});

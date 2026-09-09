import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/ai/strategy-schema";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const getConversationById = vi.fn();
const getConversationMessages = vi.fn();
const listDesignBriefsForConversation = vi.fn();
const getLatestStrategyForConversation = vi.fn();
const renameConversation = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (u: string, b: string, p: string) =>
    checkBrandAccess(u, b, p),
  getConversationById: (id: string) => getConversationById(id),
  getConversationMessages: (id: string) => getConversationMessages(id),
  listDesignBriefsForConversation: (id: string) =>
    listDesignBriefsForConversation(id),
  getLatestStrategyForConversation: (id: string) =>
    getLatestStrategyForConversation(id),
  renameConversation: (id: string, t: string) => renameConversation(id, t),
}));

import { GET, MAX_CONVERSATION_TITLE, PATCH } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ id: ID }) };
const otherParams = (id: string) => ({ params: Promise.resolve({ id }) });

const strategy: Strategy = {
  campaignName: "Ramadan Gift Bundles",
  objective: "Sell 500 bundles",
  targetAudience: "Lagos professionals",
  keyMessage: "Give a bundle, not a guess",
  channels: [
    { name: "Instagram", rationale: "reach" },
    { name: "WhatsApp", rationale: "closes" },
  ],
  contentMix: [{ type: "Reel", count: 4 }],
  timeline: [{ phase: "Launch", dateRange: "Week 1", focus: "orders" }],
  themes: [{ title: "Generosity", description: "gifting" }],
  postingSchedule: [{ channel: "Instagram", cadence: "4x weekly" }],
};

const patchReq = (body: unknown) =>
  new Request("http://test/api/chat/conversations/x", {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ dbUser: { id: "user-1" } });
  getConversationById.mockResolvedValue({
    id: ID,
    brandId: "brand-1",
    title: "Old title",
    titleCustom: false,
    mode: "strategy",
  });
  checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "brand-1" } });
  getConversationMessages.mockResolvedValue([]);
  listDesignBriefsForConversation.mockResolvedValue([]);
  getLatestStrategyForConversation.mockResolvedValue(null);
  renameConversation.mockImplementation(async (id: string, title: string) => ({
    id,
    title,
  }));
});

describe("GET", () => {
  it("returns the chat's campaign strategy as a card", async () => {
    getLatestStrategyForConversation.mockResolvedValue({
      id: "s1",
      name: "Ramadan Gift Bundles",
      structured: strategy,
      status: "active",
      updatedAt: new Date("2026-08-25T10:00:00.000Z"),
    });
    const res = await GET(new Request("http://test"), params);
    const body = await res.json();
    expect(body.strategy).toEqual({
      id: "s1",
      campaignName: "Ramadan Gift Bundles",
      objective: "Sell 500 bundles",
      channels: ["Instagram", "WhatsApp"],
      phaseCount: 1,
      timelineSpan: "Launch",
      status: "active",
    });
  });

  it("returns a null strategy for a chat that has none", async () => {
    const body = await (await GET(new Request("http://test"), params)).json();
    expect(body.strategy).toBeNull();
  });

  /* A strategy stored under an older schema must not take the whole chat down
     with it — the chat still opens, just without a card. */
  it("degrades a stale stored shape to no card", async () => {
    getLatestStrategyForConversation.mockResolvedValue({
      id: "s1",
      name: "Legacy",
      structured: { campaignName: "Legacy" },
      status: "active",
      updatedAt: new Date(),
    });
    const body = await (await GET(new Request("http://test"), params)).json();
    expect(body.strategy).toBeNull();
  });

  it("reports whether the title is user-owned", async () => {
    getConversationById.mockResolvedValue({
      id: ID,
      brandId: "brand-1",
      title: "My name",
      titleCustom: true,
      mode: "strategy",
    });
    const body = await (await GET(new Request("http://test"), params)).json();
    expect(body.titleCustom).toBe(true);
  });

  it("404s an unauthenticated caller as 401", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await GET(new Request("http://test"), params);
    expect(res.status).toBe(401);
  });

  it("404s a malformed id without touching the database", async () => {
    const res = await GET(new Request("http://test"), otherParams("nope"));
    expect(res.status).toBe(404);
    expect(getConversationById).not.toHaveBeenCalled();
  });

  it("refuses a conversation in another workspace", async () => {
    checkBrandAccess.mockResolvedValue({ ok: false, status: 403 });
    const res = await GET(new Request("http://test"), params);
    expect(res.status).toBe(403);
  });
});

describe("PATCH", () => {
  it("renames the chat and locks the title", async () => {
    const res = await PATCH(patchReq({ title: "  Eid Bundles  " }), params);
    expect(res.status).toBe(200);
    expect(renameConversation).toHaveBeenCalledWith(ID, "Eid Bundles");
    expect(await res.json()).toEqual({ id: ID, title: "Eid Bundles" });
  });

  it("rejects an empty or whitespace title", async () => {
    const res = await PATCH(patchReq({ title: "   " }), params);
    expect(res.status).toBe(400);
    expect(renameConversation).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-string title", async () => {
    expect((await PATCH(patchReq({}), params)).status).toBe(400);
    expect((await PATCH(patchReq({ title: 42 }), params)).status).toBe(400);
    expect(renameConversation).not.toHaveBeenCalled();
  });

  it("rejects a title over the sidebar limit", async () => {
    const res = await PATCH(
      patchReq({ title: "x".repeat(MAX_CONVERSATION_TITLE + 1) }),
      params,
    );
    expect(res.status).toBe(400);
    expect(renameConversation).not.toHaveBeenCalled();
  });

  it("accepts a title exactly at the limit", async () => {
    const res = await PATCH(
      patchReq({ title: "x".repeat(MAX_CONVERSATION_TITLE) }),
      params,
    );
    expect(res.status).toBe(200);
  });

  it("rejects an unparseable body", async () => {
    const res = await PATCH(patchReq("{not json"), params);
    expect(res.status).toBe(400);
  });

  /* Same answer as GET for a conversation the caller cannot see, so PATCH
     never becomes an existence oracle for another workspace's chat ids. */
  it("refuses a conversation in another workspace before reading the body", async () => {
    checkBrandAccess.mockResolvedValue({ ok: false, status: 403 });
    const res = await PATCH(patchReq({ title: "hijack" }), params);
    expect(res.status).toBe(403);
    expect(renameConversation).not.toHaveBeenCalled();
  });

  it("404s a conversation that vanished between the check and the write", async () => {
    renameConversation.mockResolvedValue(null);
    const res = await PATCH(patchReq({ title: "Eid" }), params);
    expect(res.status).toBe(404);
  });
});

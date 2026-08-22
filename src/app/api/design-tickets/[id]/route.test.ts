import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const deleteDraftTicket = vi.fn();
const checkBrandAccess = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  deleteDraftTicket: (id: string) => deleteDraftTicket(id),
  checkBrandAccess: (u: string, b: string, c: string) =>
    checkBrandAccess(u, b, c),
  replaceTicketAttachments: vi.fn(),
  updateDraftTicket: vi.fn(),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: vi.fn(),
}));
vi.mock("@/lib/analytics/session-id", () => ({
  getAnalyticsSessionId: vi.fn(),
}));

import { DELETE } from "./route";

const params = { params: Promise.resolve({ id: "t-1" }) };
const DRAFT = {
  id: "t-1",
  userId: "u1",
  brandId: "brand-1",
  status: "draft",
};

describe("DELETE /api/design-tickets/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    getDesignTicketById.mockResolvedValue(DRAFT);
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "brand-1" } });
  });

  it("deletes the caller's own draft", async () => {
    const res = await DELETE(new Request("http://x"), params);
    expect(res.status).toBe(200);
    expect(deleteDraftTicket).toHaveBeenCalledWith("t-1");
  });

  it("returns 401 when signed out", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await DELETE(new Request("http://x"), params);
    expect(res.status).toBe(401);
    expect(deleteDraftTicket).not.toHaveBeenCalled();
  });

  /* Regression: this route used to authorize on row ownership alone, routing
     around the capability model entirely. Owning the row is not enough once
     the caller has been removed from the workspace or narrowed out of the
     brand — the guard has to agree. */
  it("refuses a draft the brand guard rejects, even though the caller owns it", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
    const res = await DELETE(new Request("http://x"), params);
    expect(res.status).toBe(404);
    expect(deleteDraftTicket).not.toHaveBeenCalled();
  });

  it("asks the guard for manage_content on the ticket's brand", async () => {
    await DELETE(new Request("http://x"), params);
    expect(checkBrandAccess).toHaveBeenCalledWith(
      "u1",
      "brand-1",
      "manage_content",
    );
  });

  it("404s another user's draft without consulting the guard", async () => {
    getDesignTicketById.mockResolvedValue({ ...DRAFT, userId: "someone-else" });
    const res = await DELETE(new Request("http://x"), params);
    expect(res.status).toBe(404);
    expect(checkBrandAccess).not.toHaveBeenCalled();
  });
});

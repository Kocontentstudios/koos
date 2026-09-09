import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const deleteDraftTicket = vi.fn();
const checkBrandAccess = vi.fn();
const postClientTicketComment = vi.fn();
const getStaffUsers = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  deleteDraftTicket: (id: string) => deleteDraftTicket(id),
  checkBrandAccess: (u: string, b: string, c: string) =>
    checkBrandAccess(u, b, c),
  replaceTicketAttachments: vi.fn(),
  updateDraftTicket: vi.fn(),
  postClientTicketComment: (i: unknown) => postClientTicketComment(i),
  getStaffUsers: () => getStaffUsers(),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: vi.fn(),
}));
vi.mock("@/lib/analytics/session-id", () => ({
  getAnalyticsSessionId: vi.fn(),
}));

import { DELETE, POST } from "./route";

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

describe("POST /api/design-tickets/[id] — client comments", () => {
  const TICKET = {
    id: "t-1",
    userId: "u1",
    brandId: "brand-1",
    status: "in_progress",
    ticketNumber: 7,
  };

  function post(body: unknown) {
    return POST(
      new Request("http://x", { method: "POST", body: JSON.stringify(body) }),
      params,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    getDesignTicketById.mockResolvedValue(TICKET);
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "brand-1" } });
    getStaffUsers.mockResolvedValue([{ id: "staff-1" }, { id: "staff-2" }]);
    postClientTicketComment.mockResolvedValue({ id: "up-1" });
  });

  it("posts a comment and notifies staff", async () => {
    const res = await post({ message: "Please make the logo bigger." });

    expect(res.status).toBe(201);
    expect(postClientTicketComment).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "t-1",
        authorId: "u1",
        message: "Please make the logo bigger.",
        staffIds: ["staff-1", "staff-2"],
      }),
    );
  });

  /* The gap this endpoint exists to close: the review route requires
     status === "ready_for_review", so the client could say nothing while work
     was in progress and nothing after approving. */
  it.each(["draft", "in_progress", "delivered", "revision_requested"])(
    "accepts a comment while the ticket is %s",
    async (status) => {
      getDesignTicketById.mockResolvedValue({ ...TICKET, status });
      expect((await post({ message: "A note" })).status).toBe(201);
    },
  );

  /* revision_requested is reachable only through applyClientReview, and the
     staff routes cap themselves to the same end. A comment that could carry a
     status would quietly undo that restriction. */
  it("ignores any status the caller tries to smuggle in", async () => {
    await post({ message: "sneaky", newStatus: "revision_requested" });

    const arg = postClientTicketComment.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(arg).not.toHaveProperty("newStatus");
    expect(JSON.stringify(arg)).not.toContain("revision_requested");
  });

  it("rejects an empty or whitespace-only comment", async () => {
    expect((await post({ message: "   " })).status).toBe(400);
    expect((await post({ message: "" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(postClientTicketComment).not.toHaveBeenCalled();
  });

  it("rejects a non-string message", async () => {
    expect((await post({ message: 42 })).status).toBe(400);
    expect(postClientTicketComment).not.toHaveBeenCalled();
  });

  it("rejects a comment over the length cap", async () => {
    const res = await post({ message: "x".repeat(2001) });
    expect(res.status).toBe(400);
    expect(postClientTicketComment).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await post({ message: "hi" })).status).toBe(401);
    expect(postClientTicketComment).not.toHaveBeenCalled();
  });

  it("404s an unknown ticket", async () => {
    getDesignTicketById.mockResolvedValue(null);
    expect((await post({ message: "hi" })).status).toBe(404);
  });

  /* Someone else's brand must not be reachable, and a 404 rather than a 403
     keeps existence from leaking. */
  it("refuses a ticket on a brand the caller cannot manage", async () => {
    checkBrandAccess.mockResolvedValue({ ok: false, status: 404 });
    expect((await post({ message: "hi" })).status).toBe(404);

    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    expect((await post({ message: "hi" })).status).toBe(403);
    expect(postClientTicketComment).not.toHaveBeenCalled();
  });

  it("asks for manage_content, the same permission a revision needs", async () => {
    await post({ message: "hi" });
    expect(checkBrandAccess).toHaveBeenCalledWith(
      "u1",
      "brand-1",
      "manage_content",
    );
  });

  it("rejects a malformed body", async () => {
    const res = await POST(
      new Request("http://x", { method: "POST", body: "not json" }),
      params,
    );
    expect(res.status).toBe(400);
  });
});

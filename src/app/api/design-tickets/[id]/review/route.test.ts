import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const checkBrandAccess = vi.fn();
const updateCalendarItemStatus = vi.fn();
const applyClientReview = vi.fn();
const sendTicketReviewTeamEmail = vi.fn();
const sendTicketReviewClientEmail = vi.fn();
const getDeliverables = vi.fn();
const addAnnotation = vi.fn();
const getStaffUsers = vi.fn();
const getUserById = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  updateCalendarItemStatus: (id: string, s: unknown) =>
    updateCalendarItemStatus(id, s),
  applyClientReview: (input: unknown) => applyClientReview(input),
  getDeliverables: (ticketId: string) => getDeliverables(ticketId),
  addAnnotation: (data: unknown) => addAnnotation(data),
  getStaffUsers: () => getStaffUsers(),
  getUserById: (id: string) => getUserById(id),
}));
vi.mock("@/lib/design/notify", () => ({
  appUrl: (p: string) => `https://app${p}`,
  sendTicketReviewTeamEmail: (a: unknown) => sendTicketReviewTeamEmail(a),
  sendTicketReviewClientEmail: (a: unknown) => sendTicketReviewClientEmail(a),
}));

import { POST } from "./route";

const ticket = {
  id: "t1",
  userId: "u1",
  brandId: "b1",
  ticketNumber: 12,
  designType: "Flyer",
  status: "ready_for_review",
  calendarItemId: null,
  deliveryEmail: null,
  notes: null,
};

const v1 = {
  id: "d1",
  ticketId: "t1",
  version: 1,
  createdAt: new Date("2026-08-01T00:00:00Z"),
};
const v2a = {
  id: "d2",
  ticketId: "t1",
  version: 2,
  createdAt: new Date("2026-08-05T00:00:00Z"),
};
const v2b = {
  id: "d3",
  ticketId: "t1",
  version: 2,
  createdAt: new Date("2026-08-05T00:00:00Z"),
};

const RECT = [{ type: "rect", coords: [1, 2, 3, 4], color: "#f00" }];

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "t1" }) };

describe("customer review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({
      dbUser: {
        id: "u1",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@x.com",
      },
    });
    getDesignTicketById.mockResolvedValue(ticket);
    checkBrandAccess.mockResolvedValue({
      ok: true,
      brand: { id: "b1", userId: "u1" },
    });
    updateCalendarItemStatus.mockResolvedValue({});
    applyClientReview.mockResolvedValue({
      ticket: { ...ticket, status: "delivered" },
      update: { id: "up1" },
    });
    // Two rounds delivered; only the v2 files are open for feedback.
    getDeliverables.mockResolvedValue([v1, v2a, v2b]);
    addAnnotation.mockResolvedValue({ id: "a1" });
    getStaffUsers.mockResolvedValue([
      { id: "s1", firstName: "Alice", lastName: "Smith", role: "designer" },
      { id: "s2", firstName: "Bob", lastName: "Jones", role: "admin" },
    ]);
    getUserById.mockResolvedValue({ id: "u1", email: "owner@x.com" });
  });

  describe("guards", () => {
    it("401s without a session", async () => {
      getAuthUser.mockResolvedValue({ dbUser: null });
      const res = await POST(req({ action: "approve" }), params);
      expect(res.status).toBe(401);
      expect(applyClientReview).not.toHaveBeenCalled();
    });

    it("400s on an unknown action", async () => {
      const res = await POST(req({ action: "destroy" }), params);
      expect(res.status).toBe(400);
      expect(applyClientReview).not.toHaveBeenCalled();
    });

    it("404s for a ticket in another workspace without leaking its existence", async () => {
      checkBrandAccess.mockResolvedValue({ ok: false, status: 404 });
      const res = await POST(req({ action: "approve" }), params);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Ticket not found" });
      expect(applyClientReview).not.toHaveBeenCalled();
    });

    // The status predicate lives in the UPDATE, so a replayed approval loses the
    // race in the database rather than re-firing emails and calendar writes.
    it("409s when the ticket is no longer awaiting review", async () => {
      applyClientReview.mockResolvedValue(null);
      const res = await POST(req({ action: "approve" }), params);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: "This design isn't awaiting review.",
      });
      expect(sendTicketReviewTeamEmail).not.toHaveBeenCalled();
      expect(sendTicketReviewClientEmail).not.toHaveBeenCalled();
      expect(updateCalendarItemStatus).not.toHaveBeenCalled();
    });

    it("400s on a revision with neither a note nor markup", async () => {
      const res = await POST(req({ action: "revise" }), params);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Tell the designer what needs changing.",
      });
      expect(applyClientReview).not.toHaveBeenCalled();
    });

    it("accepts a revision carrying only markup", async () => {
      const res = await POST(
        req({
          action: "revise",
          annotations: [{ deliverableId: "d2", shapes: RECT }],
        }),
        params,
      );
      expect(res.status).toBe(200);
      expect(applyClientReview).toHaveBeenCalled();
    });

    // The loop is bounded at 3 rounds so a request can't ping-pong forever.
    it("409s on a revision once the final round has been delivered", async () => {
      getDeliverables.mockResolvedValue([
        { ...v1, version: 3, id: "d9" },
        v2a,
        v1,
      ]);
      const res = await POST(
        req({ action: "revise", note: "one more tweak" }),
        params,
      );
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/all 3 rounds/i);
      expect(applyClientReview).not.toHaveBeenCalled();
    });

    it("still accepts approval on the final round", async () => {
      getDeliverables.mockResolvedValue([{ ...v1, version: 3, id: "d9" }]);
      const res = await POST(req({ action: "approve" }), params);
      expect(res.status).toBe(200);
      expect(applyClientReview).toHaveBeenCalledWith(
        expect.objectContaining({ action: "approve", version: 3 }),
      );
    });

    it("400s on an oversized note", async () => {
      const res = await POST(
        req({ action: "revise", note: "x".repeat(2001) }),
        params,
      );
      expect(res.status).toBe(400);
      expect(applyClientReview).not.toHaveBeenCalled();
    });
  });

  describe("transitions", () => {
    it("applies an approval against the latest version and closes the calendar item", async () => {
      getDesignTicketById.mockResolvedValue({
        ...ticket,
        calendarItemId: "c1",
      });
      const res = await POST(req({ action: "approve" }), params);
      expect(res.status).toBe(200);
      expect(applyClientReview).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: "t1",
          authorId: "u1",
          action: "approve",
          note: null,
          version: 2,
          staffIds: ["s1", "s2"],
        }),
      );
      expect(updateCalendarItemStatus).toHaveBeenCalledWith("c1", "ready");
    });

    it("passes the trimmed revision note through", async () => {
      const res = await POST(
        req({ action: "revise", note: "  fix the logo  " }),
        params,
      );
      expect(res.status).toBe(200);
      expect(applyClientReview).toHaveBeenCalledWith(
        expect.objectContaining({ action: "revise", note: "fix the logo" }),
      );
    });

    it("leaves the calendar item alone on a revision", async () => {
      getDesignTicketById.mockResolvedValue({
        ...ticket,
        calendarItemId: "c1",
      });
      await POST(req({ action: "revise", note: "fix" }), params);
      expect(updateCalendarItemStatus).not.toHaveBeenCalled();
    });
  });

  describe("annotations", () => {
    it("persists an annotation on a latest-version deliverable", async () => {
      const res = await POST(
        req({
          action: "revise",
          note: "fix logo",
          annotations: [
            { deliverableId: "d2", shapes: RECT, note: "move left" },
          ],
        }),
        params,
      );
      expect(res.status).toBe(200);
      expect(addAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: "t1",
          deliverableId: "d2",
          authorId: "u1",
          shapes: RECT,
          note: "move left",
        }),
      );
    });

    // A page left open from round 1 would otherwise pin this round's feedback to
    // artwork the studio has already replaced.
    it("skips an annotation aimed at a superseded version", async () => {
      const res = await POST(
        req({
          action: "revise",
          note: "fix logo",
          annotations: [{ deliverableId: "d1", shapes: RECT }],
        }),
        params,
      );
      expect(res.status).toBe(200);
      expect(addAnnotation).not.toHaveBeenCalled();
    });

    it("skips an annotation whose deliverable belongs to another ticket", async () => {
      const res = await POST(
        req({
          action: "revise",
          note: "fix logo",
          annotations: [{ deliverableId: "elsewhere", shapes: RECT }],
        }),
        params,
      );
      expect(res.status).toBe(200);
      expect(addAnnotation).not.toHaveBeenCalled();
    });

    it("drops a malformed shape (missing coords) instead of persisting it", async () => {
      const res = await POST(
        req({
          action: "revise",
          note: "fix logo",
          annotations: [{ deliverableId: "d2", shapes: [{ type: "rect" }] }],
        }),
        params,
      );
      expect(res.status).toBe(200);
      expect(addAnnotation).not.toHaveBeenCalled();
    });

    it("drops a malformed shape (null entry) instead of persisting it", async () => {
      const res = await POST(
        req({
          action: "revise",
          note: "fix logo",
          annotations: [{ deliverableId: "d2", shapes: [null] }],
        }),
        params,
      );
      expect(res.status).toBe(200);
      expect(addAnnotation).not.toHaveBeenCalled();
    });

    it("keeps only the valid annotation in a mixed batch", async () => {
      const res = await POST(
        req({
          action: "revise",
          note: "fix logo",
          annotations: [
            { deliverableId: "d3", shapes: RECT, note: "keep" },
            { deliverableId: "d1", shapes: RECT, note: "drop — old round" },
          ],
        }),
        params,
      );
      expect(res.status).toBe(200);
      expect(addAnnotation).toHaveBeenCalledTimes(1);
      expect(addAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ deliverableId: "d3" }),
      );
    });

    it("ignores annotations entirely on approve", async () => {
      const res = await POST(
        req({
          action: "approve",
          annotations: [{ deliverableId: "d2", shapes: RECT }],
        }),
        params,
      );
      expect(res.status).toBe(200);
      expect(addAnnotation).not.toHaveBeenCalled();
    });

    it("still returns 200 when annotation persistence throws", async () => {
      addAnnotation.mockRejectedValue(new Error("db down"));
      const res = await POST(
        req({
          action: "revise",
          note: "fix logo",
          annotations: [{ deliverableId: "d2", shapes: RECT }],
        }),
        params,
      );
      expect(res.status).toBe(200);
    });
  });

  describe("notifications", () => {
    it("emails the design team on approve", async () => {
      const res = await POST(req({ action: "approve" }), params);
      expect(res.status).toBe(200);
      expect(sendTicketReviewTeamEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "approve",
          note: null,
          ticketNumber: 12,
          requesterName: "Jane Doe",
          requesterEmail: "jane@x.com",
        }),
      );
    });

    it("emails the design team on revise with the note", async () => {
      const res = await POST(
        req({ action: "revise", note: "fix logo" }),
        params,
      );
      expect(res.status).toBe(200);
      expect(sendTicketReviewTeamEmail).toHaveBeenCalledWith(
        expect.objectContaining({ action: "revise", note: "fix logo" }),
      );
    });

    it("sends the client a confirmation of their own verdict", async () => {
      const res = await POST(
        req({ action: "revise", note: "fix logo" }),
        params,
      );
      expect(res.status).toBe(200);
      expect(sendTicketReviewClientEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "owner@x.com",
          input: expect.objectContaining({
            action: "revise",
            note: "fix logo",
            version: 2,
          }),
        }),
      );
    });

    it("prefers the ticket's delivery email for the client confirmation", async () => {
      getDesignTicketById.mockResolvedValue({
        ...ticket,
        deliveryEmail: "studio@client.com",
      });
      await POST(req({ action: "approve" }), params);
      expect(sendTicketReviewClientEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "studio@client.com" }),
      );
    });

    it("still returns 200 when the team email rejects", async () => {
      sendTicketReviewTeamEmail.mockRejectedValue(new Error("smtp down"));
      const res = await POST(req({ action: "approve" }), params);
      expect(res.status).toBe(200);
    });

    it("still returns 200 when the client confirmation rejects", async () => {
      sendTicketReviewClientEmail.mockRejectedValue(new Error("smtp down"));
      const res = await POST(req({ action: "approve" }), params);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ticket).toBeDefined();
    });

    it("still applies the verdict when the staff lookup fails", async () => {
      getStaffUsers.mockRejectedValue(new Error("db down"));
      const res = await POST(req({ action: "approve" }), params);
      expect(res.status).toBe(200);
      expect(applyClientReview).toHaveBeenCalledWith(
        expect.objectContaining({ staffIds: [] }),
      );
    });
  });
});

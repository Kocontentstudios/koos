import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const checkBrandAccess = vi.fn();
const updateCalendarItemStatus = vi.fn();
const updateDesignTicket = vi.fn();
const sendTicketReviewTeamEmail = vi.fn();
const getDeliverables = vi.fn();
const addAnnotation = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  updateCalendarItemStatus: (id: string, s: unknown) =>
    updateCalendarItemStatus(id, s),
  updateDesignTicket: (id: string, p: unknown) => updateDesignTicket(id, p),
  getDeliverables: (ticketId: string) => getDeliverables(ticketId),
  addAnnotation: (data: unknown) => addAnnotation(data),
}));
vi.mock("@/lib/design/notify", () => ({
  appUrl: (p: string) => `https://app${p}`,
  sendTicketReviewTeamEmail: (a: unknown) => sendTicketReviewTeamEmail(a),
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
  notes: null,
};

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "t1" }) };

describe("customer review route emails", () => {
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
    updateDesignTicket.mockResolvedValue({ ...ticket, status: "delivered" });
    getDeliverables.mockResolvedValue([
      { id: "d1", ticketId: "t1" },
      { id: "d2", ticketId: "t1" },
    ]);
    addAnnotation.mockResolvedValue({ id: "a1" });
  });

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
    const res = await POST(req({ action: "revise", note: "fix logo" }), params);
    expect(res.status).toBe(200);
    expect(sendTicketReviewTeamEmail).toHaveBeenCalledWith(
      expect.objectContaining({ action: "revise", note: "fix logo" }),
    );
  });

  it("still returns 200 when the email helper rejects", async () => {
    sendTicketReviewTeamEmail.mockRejectedValue(new Error("smtp down"));
    const res = await POST(req({ action: "approve" }), params);
    expect(res.status).toBe(200);
  });

  it("persists an annotation for a deliverable belonging to the ticket on revise", async () => {
    const shapes = [{ type: "rect", coords: [1, 2, 3, 4], color: "#f00" }];
    const res = await POST(
      req({
        action: "revise",
        note: "fix logo",
        annotations: [{ deliverableId: "d1", shapes, note: "move left" }],
      }),
      params,
    );
    expect(res.status).toBe(200);
    expect(updateDesignTicket).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ status: "revision_requested" }),
    );
    expect(addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "t1",
        deliverableId: "d1",
        authorId: "u1",
        shapes,
        note: "move left",
      }),
    );
  });

  it("skips an annotation whose deliverable does not belong to the ticket", async () => {
    const res = await POST(
      req({
        action: "revise",
        annotations: [
          { deliverableId: "other-ticket-deliverable", shapes: [] },
        ],
      }),
      params,
    );
    expect(res.status).toBe(200);
    expect(addAnnotation).not.toHaveBeenCalled();
  });
});

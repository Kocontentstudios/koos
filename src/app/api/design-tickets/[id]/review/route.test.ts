import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const getBrandById = vi.fn();
const updateCalendarItemStatus = vi.fn();
const updateDesignTicket = vi.fn();
const sendTicketReviewTeamEmail = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  getBrandById: (id: string) => getBrandById(id),
  updateCalendarItemStatus: (id: string, s: unknown) =>
    updateCalendarItemStatus(id, s),
  updateDesignTicket: (id: string, p: unknown) => updateDesignTicket(id, p),
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
    getBrandById.mockResolvedValue({ id: "b1", userId: "u1" });
    updateCalendarItemStatus.mockResolvedValue({});
    updateDesignTicket.mockResolvedValue({ ...ticket, status: "delivered" });
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
});

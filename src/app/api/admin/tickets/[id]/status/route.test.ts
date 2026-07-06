import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const getUserById = vi.fn();
const updateDesignTicket = vi.fn();
const sendTicketStatusEmail = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  getUserById: (id: string) => getUserById(id),
  updateDesignTicket: (id: string, p: unknown) => updateDesignTicket(id, p),
}));
vi.mock("@/lib/design/notify", () => ({
  appUrl: (p: string) => `https://app${p}`,
  sendTicketStatusEmail: (a: unknown) => sendTicketStatusEmail(a),
}));

import { POST } from "./route";

const ticket = {
  id: "t1",
  userId: "u1",
  ticketNumber: 12,
  designType: "Flyer",
  status: "submitted",
  deliveryEmail: null,
};

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "t1" }) };

describe("designer status route emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "d1", role: "designer" } });
    getDesignTicketById.mockResolvedValue(ticket);
    getUserById.mockResolvedValue({ id: "u1", email: "owner@x.com" });
    updateDesignTicket.mockResolvedValue({ ...ticket, status: "in_progress" });
  });

  it("emails the owner when the designer sets a new status", async () => {
    const res = await POST(req({ status: "in_progress" }), params);
    expect(res.status).toBe(200);
    expect(sendTicketStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@x.com",
        input: expect.objectContaining({
          status: "in_progress",
          ticketNumber: 12,
        }),
      }),
    );
  });

  it("emails with status 'assigned' when the designer claims the ticket", async () => {
    const res = await POST(req({ claim: true }), params);
    expect(res.status).toBe(200);
    expect(sendTicketStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ status: "assigned" }),
      }),
    );
  });

  it("does not email when the new status equals the current status", async () => {
    getDesignTicketById.mockResolvedValue({ ...ticket, status: "in_progress" });
    await POST(req({ status: "in_progress" }), params);
    expect(sendTicketStatusEmail).not.toHaveBeenCalled();
  });

  it("still returns 200 when the email helper rejects", async () => {
    sendTicketStatusEmail.mockRejectedValue(new Error("smtp down"));
    const res = await POST(req({ status: "in_progress" }), params);
    expect(res.status).toBe(200);
  });
});

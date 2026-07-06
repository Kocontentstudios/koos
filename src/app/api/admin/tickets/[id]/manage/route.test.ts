import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const getUserById = vi.fn();
const updateDesignTicket = vi.fn();
const createNotification = vi.fn();
const sendTicketStatusEmail = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  getUserById: (id: string) => getUserById(id),
  updateDesignTicket: (id: string, p: unknown) => updateDesignTicket(id, p),
  createNotification: (n: unknown) => createNotification(n),
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

describe("admin manage route emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "a1", role: "admin" } });
    getDesignTicketById.mockResolvedValue(ticket);
    getUserById.mockResolvedValue({ id: "u1", email: "owner@x.com" });
    updateDesignTicket.mockResolvedValue({ ...ticket, status: "assigned" });
    createNotification.mockResolvedValue({});
  });

  it("emails the requester on a status change", async () => {
    const res = await POST(req({ status: "assigned" }), params);
    expect(res.status).toBe(200);
    expect(sendTicketStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@x.com",
        input: expect.objectContaining({
          status: "assigned",
          ticketNumber: 12,
        }),
      }),
    );
  });

  it("prefers the ticket deliveryEmail", async () => {
    getDesignTicketById.mockResolvedValue({
      ...ticket,
      deliveryEmail: "inbox@x.com",
    });
    await POST(req({ status: "assigned" }), params);
    expect(sendTicketStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "inbox@x.com" }),
    );
  });

  it("does not email when status is unchanged", async () => {
    await POST(req({ priority: "high" }), params);
    expect(sendTicketStatusEmail).not.toHaveBeenCalled();
  });

  it("still returns 200 when the email helper rejects", async () => {
    sendTicketStatusEmail.mockRejectedValue(new Error("smtp down"));
    const res = await POST(req({ status: "assigned" }), params);
    expect(res.status).toBe(200);
  });
});

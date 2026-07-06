import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const getUserById = vi.fn();
const postTicketProgressUpdate = vi.fn();
const sendTicketProgressEmail = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  getUserById: (id: string) => getUserById(id),
  postTicketProgressUpdate: (p: unknown) => postTicketProgressUpdate(p),
}));
vi.mock("@/lib/design/notify", () => ({
  appUrl: (p: string) => `https://app${p}`,
  sendTicketProgressEmail: (a: unknown) => sendTicketProgressEmail(a),
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

describe("admin updates route emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "d1", role: "designer" } });
    getDesignTicketById.mockResolvedValue(ticket);
    getUserById.mockResolvedValue({ id: "u1", email: "owner@x.com" });
    postTicketProgressUpdate.mockResolvedValue({});
  });

  it("emails the requester with the progress message", async () => {
    const res = await POST(
      req({ message: "Working on it", status: "in_progress" }),
      params,
    );
    expect(res.status).toBe(200);
    expect(sendTicketProgressEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@x.com",
        input: expect.objectContaining({
          message: "Working on it",
          status: "in_progress",
        }),
      }),
    );
  });

  it("still emails when status is omitted", async () => {
    const res = await POST(req({ message: "Just checking in" }), params);
    expect(res.status).toBe(200);
    expect(sendTicketProgressEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ status: null }),
      }),
    );
  });

  it("still returns 200 when the email helper rejects", async () => {
    sendTicketProgressEmail.mockRejectedValue(new Error("smtp down"));
    const res = await POST(req({ message: "Working on it" }), params);
    expect(res.status).toBe(200);
  });

  it("still returns 200 when getUserById fails (email skipped)", async () => {
    getUserById.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ message: "Working on it" }), params);
    expect(res.status).toBe(200);
    expect(sendTicketProgressEmail).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const getUserById = vi.fn();
const getBrandById = vi.fn();
const createNotification = vi.fn();
const getNotifications = vi.fn();
const sendTicketReminderEmail = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  getUserById: (id: string) => getUserById(id),
  getBrandById: (id: string) => getBrandById(id),
  createNotification: (d: unknown) => createNotification(d),
  getNotifications: (u: string, l?: number) => getNotifications(u, l),
}));
vi.mock("@/lib/design/notify", () => ({
  appUrl: (p: string) => `https://app${p}`,
  sendTicketReminderEmail: (a: unknown) => sendTicketReminderEmail(a),
}));

import { POST } from "./route";

const NOW = new Date("2026-09-04T12:00:00Z");

const ticket = {
  id: "t1",
  ticketNumber: 12,
  designType: "Flyer",
  brandId: "b1",
  assignedDesignerId: "d1",
  dueDate: new Date("2026-09-01T12:00:00Z"),
  approvedAt: null,
  status: "in_progress",
};

function call(id = "t1") {
  return POST(new Request("http://x", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(NOW);
  getAuthUser.mockResolvedValue({ dbUser: { id: "a1", role: "admin" } });
  getDesignTicketById.mockResolvedValue(ticket);
  getUserById.mockResolvedValue({ id: "d1", email: "designer@koos.test" });
  getBrandById.mockResolvedValue({ id: "b1", name: "Acme" });
  createNotification.mockResolvedValue({ id: "n1" });
  getNotifications.mockResolvedValue([]);
  sendTicketReminderEmail.mockResolvedValue(undefined);
});

describe("POST /api/admin/tickets/[id]/remind", () => {
  it("refuses anyone who is not staff", async () => {
    getAuthUser.mockResolvedValue({ dbUser: { id: "u9", role: "member" } });
    expect((await call()).status).toBe(403);
    expect(sendTicketReminderEmail).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("404s an unknown ticket", async () => {
    getDesignTicketById.mockResolvedValue(null);
    expect((await call("nope")).status).toBe(404);
  });

  /* Both halves, deliberately: the email is what reaches someone not in the
     app, the notification is what survives a bounced or blocked send. */
  it("sends the email and records the notification", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(sendTicketReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "designer@koos.test" }),
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "d1", type: "ticket_status" }),
    );
  });

  it("tells the designer how late it is, not just when it was due", async () => {
    await call();
    const arg = sendTicketReminderEmail.mock.calls[0][0] as {
      input: { overdueFor: string | null };
    };
    expect(arg.input.overdueFor).toBe("3 days");
  });

  /* A ticket nobody is carrying has no one to remind — silently doing nothing
     would read as success. */
  it("refuses when the ticket is unassigned", async () => {
    getDesignTicketById.mockResolvedValue({
      ...ticket,
      assignedDesignerId: null,
    });
    const res = await call();
    expect(res.status).toBe(409);
    expect(sendTicketReminderEmail).not.toHaveBeenCalled();
  });

  /* The email path already swallows its own errors; the notification is the
     durable half, so the action still reports success. */
  it("still records the notification when the email fails", async () => {
    sendTicketReminderEmail.mockRejectedValue(new Error("smtp down"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(createNotification).toHaveBeenCalled();
  });

  /* An operator clicking twice should not send twice; the guard is the
     notification the first click wrote. */
  it("does not send a second reminder within the cooling-off window", async () => {
    /* Read back from the notification the first click wrote — module state
       would not survive a second serverless instance. */
    getNotifications.mockResolvedValue([
      {
        type: "ticket_status",
        payload: { reminder: true, ticketId: "t1" },
        createdAt: new Date(NOW.getTime() - 60_000),
      },
    ]);
    const res = await call();
    expect(res.status).toBe(429);
    expect(sendTicketReminderEmail).not.toHaveBeenCalled();
  });
});

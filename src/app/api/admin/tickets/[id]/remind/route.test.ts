import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const getUserById = vi.fn();
const getBrandById = vi.fn();
const createNotification = vi.fn();
const releaseRateLimit = vi.fn();
const checkRateLimit = vi.fn();
const sendTicketReminderEmail = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  getUserById: (id: string) => getUserById(id),
  getBrandById: (id: string) => getBrandById(id),
  createNotification: (d: unknown) => createNotification(d),
  releaseRateLimit: (k: string) => releaseRateLimit(k),
}));
vi.mock("@/lib/rate-limit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/rate-limit")>(
      "@/lib/rate-limit",
    );
  return {
    ...actual,
    checkRateLimit: (p: unknown) => checkRateLimit(p),
  };
});
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
  releaseRateLimit.mockResolvedValue(undefined);
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
  sendTicketReminderEmail.mockResolvedValue(undefined);
});

describe("POST /api/admin/tickets/[id]/remind", () => {
  it("refuses anyone who is not staff", async () => {
    getAuthUser.mockResolvedValue({ dbUser: { id: "u9", role: "member" } });
    expect((await call()).status).toBe(403);
    expect(sendTicketReminderEmail).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  /* Both staff roles, deliberately. Reassignment is admin-only because it
     rewrites who owns the work; a nudge is not, and a designer working the
     queue is the person most likely to send one. */
  it.each(["admin", "designer"])("allows a %s", async (role) => {
    getAuthUser.mockResolvedValue({ dbUser: { id: "s1", role } });
    expect((await call()).status).toBe(200);
    expect(createNotification).toHaveBeenCalled();
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

  /* The notification is the durable half and is written first, so a mail
     outage still leaves the designer something to see in the product.
     sendTicketReminderEmail's "never throws" contract is what makes the
     unguarded await safe — see notify.test.ts, which pins it. */
  it("records the notification before attempting the email", async () => {
    const order: string[] = [];
    createNotification.mockImplementation(async () => {
      order.push("notification");
    });
    sendTicketReminderEmail.mockImplementation(async () => {
      order.push("email");
    });
    await call();
    expect(order).toEqual(["notification", "email"]);
  });

  it("formats the due date the way the rest of the product does", async () => {
    await call();
    const arg = sendTicketReminderEmail.mock.calls[0][0] as {
      input: { dueDate: string | null };
    };
    // Not toDateString()'s "Tue Sep 01 2026".
    expect(arg.input.dueDate).toBe("Sep 1, 2026");
  });
});

/* An operator clicking twice should not send twice — and neither should two
   operators, or two tabs. */
describe("the cooling-off guard", () => {
  it("is keyed on the ticket, so one nudge never suppresses another", async () => {
    await call();
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "ticket-remind:t1", limit: 1 }),
    );
  });

  it("holds for six hours", async () => {
    await call();
    const policy = checkRateLimit.mock.calls[0][0] as {
      windowSeconds: number;
    };
    expect(policy.windowSeconds).toBe(6 * 60 * 60);
  });

  it("refuses a second reminder inside the window", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 1800 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(sendTicketReminderEmail).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  /* A bare 429 leaves the UI guessing. The client is told when to come back. */
  it("says how long to wait", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 1800 });
    const res = await call();
    expect(res.headers.get("Retry-After")).toBe("1800");
  });

  /* Rounded UP. 30 minutes left floors to "in 0 hours", which reads as "try
     again now" and is the opposite of what the limiter will do. */
  it("never tells the operator to retry in zero hours", async () => {
    for (const retryAfterSeconds of [1, 60, 1800, 3599]) {
      checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds });
      const body = (await (await call()).json()) as { error: string };
      expect(body.error).toContain("in 1 hour.");
      expect(body.error).not.toContain("in 0 hour");
    }
  });

  it("counts the remaining hours up, not down", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 3601 });
    const body = (await (await call()).json()) as { error: string };
    expect(body.error).toContain("in 2 hours.");
  });
});

/* The gate the row renders, enforced again server-side. A client-side gate is
   a UI convenience: a POST straight at the route bypasses it entirely. */
describe("the status gate", () => {
  it.each([
    ["draft", /unsubmitted draft/i],
    ["delivered", /signed off/i],
    ["ready_for_review", /with the client/i],
  ])("refuses a %s ticket and says why", async (status, expected) => {
    getDesignTicketById.mockResolvedValue({ ...ticket, status });
    const res = await call();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(expected);
    expect(sendTicketReminderEmail).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  /* Status is checked before assignment: "assign it first" is advice that
     would not help on a draft, because assigning still leaves nothing to do. */
  it("explains an unassigned draft by its status, not its assignment", async () => {
    getDesignTicketById.mockResolvedValue({
      ...ticket,
      status: "draft",
      assignedDesignerId: null,
    });
    const body = (await (await call()).json()) as { error: string };
    expect(body.error).toMatch(/unsubmitted draft/i);
    expect(body.error).not.toMatch(/assign the ticket/i);
  });

  it("does not burn the cooling-off window on a refused status", async () => {
    getDesignTicketById.mockResolvedValue({ ...ticket, status: "draft" });
    await call();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  /* The lateness string becomes an email SUBJECT. Computing it with raw
     arithmetic told a designer their finished ticket was nine days overdue. */
  it("never claims lateness for a status that cannot be overdue", async () => {
    getDesignTicketById.mockResolvedValue({
      ...ticket,
      status: "revision_requested",
      dueDate: new Date("2026-08-26T12:00:00Z"),
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(
      (
        sendTicketReminderEmail.mock.calls[0][0] as {
          input: { overdueFor: string };
        }
      ).input.overdueFor,
    ).toBe("9 days");
  });

  /* Checked BEFORE anything is written, or a rejected second click still
     leaves a notification behind. */
  it("runs before the ticket is touched", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 10 });
    await call();
    expect(createNotification).not.toHaveBeenCalled();
  });

  /* The window is reserved BEFORE the write it protects, so a failed write has
     to hand it back — otherwise the failure silently blocks every retry for six
     hours behind a message claiming the reminder already went out. */
  it("hands the window back when the notification cannot be written", async () => {
    createNotification.mockRejectedValue(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(releaseRateLimit).toHaveBeenCalledWith("ticket-remind:t1");
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("Nothing was sent"),
    });
  });

  it("does not release the window on a successful send", async () => {
    await call();
    expect(releaseRateLimit).not.toHaveBeenCalled();
  });

  /* A failed release must not turn a reported failure into a crash. */
  it("survives the release itself failing", async () => {
    createNotification.mockRejectedValue(new Error("db down"));
    releaseRateLimit.mockRejectedValue(new Error("still down"));
    expect((await call()).status).toBe(500);
  });

  /* An unassigned ticket is refused before the limiter, so a misdirected click
     never burns the window for a nudge that would have been valid. */
  it("does not consume the window on an unassigned ticket", async () => {
    getDesignTicketById.mockResolvedValue({
      ...ticket,
      assignedDesignerId: null,
    });
    await call();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

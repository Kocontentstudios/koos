import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();

vi.mock("@/lib/email", () => ({
  sendMail: (args: unknown) => sendMail(args),
}));

// notify.ts pulls in the query barrel, which refuses to load without a DB URL.
vi.mock("@/lib/db/client", () => ({ db: {} }));

import { sendTicketReminderEmail } from "./notify";

const input = {
  ticketNumber: 12,
  designType: "Flyer",
  brandName: "Acme",
  overdueFor: "3 days",
  dueDate: "Sep 1, 2026",
  ticketUrl: "https://app/admin/tickets/t1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/* The remind route awaits this without a catch, on the strength of the
   "Never throws" contract in its docstring. That contract is load-bearing: if
   it ever breaks, an SMTP outage turns a nudge into a 500. This is the test
   that makes the promise real rather than a comment. */
describe("sendTicketReminderEmail never throws", () => {
  it("resolves when the transport rejects", async () => {
    sendMail.mockRejectedValue(new Error("smtp down"));
    await expect(
      sendTicketReminderEmail({ to: "d@koos.test", input }),
    ).resolves.toBeUndefined();
  });

  it("resolves when the transport throws synchronously", async () => {
    sendMail.mockImplementation(() => {
      throw new Error("no transport configured");
    });
    await expect(
      sendTicketReminderEmail({ to: "d@koos.test", input }),
    ).resolves.toBeUndefined();
  });

  it("logs the failure rather than swallowing it silently", async () => {
    sendMail.mockRejectedValue(new Error("smtp down"));
    await sendTicketReminderEmail({ to: "d@koos.test", input });
    expect(console.error).toHaveBeenCalledWith(
      "ticket reminder email failed",
      expect.objectContaining({ ticketNumber: 12, to: "d@koos.test" }),
    );
  });

  it("sends to the address it was given on the happy path", async () => {
    sendMail.mockResolvedValue(undefined);
    await sendTicketReminderEmail({ to: "d@koos.test", input });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "d@koos.test" }),
    );
  });
});

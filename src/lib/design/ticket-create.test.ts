import { describe, expect, it, vi } from "vitest";
import { createTicketFromRequest } from "./ticket-create";

// Prevent the module's default-dependency imports from requiring a live DB
// connection; every test below injects its own deps.
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/email", () => ({ sendMail: vi.fn() }));

describe("createTicketFromRequest", () => {
  it("creates a ticket and records usage; email failure does not throw", async () => {
    const createDesignTicket = vi
      .fn()
      .mockResolvedValue({ id: "t1", ticketNumber: 5, designType: "Logo" });
    const recordUsageEvent = vi.fn().mockResolvedValue(undefined);
    const sendEmails = vi.fn().mockRejectedValue(new Error("smtp down"));
    const res = await createTicketFromRequest(
      {
        brandId: "b1",
        userId: "u1",
        designType: "Logo",
        brief: "clean wordmark",
      },
      {
        createDesignTicket,
        recordUsageEvent,
        sendEmails,
        brandName: "Acme",
        requesterName: "A B",
        requesterEmail: "a@b.co",
      },
    );
    expect(res.ticket.id).toBe("t1");
    expect(createDesignTicket).toHaveBeenCalledOnce();
    expect(recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "design_ticket_created" }),
    );
  });

  it("links the ticket back to the design brief when briefId is set", async () => {
    const createDesignTicket = vi
      .fn()
      .mockResolvedValue({ id: "t2", ticketNumber: 6, designType: "Logo" });
    const recordUsageEvent = vi.fn().mockResolvedValue(undefined);
    const sendEmails = vi.fn().mockResolvedValue(undefined);
    const updateDesignBrief = vi.fn().mockResolvedValue(undefined);
    await createTicketFromRequest(
      {
        brandId: "b1",
        userId: "u1",
        designType: "Logo",
        brief: "clean wordmark",
        briefId: "brief1",
      },
      {
        createDesignTicket,
        recordUsageEvent,
        sendEmails,
        updateDesignBrief,
        brandName: "Acme",
        requesterName: "A B",
        requesterEmail: "a@b.co",
      },
    );
    expect(updateDesignBrief).toHaveBeenCalledWith("brief1", {
      ticketId: "t2",
    });
  });

  it("does not throw when the back-link update fails", async () => {
    const createDesignTicket = vi
      .fn()
      .mockResolvedValue({ id: "t3", ticketNumber: 7, designType: "Logo" });
    const recordUsageEvent = vi.fn().mockResolvedValue(undefined);
    const sendEmails = vi.fn().mockResolvedValue(undefined);
    const updateDesignBrief = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(
      createTicketFromRequest(
        {
          brandId: "b1",
          userId: "u1",
          designType: "Logo",
          brief: "clean wordmark",
          briefId: "brief1",
        },
        {
          createDesignTicket,
          recordUsageEvent,
          sendEmails,
          updateDesignBrief,
          brandName: "Acme",
          requesterName: "A B",
          requesterEmail: "a@b.co",
        },
      ),
    ).resolves.toEqual({
      ticket: { id: "t3", ticketNumber: 7, designType: "Logo" },
    });
  });

  it("skips the back-link update when no briefId is given", async () => {
    const createDesignTicket = vi
      .fn()
      .mockResolvedValue({ id: "t4", ticketNumber: 8, designType: "Logo" });
    const recordUsageEvent = vi.fn().mockResolvedValue(undefined);
    const sendEmails = vi.fn().mockResolvedValue(undefined);
    const updateDesignBrief = vi.fn().mockResolvedValue(undefined);
    await createTicketFromRequest(
      {
        brandId: "b1",
        userId: "u1",
        designType: "Logo",
        brief: "clean wordmark",
      },
      {
        createDesignTicket,
        recordUsageEvent,
        sendEmails,
        updateDesignBrief,
        brandName: "Acme",
        requesterName: "A B",
        requesterEmail: "a@b.co",
      },
    );
    expect(updateDesignBrief).not.toHaveBeenCalled();
  });
});

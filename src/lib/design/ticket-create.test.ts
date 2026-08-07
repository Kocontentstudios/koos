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

  it("creates a draft without emails or usage events", async () => {
    const createDesignTicket = vi
      .fn()
      .mockResolvedValue({ id: "t5", ticketNumber: 9, designType: "Flyer" });
    const recordUsageEvent = vi.fn().mockResolvedValue(undefined);
    const sendEmails = vi.fn().mockResolvedValue(undefined);
    await createTicketFromRequest(
      {
        brandId: "b1",
        userId: "u1",
        designType: "Flyer",
        brief: "wip brief",
        title: "WIP",
        saveAsDraft: true,
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
    expect(createDesignTicket).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft", title: "WIP" }),
    );
    expect(recordUsageEvent).not.toHaveBeenCalled();
    expect(sendEmails).not.toHaveBeenCalled();
  });

  it("passes title, priority, and specs through to the insert", async () => {
    const createDesignTicket = vi
      .fn()
      .mockResolvedValue({ id: "t6", ticketNumber: 10, designType: "Poster" });
    await createTicketFromRequest(
      {
        brandId: "b1",
        userId: "u1",
        designType: "Poster",
        brief: "gig poster",
        title: "Gig poster",
        priority: "urgent",
        specs: { platform: "Print", orientation: "portrait" },
      },
      {
        createDesignTicket,
        recordUsageEvent: vi.fn().mockResolvedValue(undefined),
        sendEmails: vi.fn().mockResolvedValue(undefined),
        brandName: "Acme",
        requesterName: "A B",
        requesterEmail: "a@b.co",
      },
    );
    expect(createDesignTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "submitted",
        title: "Gig poster",
        priority: "urgent",
        specs: { platform: "Print", orientation: "portrait" },
      }),
    );
  });

  it("persists attachments after ticket creation", async () => {
    const addAttachments = vi.fn().mockResolvedValue([]);
    await createTicketFromRequest(
      {
        brandId: "b1",
        userId: "u1",
        designType: "Flyer",
        brief: "flyer",
        attachments: [
          {
            kind: "file",
            key: "reference-images/u1/a.png",
            fileName: "a.png",
            mimeType: "image/png",
            sizeBytes: 1,
            category: "asset",
          },
          {
            kind: "link",
            url: "https://figma.com/f",
            category: "reference",
            note: "grid",
          },
        ],
      },
      {
        createDesignTicket: vi.fn().mockResolvedValue({
          id: "t7",
          ticketNumber: 11,
          designType: "Flyer",
        }),
        recordUsageEvent: vi.fn().mockResolvedValue(undefined),
        sendEmails: vi.fn().mockResolvedValue(undefined),
        addAttachments,
        brandName: "Acme",
        requesterName: "A B",
        requesterEmail: "a@b.co",
      },
    );
    expect(addAttachments).toHaveBeenCalledWith([
      expect.objectContaining({
        ticketId: "t7",
        kind: "file",
        fileKey: "reference-images/u1/a.png",
        fileName: "a.png",
        category: "asset",
      }),
      expect.objectContaining({
        ticketId: "t7",
        kind: "link",
        url: "https://figma.com/f",
        category: "reference",
        note: "grid",
      }),
    ]);
  });
});

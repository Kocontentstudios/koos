import { describe, expect, it } from "vitest";
import {
  defaultDueDate,
  formatNotificationMessage,
  humanizePriority,
  humanizeStatus,
  isCarouselType,
  matchesTicketFilter,
  priorityRank,
} from "./tickets-ui";

describe("matchesTicketFilter", () => {
  it("'all' matches every status", () => {
    expect(matchesTicketFilter("submitted", "all")).toBe(true);
    expect(matchesTicketFilter("delivered", "all")).toBe(true);
    expect(matchesTicketFilter("revision_requested", "all")).toBe(true);
  });

  it("'submitted' only matches submitted", () => {
    expect(matchesTicketFilter("submitted", "submitted")).toBe(true);
    expect(matchesTicketFilter("assigned", "submitted")).toBe(false);
  });

  it("'in_progress' groups assigned/in_progress/ready_for_review/revision_requested", () => {
    expect(matchesTicketFilter("assigned", "in_progress")).toBe(true);
    expect(matchesTicketFilter("in_progress", "in_progress")).toBe(true);
    expect(matchesTicketFilter("ready_for_review", "in_progress")).toBe(true);
    expect(matchesTicketFilter("revision_requested", "in_progress")).toBe(true);
    expect(matchesTicketFilter("submitted", "in_progress")).toBe(false);
    expect(matchesTicketFilter("delivered", "in_progress")).toBe(false);
  });

  it("'delivered' only matches delivered", () => {
    expect(matchesTicketFilter("delivered", "delivered")).toBe(true);
    expect(matchesTicketFilter("ready_for_review", "delivered")).toBe(false);
  });
});

describe("defaultDueDate", () => {
  it("returns 2 days before the item date as YYYY-MM-DD", () => {
    expect(defaultDueDate(new Date("2026-06-18T00:00:00Z"))).toBe("2026-06-16");
  });

  it("handles month boundaries", () => {
    expect(defaultDueDate(new Date("2026-07-01T12:00:00Z"))).toBe("2026-06-29");
  });
});

describe("isCarouselType", () => {
  it("detects carousel types case-insensitively", () => {
    expect(isCarouselType("Instagram Carousel")).toBe(true);
    expect(isCarouselType("linkedin carousel")).toBe(true);
  });

  it("is false for non-carousel/empty", () => {
    expect(isCarouselType("Instagram Post")).toBe(false);
    expect(isCarouselType(null)).toBe(false);
    expect(isCarouselType(undefined)).toBe(false);
  });
});

describe("formatNotificationMessage", () => {
  it("formats a design_ready notification with design type", () => {
    expect(
      formatNotificationMessage({
        type: "design_ready",
        payload: { designType: "Instagram Post" },
      }),
    ).toBe("Your design is ready for review (Instagram Post).");
  });

  it("formats design_ready without a design type", () => {
    expect(
      formatNotificationMessage({ type: "design_ready", payload: {} }),
    ).toBe("Your design is ready for review.");
  });

  it("formats a ticket_status notification", () => {
    expect(
      formatNotificationMessage({
        type: "ticket_status",
        payload: { status: "in_progress" },
      }),
    ).toBe("Your design ticket is now In Progress.");
  });

  it("falls back for system + null payload", () => {
    expect(formatNotificationMessage({ type: "system", payload: null })).toBe(
      "You have a new notification.",
    );
  });
});

describe("formatNotificationMessage — ticket_status", () => {
  it("shows the free-text message when present", () => {
    expect(
      formatNotificationMessage({
        type: "ticket_status",
        payload: {
          message: "Started on your carousel — first draft tomorrow.",
        },
      }),
    ).toBe("Started on your carousel — first draft tomorrow.");
  });
  it("falls back to the status sentence when no message", () => {
    expect(
      formatNotificationMessage({
        type: "ticket_status",
        payload: { status: "in_progress" },
      }),
    ).toBe("Your design ticket is now In Progress.");
  });
});

describe("humanizeStatus", () => {
  it("maps statuses to labels", () => {
    expect(humanizeStatus("ready_for_review")).toBe("Ready for Review");
    expect(humanizeStatus("revision_requested")).toBe("Revision Requested");
  });
});

describe("priority helpers", () => {
  it("humanizes each priority", () => {
    expect(humanizePriority("urgent")).toBe("Urgent");
    expect(humanizePriority("normal")).toBe("Normal");
  });
  it("ranks urgent highest (lowest number) for ascending sort", () => {
    const order = (["low", "urgent", "normal", "high"] as const)
      .slice()
      .sort((a, b) => priorityRank(a) - priorityRank(b));
    expect(order).toEqual(["urgent", "high", "normal", "low"]);
  });
});

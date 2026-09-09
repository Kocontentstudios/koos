import { describe, expect, it } from "vitest";
import { notificationHref } from "@/lib/notifications/links";

const TICKET = "11111111-2222-3333-4444-555555555555";
const CALENDAR = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("notificationHref", () => {
  describe("ticket notifications", () => {
    it("sends an owner to the dashboard ticket page", () => {
      expect(
        notificationHref("design_ready", { ticketId: TICKET }, "user"),
      ).toBe(`/design-request/${TICKET}`);
    });

    it.each(["admin", "designer"] as const)(
      "sends %s to the admin ticket page",
      (role) => {
        expect(
          notificationHref("design_ready", { ticketId: TICKET }, role),
        ).toBe(`/admin/tickets/${TICKET}`);
      },
    );

    it("routes ticket_status by viewer role too", () => {
      // applyClientReview fans this type out to staff, the manage route sends
      // it to the owner. Same type, two destinations.
      expect(
        notificationHref("ticket_status", { ticketId: TICKET }, "user"),
      ).toBe(`/design-request/${TICKET}`);
      expect(
        notificationHref("ticket_status", { ticketId: TICKET }, "admin"),
      ).toBe(`/admin/tickets/${TICKET}`);
    });

    it("ignores the other payload keys when building the link", () => {
      expect(
        notificationHref(
          "design_ready",
          {
            ticketId: TICKET,
            ticketNumber: 42,
            designType: "flyer",
            version: 3,
          },
          "user",
        ),
      ).toBe(`/design-request/${TICKET}`);
    });

    it("returns null when the ticket id is missing or blank", () => {
      expect(notificationHref("design_ready", {}, "user")).toBeNull();
      expect(
        notificationHref("ticket_status", { ticketId: "" }, "user"),
      ).toBeNull();
      expect(
        notificationHref("ticket_status", { ticketId: "   " }, "user"),
      ).toBeNull();
      expect(
        notificationHref("design_ready", { ticketId: 7 }, "user"),
      ).toBeNull();
    });
  });

  describe("system notifications", () => {
    it("links a calendar_ready notification to that calendar", () => {
      expect(
        notificationHref(
          "system",
          { kind: "calendar_ready", calendarId: CALENDAR },
          "user",
        ),
      ).toBe(`/calendar?calendarId=${CALENDAR}`);
    });

    it("does not vary by role", () => {
      const payload = { kind: "calendar_ready", calendarId: CALENDAR };
      expect(notificationHref("system", payload, "admin")).toBe(
        notificationHref("system", payload, "user"),
      );
    });

    it("returns null for a plain system message with no target", () => {
      expect(
        notificationHref(
          "system",
          { message: "Scheduled maintenance." },
          "user",
        ),
      ).toBeNull();
    });

    it("returns null when calendar_ready has no calendar id", () => {
      expect(
        notificationHref("system", { kind: "calendar_ready" }, "user"),
      ).toBeNull();
    });
  });

  describe("malformed payloads", () => {
    it.each([null, undefined, "a string", 42, []])(
      "returns null rather than throwing for %p",
      (payload) => {
        expect(notificationHref("design_ready", payload, "user")).toBeNull();
      },
    );
  });
});

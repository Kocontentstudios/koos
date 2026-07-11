/** Pure UI logic for design tickets: status grouping, filters, defaults,
 * and notification payload formatting. Kept framework-free so it's unit-tested. */

export type TicketStatus =
  | "submitted"
  | "assigned"
  | "in_progress"
  | "ready_for_review"
  | "delivered"
  | "revision_requested";

/** Filter tabs shown on the tickets list page. */
export type TicketFilter = "all" | "submitted" | "in_progress" | "delivered";

export const TICKET_FILTERS: TicketFilter[] = [
  "all",
  "submitted",
  "in_progress",
  "delivered",
];

const FILTER_LABELS: Record<TicketFilter, string> = {
  all: "All",
  submitted: "Submitted",
  in_progress: "In Progress",
  delivered: "Delivered",
};

export function ticketFilterLabel(filter: TicketFilter): string {
  return FILTER_LABELS[filter];
}

/** Does a ticket status belong to the given filter tab? */
export function matchesTicketFilter(
  status: TicketStatus,
  filter: TicketFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "submitted":
      return status === "submitted";
    case "in_progress":
      return (
        status === "assigned" ||
        status === "in_progress" ||
        status === "ready_for_review" ||
        status === "revision_requested"
      );
    case "delivered":
      return status === "delivered";
  }
}

/** Default due date for a request = 2 days before the calendar item date.
 * Returns a YYYY-MM-DD string suitable for a native date input (UTC-based). */
export function defaultDueDate(itemDate: Date): string {
  const due = new Date(itemDate.getTime());
  due.setUTCDate(due.getUTCDate() - 2);
  return due.toISOString().slice(0, 10);
}

/** Standard design-type options (from the design-request template), shared by
 * the request form and the AI design-brief generator. */
export const DESIGN_TYPE_OPTIONS = [
  "Instagram Carousel (1080x1080 per slide)",
  "Instagram Post (1080x1080)",
  "Instagram Story (1080x1920)",
  "Instagram Reel Cover (1080x1920)",
  "X/Twitter Post (1200x675)",
  "LinkedIn Post (1200x627)",
  "Blog Header (1200x630)",
  "Email Header (600x200)",
  "Banner Ad",
  "Other",
];

/** Carousel design types take a slide count; others don't. */
export function isCarouselType(designType: string | null | undefined): boolean {
  if (!designType) return false;
  return /carousel/i.test(designType);
}

interface NotificationPayload {
  ticketId?: string;
  designType?: string;
  count?: number;
  status?: string;
  message?: string;
}

interface NotificationLike {
  type: "design_ready" | "ticket_status" | "system";
  payload: unknown;
}

/** Turn a notification row into a short human message for the bell dropdown. */
export function formatNotificationMessage(n: NotificationLike): string {
  const payload = (n.payload ?? {}) as NotificationPayload;
  switch (n.type) {
    case "design_ready": {
      const type = payload.designType ? ` (${payload.designType})` : "";
      return `Your design is ready for review${type}.`;
    }
    case "ticket_status": {
      if (typeof payload.message === "string" && payload.message.trim()) {
        return payload.message;
      }
      const status = payload.status
        ? humanizeStatus(payload.status as TicketStatus)
        : "updated";
      return `Your design ticket is now ${status}.`;
    }
    case "system":
      return "You have a new notification.";
  }
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  submitted: "Submitted",
  assigned: "Assigned",
  in_progress: "In Progress",
  ready_for_review: "Ready for Review",
  delivered: "Delivered",
  revision_requested: "Revision Requested",
};

export function humanizeStatus(status: TicketStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export type TicketPriority = "low" | "normal" | "high" | "urgent";

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export function humanizePriority(p: TicketPriority): string {
  return PRIORITY_LABELS[p] ?? p;
}

const PRIORITY_RANK: Record<TicketPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Lower number = more urgent; sort ascending to surface urgent first. */
export function priorityRank(p: TicketPriority): number {
  return PRIORITY_RANK[p] ?? 99;
}

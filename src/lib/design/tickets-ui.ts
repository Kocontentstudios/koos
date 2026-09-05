/** Pure UI logic for design tickets: status grouping, filters, defaults,
 * and notification payload formatting. Kept framework-free so it's unit-tested. */

import { formatTicketNumber } from "@/lib/ticket-number";

export type TicketStatus =
  | "draft"
  | "submitted"
  | "assigned"
  | "in_progress"
  | "ready_for_review"
  | "delivered"
  | "revision_requested";

/** Filter tabs shown on the tickets list page. */
export type TicketFilter =
  | "all"
  | "draft"
  | "submitted"
  | "in_progress"
  | "needs_review"
  | "delivered";

export const TICKET_FILTERS: TicketFilter[] = [
  "all",
  "draft",
  "submitted",
  "in_progress",
  "needs_review",
  "delivered",
];

const FILTER_LABELS: Record<TicketFilter, string> = {
  all: "All",
  draft: "Drafts",
  submitted: "Submitted",
  in_progress: "In Progress",
  needs_review: "Needs Your Review",
  delivered: "Approved",
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
    case "draft":
      return status === "draft";
    case "submitted":
      return status === "submitted";
    case "in_progress":
      return (
        status === "assigned" ||
        status === "in_progress" ||
        status === "revision_requested"
      );
    case "needs_review":
      return status === "ready_for_review";
    case "delivered":
      return status === "delivered";
  }
}

/** Tickets where a design has landed and the client owes a verdict. */
export function needsClientReview(status: TicketStatus): boolean {
  return status === "ready_for_review";
}

/** Default due date for a request = 2 days before the calendar item date.
 * Returns a YYYY-MM-DD string suitable for a native date input (UTC-based). */
export function defaultDueDate(itemDate: Date): string {
  const due = new Date(itemDate.getTime());
  due.setUTCDate(due.getUTCDate() - 2);
  return due.toISOString().slice(0, 10);
}

/** Request-type options from the design-request workflow spec, shared by the
 * request form, chat design mode, and the AI design-brief generator. */
export const DESIGN_TYPE_OPTIONS = [
  "Social Media Post",
  "Carousel",
  "Flyer",
  "Poster",
  "Banner",
  "Presentation",
  "Logo",
  "Brand Identity",
  "Business Card",
  "Packaging",
  "Video Thumbnail",
  "Video Editing",
  "Motion Graphics",
  "UI/UX Design",
  "Website Design",
  "Custom Request",
];

/** Carousel design types take a slide count; others don't. */
export function isCarouselType(designType: string | null | undefined): boolean {
  if (!designType) return false;
  return /carousel/i.test(designType);
}

interface NotificationPayload {
  ticketId?: string;
  ticketNumber?: number;
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
      // Revision requests are also sent to staff, who need to identify the
      // ticket at a glance rather than assume it's "their" ticket.
      if (payload.status === "revision_requested" && payload.ticketNumber) {
        return `Design ticket ${formatTicketNumber(payload.ticketNumber)} needs revision.`;
      }
      const status = payload.status
        ? humanizeStatus(payload.status as TicketStatus)
        : "updated";
      return `Your design ticket is now ${status}.`;
    }
    case "system":
      if (typeof payload.message === "string" && payload.message.trim()) {
        return payload.message;
      }
      return "You have a new notification.";
  }
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  assigned: "Assigned",
  in_progress: "In Progress",
  ready_for_review: "Delivered — Your Review",
  delivered: "Approved",
  revision_requested: "Revision Requested",
};

/* Runtime companion to the TicketStatus union, derived from the label map so
   it cannot drift: that map is a Record<TicketStatus, string>, so the compiler
   already forces every status to appear in it exactly once. */
export const TICKET_STATUSES = Object.keys(STATUS_LABELS) as TicketStatus[];

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

const PRIORITY_ETA: Record<TicketPriority, string> = {
  urgent: "within 4 business hours",
  high: "within 12 hours",
  normal: "within 24 hours",
  low: "within 48 hours",
};

/** Response-time promise shown on the submission success screen. */
export function priorityEta(p: TicketPriority): string {
  return PRIORITY_ETA[p] ?? PRIORITY_ETA.normal;
}

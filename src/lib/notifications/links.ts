import type { notificationTypeEnum, userRoleEnum } from "@/lib/db/schema";

export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];
export type ViewerRole = (typeof userRoleEnum.enumValues)[number];

interface LinkablePayload {
  ticketId?: unknown;
  calendarId?: unknown;
  kind?: unknown;
}

const STAFF_ROLES: ReadonlySet<ViewerRole> = new Set(["admin", "designer"]);

function id(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Where a notification should take the reader.
 *
 * Resolved per-viewer rather than stored on the row: `ticket_status` fans out
 * to staff from applyClientReview but to the ticket owner from the manage and
 * updates routes, so the same type has two destinations and only the reader's
 * role tells them apart. Computing it here also makes every notification
 * already in the table clickable without a migration.
 *
 * Returns null when there is nothing to open, so the caller can render plain
 * text instead of a dead link.
 */
export function notificationHref(
  type: NotificationType,
  payload: unknown,
  viewerRole: ViewerRole,
): string | null {
  const data = (payload ?? {}) as LinkablePayload;

  switch (type) {
    case "design_ready":
    case "ticket_status": {
      const ticketId = id(data.ticketId);
      if (!ticketId) return null;
      return STAFF_ROLES.has(viewerRole)
        ? `/admin/tickets/${ticketId}`
        : `/design-request/${ticketId}`;
    }
    case "system": {
      if (data.kind !== "calendar_ready") return null;
      const calendarId = id(data.calendarId);
      return calendarId ? `/calendar?calendarId=${calendarId}` : null;
    }
  }
}

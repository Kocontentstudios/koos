/**
 * Interim paywall. Until the payment provider is integrated, a workspace is
 * unusable until an admin approves it after the client's onboarding call and
 * payment. This module is the single definition of "may this person use this
 * workspace"; the layout, the brand choke point and the route guard all ask it.
 */

export const WORKSPACE_ACCESS_STATUSES = ["pending", "approved"] as const;
export type WorkspaceAccessStatus = (typeof WORKSPACE_ACCESS_STATUSES)[number];

export function isWorkspaceAccessStatus(
  value: unknown,
): value is WorkspaceAccessStatus {
  return (
    typeof value === "string" &&
    (WORKSPACE_ACCESS_STATUSES as readonly string[]).includes(value)
  );
}

export const ACCESS_GATE_PATH = "/access";

export const BOOK_CALL_URL =
  "https://cal.com/obafelakilla/ko-onboarding-meeting";

/** Sent by guardWorkspaceRoute so a client can tell this 403 from a capability
    denial. Brand-scoped routes return checkBrandAccess's error text only. */
export const WORKSPACE_PENDING_CODE = "workspace_pending";

export const WORKSPACE_PENDING_ERROR =
  "This workspace is waiting for approval. Book a call with the KO team to get access.";

/* Staff are exempt: designers and admins sign up like anyone else, so their
   personal workspace starts pending, and the admin approving a client must
   not be locked out of the app they are approving them into. */
const GATE_EXEMPT_ROLES: ReadonlySet<string> = new Set(["designer", "admin"]);

export function isWorkspaceOpen(
  accessStatus: WorkspaceAccessStatus,
  userRole: string,
): boolean {
  return accessStatus === "approved" || GATE_EXEMPT_ROLES.has(userRole);
}

export function workspacePendingResponse(): Response {
  return Response.json(
    { error: WORKSPACE_PENDING_ERROR, code: WORKSPACE_PENDING_CODE },
    { status: 403 },
  );
}

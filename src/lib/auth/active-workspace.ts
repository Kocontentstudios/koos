import type { WorkspaceMembership } from "@/lib/db/queries/workspaces";

/**
 * The workspace cookie is a POINTER, not a credential: it is only honored
 * when it matches a real membership. Stale/missing cookie falls back to the
 * first owner membership (usually the personal workspace), then any
 * membership — so a removed member silently lands somewhere safe.
 *
 * Approved workspaces win the fallback: an invited teammate's personal
 * workspace is pending by default, so owner-first alone would put them in
 * front of the access gate on every new device instead of in the client
 * workspace they were invited to.
 */
export function chooseActiveWorkspace(
  memberships: WorkspaceMembership[],
  cookieWorkspaceId: string | undefined,
): WorkspaceMembership | null {
  if (cookieWorkspaceId) {
    const match = memberships.find((m) => m.workspaceId === cookieWorkspaceId);
    if (match) return match;
  }
  const approved = memberships.filter(
    (m) => m.workspace.accessStatus === "approved",
  );
  return firstOwnerElseFirst(approved) ?? firstOwnerElseFirst(memberships);
}

function firstOwnerElseFirst(
  memberships: WorkspaceMembership[],
): WorkspaceMembership | null {
  return memberships.find((m) => m.role === "owner") ?? memberships[0] ?? null;
}

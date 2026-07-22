import type { WorkspaceMembership } from "@/lib/db/queries/workspaces";

/**
 * The workspace cookie is a POINTER, not a credential: it is only honored
 * when it matches a real membership. Stale/missing cookie falls back to the
 * first owner membership (usually the personal workspace), then any
 * membership — so a removed member silently lands somewhere safe.
 */
export function chooseActiveWorkspace(
  memberships: WorkspaceMembership[],
  cookieWorkspaceId: string | undefined,
): WorkspaceMembership | null {
  if (cookieWorkspaceId) {
    const match = memberships.find((m) => m.workspaceId === cookieWorkspaceId);
    if (match) return match;
  }
  return memberships.find((m) => m.role === "owner") ?? memberships[0] ?? null;
}

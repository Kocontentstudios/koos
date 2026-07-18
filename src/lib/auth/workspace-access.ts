/**
 * Workspace capability model. Fixed roles, defined in code — the guard is
 * written against this table even while only two roles exist, so adding a
 * role later is a row here, not a route audit.
 *
 * Workspace roles are a separate axis from platform roles (user/designer/
 * admin in src/lib/auth/roles.ts): platform roles say what you can do ON
 * KO OS; workspace roles say what you can do inside one customer's
 * workspace.
 */

export const WORKSPACE_ROLES = ["owner", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export type Capability =
  | "manage_content"
  | "delete_content"
  | "manage_team"
  | "manage_settings"
  | "delete_workspace";

const GRANTS: Record<WorkspaceRole, ReadonlySet<Capability>> = {
  owner: new Set([
    "manage_content",
    "delete_content",
    "manage_team",
    "manage_settings",
    "delete_workspace",
  ]),
  member: new Set(["manage_content"]),
};

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === "string" &&
    (WORKSPACE_ROLES as readonly string[]).includes(value)
  );
}

export function can(role: WorkspaceRole, capability: Capability): boolean {
  return GRANTS[role].has(capability);
}

export type AccessDecision =
  | { ok: true }
  | { ok: false; status: 403 | 404; error: string };

const NOT_FOUND: AccessDecision = {
  ok: false,
  status: 404,
  error: "Brand not found",
};

const FORBIDDEN: AccessDecision = {
  ok: false,
  status: 403,
  error: "You don't have permission to do that in this workspace.",
};

/**
 * Pure access decision for one brand. Non-membership and restriction both
 * yield 404 (not 403) so responses never reveal that a brand exists.
 * Restriction rows (member_brand_access) only bind members: empty list =
 * default open; owners are never restricted.
 */
export function evaluateBrandAccess(input: {
  membership: { role: WorkspaceRole } | null;
  capability: Capability;
  brandId: string;
  restrictedBrandIds: string[];
}): AccessDecision {
  const { membership, capability, brandId, restrictedBrandIds } = input;
  if (!membership) return NOT_FOUND;
  if (!can(membership.role, capability)) return FORBIDDEN;
  if (
    membership.role !== "owner" &&
    restrictedBrandIds.length > 0 &&
    !restrictedBrandIds.includes(brandId)
  ) {
    return NOT_FOUND;
  }
  return { ok: true };
}

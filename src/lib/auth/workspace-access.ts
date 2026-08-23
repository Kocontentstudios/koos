/**
 * Workspace capability model. Fixed roles, defined in code — routes ask for a
 * capability, never for a role, so adding a role stays a column here instead
 * of a route audit.
 *
 * Workspace roles are a separate axis from platform roles (user/designer/
 * admin in src/lib/auth/roles.ts): platform roles say what you can do ON
 * KO OS; workspace roles say what you can do inside one customer's
 * workspace. The `admin` in each enum is a different thing.
 */

/**
 * Declared in DESCENDING privilege. Postgres orders an enum by declaration
 * order and both member listings (getWorkspacesForUser, getWorkspaceMembers)
 * sort on this column, so reordering these silently reshuffles every team
 * list. ROLE_RANK below depends on it too.
 */
export const WORKSPACE_ROLES = [
  "owner",
  "admin",
  "brand_manager",
  "contributor",
] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/**
 * Which brands a membership reaches. `assigned` consults member_brand_access
 * and an empty assignment list means NO brands — the opposite of the dormant
 * v1 rule, where an empty list meant every brand. That inversion is the point:
 * under the old rule, deleting a brand manager's last assignment promoted them
 * to full workspace visibility.
 */
export const BRAND_SCOPES = ["all", "assigned"] as const;
export type BrandScope = (typeof BRAND_SCOPES)[number];

export type Capability =
  | "manage_content"
  | "create_brand"
  | "delete_brand"
  | "approve_deliverables"
  | "manage_team"
  | "invite_contributor"
  | "manage_brand_access"
  | "manage_settings"
  | "delete_workspace"
  | "transfer_ownership"
  | "view_billing"
  | "manage_billing";

export const CAPABILITIES: readonly Capability[] = [
  "manage_content",
  "create_brand",
  "delete_brand",
  "approve_deliverables",
  "manage_team",
  "invite_contributor",
  "manage_brand_access",
  "manage_settings",
  "delete_workspace",
  "transfer_ownership",
  "view_billing",
  "manage_billing",
] as const;

/* transfer_ownership, view_billing and manage_billing have no surface yet —
   there is no ownership-transfer flow and no billing code in the product.
   They are granted here so that when those features land they attach to an
   existing capability instead of reopening this table. */
const GRANTS: Record<WorkspaceRole, ReadonlySet<Capability>> = {
  owner: new Set(CAPABILITIES),
  admin: new Set<Capability>([
    "manage_content",
    "create_brand",
    "delete_brand",
    "approve_deliverables",
    "manage_team",
    "invite_contributor",
    "manage_brand_access",
    "manage_settings",
  ]),
  brand_manager: new Set<Capability>([
    "manage_content",
    "approve_deliverables",
    "invite_contributor",
  ]),
  contributor: new Set<Capability>(["manage_content"]),
};

/** Lower is more privileged. Drives every "may X act on Y" rule below. */
export const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 0,
  admin: 1,
  brand_manager: 2,
  contributor: 3,
};

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Workspace Admin",
  brand_manager: "Brand Manager",
  contributor: "Contributor",
};

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "The business owner. Full access, including billing and ownership.",
  admin:
    "Manages team, brands, and workspace settings. No billing or ownership.",
  brand_manager:
    "Manages only the brands assigned to them, and can invite contributors to those brands.",
  contributor:
    "Day-to-day work: campaigns, AI, and design requests inside the brands they can see.",
};

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === "string" &&
    (WORKSPACE_ROLES as readonly string[]).includes(value)
  );
}

export function isBrandScope(value: unknown): value is BrandScope {
  return (
    typeof value === "string" &&
    (BRAND_SCOPES as readonly string[]).includes(value)
  );
}

export function can(role: WorkspaceRole, capability: Capability): boolean {
  const grants = GRANTS[role];
  // A role in the database with no row here would otherwise deny silently or
  // crash obscurely. Fail loudly instead: it means the enum and this table
  // have drifted apart.
  if (!grants) throw new Error(`unknown workspace role: ${role}`);
  return grants.has(capability);
}

/** Every capability as a flat object, for threading to client components. */
export function capabilitiesFor(
  role: WorkspaceRole,
): Record<Capability, boolean> {
  return Object.fromEntries(
    CAPABILITIES.map((c) => [c, can(role, c)]),
  ) as Record<Capability, boolean>;
}

/**
 * Scope is a function of role, not a free choice: owners and admins always
 * reach every brand, brand managers never reach more than their assignments.
 * Only contributors are configurable. The DB carries the same rule as CHECK
 * constraints, so a bug here cannot persist an impossible membership.
 */
export function resolveBrandScope(
  role: WorkspaceRole,
  requested?: BrandScope | null,
): BrandScope {
  if (role === "owner" || role === "admin") return "all";
  if (role === "brand_manager") return "assigned";
  return requested ?? "all";
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
 * Pure access decision for one brand. Non-membership and out-of-scope both
 * yield 404 (not 403) so responses never reveal that a brand exists.
 */
export function evaluateBrandAccess(input: {
  membership: { role: WorkspaceRole; brandScope: BrandScope } | null;
  capability: Capability;
  brandId: string;
  assignedBrandIds: string[];
}): AccessDecision {
  const { membership, capability, brandId, assignedBrandIds } = input;
  if (!membership) return NOT_FOUND;
  /* Scope BEFORE capability, deliberately. Reversed, a caller who is both
     out of scope and short of the capability gets 403 instead of 404 — and
     that 403 is a positive oracle for "this brand exists in your workspace
     and is hidden from you". Reachable via approve_deliverables, which a
     contributor lacks. Out of scope must be indistinguishable from absent. */
  if (
    membership.brandScope === "assigned" &&
    !assignedBrandIds.includes(brandId)
  ) {
    return NOT_FOUND;
  }
  if (!can(membership.role, capability)) return FORBIDDEN;
  return { ok: true };
}

export type MemberActionDecision =
  | { ok: true }
  | { ok: false; status: 400 | 403; error: string };

const OK: MemberActionDecision = { ok: true };

/**
 * May `actor` act on `target` at all? Two rules, both rank-based:
 * you cannot act on yourself through the team API, and you cannot act on a
 * peer or a superior. Admins therefore manage brand managers and
 * contributors but never each other; only the owner outranks an admin.
 */
function evaluateMemberAuthority(input: {
  actorRole: WorkspaceRole;
  actorUserId: string;
  targetUserId: string;
  targetRole: WorkspaceRole;
  workspaceOwnerId: string;
}): MemberActionDecision {
  const { actorRole, actorUserId, targetUserId, targetRole, workspaceOwnerId } =
    input;
  if (!can(actorRole, "manage_team")) {
    return {
      ok: false,
      status: 403,
      error: "You need workspace admin access to manage the team.",
    };
  }
  if (targetUserId === workspaceOwnerId) {
    return {
      ok: false,
      status: 403,
      error: "The workspace owner can't be changed or removed.",
    };
  }
  if (targetUserId === actorUserId) {
    return {
      ok: false,
      status: 400,
      error: "You can't change your own membership.",
    };
  }
  if (ROLE_RANK[targetRole] <= ROLE_RANK[actorRole]) {
    return {
      ok: false,
      status: 403,
      error: "You can't manage a member at or above your own role.",
    };
  }
  return OK;
}

export function evaluateMemberRemoval(input: {
  actorRole: WorkspaceRole;
  actorUserId: string;
  targetUserId: string;
  targetRole: WorkspaceRole;
  workspaceOwnerId: string;
}): MemberActionDecision {
  return evaluateMemberAuthority(input);
}

/**
 * May `actor` move `target` to `nextRole`? Authority over the target, plus
 * the no-escalation rule: you can only grant a role strictly below your own,
 * so nobody can mint a peer, and ownership is unreachable (transfer is a
 * separate feature that does not exist yet).
 */
export function evaluateRoleChange(input: {
  actorRole: WorkspaceRole;
  actorUserId: string;
  targetUserId: string;
  targetCurrentRole: WorkspaceRole;
  targetNextRole: WorkspaceRole;
  workspaceOwnerId: string;
}): MemberActionDecision {
  const authority = evaluateMemberAuthority({
    actorRole: input.actorRole,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    targetRole: input.targetCurrentRole,
    workspaceOwnerId: input.workspaceOwnerId,
  });
  if (!authority.ok) return authority;
  if (input.targetNextRole === "owner") {
    return {
      ok: false,
      status: 403,
      error: "Ownership can't be granted.",
    };
  }
  if (ROLE_RANK[input.targetNextRole] <= ROLE_RANK[input.actorRole]) {
    return {
      ok: false,
      status: 403,
      error: "You can't grant a role at or above your own.",
    };
  }
  return OK;
}

/**
 * May `actor` invite someone as `role` with `brandIds`? Owners and admins
 * invite anyone below them. A brand manager holds only invite_contributor:
 * contributors only, and never to a brand they don't hold themselves — so
 * the invite path can't widen its own reach.
 */
export function evaluateInvite(input: {
  actorRole: WorkspaceRole;
  actorBrandScope: BrandScope;
  actorAssignedBrandIds: string[];
  invitedRole: WorkspaceRole;
  brandIds: string[];
}): MemberActionDecision {
  const {
    actorRole,
    actorBrandScope,
    actorAssignedBrandIds,
    invitedRole,
    brandIds,
  } = input;

  if (invitedRole === "owner") {
    return { ok: false, status: 403, error: "Ownership can't be granted." };
  }

  if (can(actorRole, "manage_team")) {
    if (ROLE_RANK[invitedRole] <= ROLE_RANK[actorRole]) {
      return {
        ok: false,
        status: 403,
        error: "You can't invite someone at or above your own role.",
      };
    }
  } else if (can(actorRole, "invite_contributor")) {
    if (invitedRole !== "contributor") {
      return {
        ok: false,
        status: 403,
        error: "You can only invite contributors.",
      };
    }
  } else {
    return {
      ok: false,
      status: 403,
      error: "You need workspace admin access to invite people.",
    };
  }

  const scope = resolveBrandScope(
    invitedRole,
    brandIds.length > 0 ? "assigned" : null,
  );
  if (scope === "assigned" && brandIds.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Choose at least one brand for this person.",
    };
  }

  /* An inviter who is themselves brand-scoped can only pass on what they
     hold — and can never produce a workspace-wide member, which would hand
     out brands the inviter cannot reach. */
  if (actorBrandScope === "assigned") {
    if (brandIds.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "Choose at least one brand for this person.",
      };
    }
    const outside = brandIds.filter(
      (id) => !actorAssignedBrandIds.includes(id),
    );
    if (outside.length > 0) {
      return {
        ok: false,
        status: 403,
        error: "You can only share brands you're assigned to.",
      };
    }
  }

  return OK;
}

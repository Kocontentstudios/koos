import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  type BrandScope,
  type Capability,
  evaluateBrandAccess,
  type WorkspaceRole,
} from "@/lib/auth/workspace-access";
import { db } from "@/lib/db/client";
import {
  brands,
  calendarItems,
  calendars,
  designTickets,
  memberBrandAccess,
  strategies,
  users,
  workspaceInvitationBrands,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";

// ── Memberships ──────────────────────────────────────────────────────

export async function getMembership(workspaceId: string, userId: string) {
  const [row] = await db
    .select({
      id: workspaceMembers.id,
      role: workspaceMembers.role,
      brandScope: workspaceMembers.brandScope,
    })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface WorkspaceMembership {
  workspaceId: string;
  role: WorkspaceRole;
  brandScope: BrandScope;
  workspace: {
    id: string;
    name: string;
    logoUrl: string | null;
    ownerId: string;
  };
}

/** Every workspace this user belongs to, owner memberships first. */
export async function getWorkspacesForUser(
  userId: string,
): Promise<WorkspaceMembership[]> {
  const rows = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      brandScope: workspaceMembers.brandScope,
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        logoUrl: workspaces.logoUrl,
        ownerId: workspaces.ownerId,
      },
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    // Ascending enum order: workspace_role is declared most-privileged
    // first, so owner sorts ahead of admin ahead of contributor.
    .orderBy(workspaceMembers.role, workspaces.createdAt);
  return rows;
}

/**
 * Personal-workspace fallback for accounts created before this feature's
 * signup hook ran (or by Google OAuth paths added later). Idempotent.
 *
 * The workspace insert and the owner-membership insert run inside a single
 * transaction so the pair is atomic: concurrent zero-membership requests
 * can't each create their own workspace, and a crash between the two inserts
 * can't leave an orphaned, membership-less workspace behind.
 */
export async function getOrCreatePersonalWorkspaceId(
  userId: string,
  firstName: string,
): Promise<string> {
  const existing = await getWorkspacesForUser(userId);
  if (existing.length > 0) return existing[0].workspaceId;
  return db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspaces)
      .values({ name: `${firstName}'s Workspace`, ownerId: userId })
      .returning({ id: workspaces.id });
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: ws.id, userId, role: "owner" })
      .onConflictDoNothing();
    return ws.id;
  });
}

// ── Brand access (THE choke point) ───────────────────────────────────

export type BrandAccess =
  | { ok: true; brand: typeof brands.$inferSelect }
  | { ok: false; status: 403 | 404; error: string };

/**
 * Fetch-and-authorize in one call. Every code path that touches a brand on
 * behalf of a user goes through here — routes must not fetch a brand and
 * check ownership themselves. 404 for "not yours" (no existence leak),
 * 403 for "yours but capability denied".
 */
export async function checkBrandAccess(
  userId: string,
  brandId: string,
  capability: Capability,
): Promise<BrandAccess> {
  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) {
    return { ok: false, status: 404, error: "Brand not found" };
  }
  const membership = await getMembership(brand.workspaceId, userId);
  // Only assignment-scoped memberships need the lookup; owners, admins and
  // workspace-wide contributors skip the query entirely.
  const assignedBrandIds =
    membership?.brandScope === "assigned"
      ? await getAssignedBrandIds(brand.workspaceId, userId)
      : [];
  const decision = evaluateBrandAccess({
    membership,
    capability,
    brandId,
    assignedBrandIds,
  });
  if (!decision.ok) return decision;
  return { ok: true, brand };
}

// ── Workspace-scoped brand queries ───────────────────────────────────

/** The brand ids explicitly assigned to one member. */
export async function getAssignedBrandIds(
  workspaceId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ brandId: memberBrandAccess.brandId })
    .from(memberBrandAccess)
    .where(
      and(
        eq(memberBrandAccess.workspaceId, workspaceId),
        eq(memberBrandAccess.userId, userId),
      ),
    );
  return rows.map((r) => r.brandId);
}

/**
 * Brands this member may see. An assignment-scoped member with no
 * assignments sees NOTHING — the empty list is not a wildcard.
 */
export async function getBrandsForMember(workspaceId: string, userId: string) {
  const membership = await getMembership(workspaceId, userId);
  if (!membership) return [];
  if (membership.brandScope === "assigned") {
    const assigned = await getAssignedBrandIds(workspaceId, userId);
    if (assigned.length === 0) return [];
    return db
      .select()
      .from(brands)
      .where(
        and(eq(brands.workspaceId, workspaceId), inArray(brands.id, assigned)),
      )
      .orderBy(desc(brands.updatedAt));
  }
  return db
    .select()
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
    .orderBy(desc(brands.updatedAt));
}

/** Workspace-scoped replacement for getActiveBrandForUser. */
export async function getActiveBrandForMember(
  workspaceId: string,
  userId: string,
) {
  const list = await getBrandsForMember(workspaceId, userId);
  return list[0] ?? null;
}

/** Tickets across every brand this member can see (honors brand scope). */
export async function getDesignTicketsForMember(
  workspaceId: string,
  userId: string,
) {
  const visibleBrands = await getBrandsForMember(workspaceId, userId);
  if (visibleBrands.length === 0) return [];
  return db
    .select({
      ticket: designTickets,
      campaignName: strategies.name,
      itemTitle: calendarItems.title,
    })
    .from(designTickets)
    .leftJoin(calendarItems, eq(designTickets.calendarItemId, calendarItems.id))
    .leftJoin(calendars, eq(calendarItems.calendarId, calendars.id))
    .leftJoin(strategies, eq(calendars.strategyId, strategies.id))
    .where(
      inArray(
        designTickets.brandId,
        visibleBrands.map((b) => b.id),
      ),
    )
    .orderBy(desc(designTickets.createdAt));
}

// ── Members ──────────────────────────────────────────────────────────

export async function getWorkspaceMembers(workspaceId: string) {
  return db
    .select({
      membershipId: workspaceMembers.id,
      role: workspaceMembers.role,
      brandScope: workspaceMembers.brandScope,
      joinedAt: workspaceMembers.createdAt,
      user: {
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(workspaceMembers.role, workspaceMembers.createdAt);
}

/** Idempotent: accepting an invite twice (or racing) is a no-op. */
export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  brandScope: BrandScope = "all",
) {
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role, brandScope })
    .onConflictDoNothing();
}

/**
 * Role and scope move together in one statement, because they are bound by a
 * CHECK constraint: writing the role first would transiently violate it.
 */
export async function updateMembership(
  workspaceId: string,
  userId: string,
  data: { role: WorkspaceRole; brandScope: BrandScope },
  brandIds?: string[],
) {
  /* Role, scope, and assignments move as ONE transaction. Split apart, a
     failure between them strands a brand manager with zero brands — and the
     CHECK constraint then refuses to put them back to 'all', so only
     re-assigning brands can repair it. */
  const ownIds =
    brandIds && brandIds.length > 0
      ? await getWorkspaceBrandIds(workspaceId, brandIds)
      : [];
  await db.transaction(async (tx) => {
    await tx
      .update(workspaceMembers)
      .set(data)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      );
    if (!brandIds) return;
    await tx
      .delete(memberBrandAccess)
      .where(
        and(
          eq(memberBrandAccess.workspaceId, workspaceId),
          eq(memberBrandAccess.userId, userId),
        ),
      );
    if (ownIds.length > 0) {
      await tx
        .insert(memberBrandAccess)
        .values(ownIds.map((brandId) => ({ workspaceId, userId, brandId })))
        .onConflictDoNothing();
    }
  });
}

/**
 * Replace a member's brand assignments wholesale. Delete-then-insert inside
 * one transaction so a member is never transiently assigned to nothing —
 * under `assigned` scope that would be a momentary total lockout.
 */
export async function setMemberBrandAccess(
  workspaceId: string,
  userId: string,
  brandIds: string[],
) {
  // Narrow here too, not just in the callers: this is the only writer of
  // grants, so a cross-workspace id must not be persistable through it.
  const ownIds =
    brandIds.length > 0
      ? await getWorkspaceBrandIds(workspaceId, brandIds)
      : [];
  await db.transaction(async (tx) => {
    await tx
      .delete(memberBrandAccess)
      .where(
        and(
          eq(memberBrandAccess.workspaceId, workspaceId),
          eq(memberBrandAccess.userId, userId),
        ),
      );
    if (ownIds.length > 0) {
      await tx
        .insert(memberBrandAccess)
        .values(ownIds.map((brandId) => ({ workspaceId, userId, brandId })))
        .onConflictDoNothing();
    }
  });
}

/** Assignments for every member of a workspace, keyed by user id. */
export async function getBrandAccessByMember(workspaceId: string) {
  const rows = await db
    .select({
      userId: memberBrandAccess.userId,
      brandId: memberBrandAccess.brandId,
    })
    .from(memberBrandAccess)
    .where(eq(memberBrandAccess.workspaceId, workspaceId));
  const byMember = new Map<string, string[]>();
  for (const row of rows) {
    const list = byMember.get(row.userId);
    if (list) list.push(row.brandId);
    else byMember.set(row.userId, [row.brandId]);
  }
  return byMember;
}

/** Brand ids belonging to a workspace, filtered to a candidate list. */
export async function getWorkspaceBrandIds(
  workspaceId: string,
  candidateIds: string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const rows = await db
    .select({ id: brands.id })
    .from(brands)
    .where(
      and(
        eq(brands.workspaceId, workspaceId),
        inArray(brands.id, candidateIds),
      ),
    );
  return rows.map((r) => r.id);
}

export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
) {
  await db.transaction(async (tx) => {
    /* Invitations this member sent die with them. Otherwise a brand manager
       who is removed today still mints members into their old brands for the
       rest of the 7-day token TTL. */
    await tx
      .delete(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.invitedById, userId),
          isNull(workspaceInvitations.acceptedAt),
        ),
      );
    await tx
      .delete(memberBrandAccess)
      .where(
        and(
          eq(memberBrandAccess.workspaceId, workspaceId),
          eq(memberBrandAccess.userId, userId),
        ),
      );
    await tx
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      );
  });
}

// ── Invitations ──────────────────────────────────────────────────────

/**
 * Drop the pending invitations one member sent. Used when their own access
 * shrinks: an invitation carries the brands and role the inviter held WHEN
 * they sent it, so a demoted or narrowed inviter would otherwise keep minting
 * members into brands they no longer hold, for the rest of the 7-day TTL.
 */
export async function deletePendingInvitationsFrom(
  workspaceId: string,
  invitedById: string,
) {
  await db
    .delete(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.invitedById, invitedById),
        isNull(workspaceInvitations.acceptedAt),
      ),
    );
}

export async function getPendingInvitations(workspaceId: string) {
  return db
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.acceptedAt),
      ),
    )
    .orderBy(desc(workspaceInvitations.createdAt));
}

/** citext column ⇒ equality is case-insensitive at the DB level. */
export async function getPendingInvitationByEmail(
  workspaceId: string,
  email: string,
) {
  const [row] = await db
    .select({ id: workspaceInvitations.id })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.email, email),
        isNull(workspaceInvitations.acceptedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The invitation row and its brand grants are written atomically. */
export async function createWorkspaceInvitation(input: {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  brandScope: BrandScope;
  tokenHash: string;
  invitedById: string;
  expiresAt: Date;
  brandIds: string[];
}) {
  const { brandIds, ...invitation } = input;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(workspaceInvitations)
      .values(invitation)
      .returning({ id: workspaceInvitations.id });
    if (brandIds.length > 0) {
      await tx
        .insert(workspaceInvitationBrands)
        .values(brandIds.map((brandId) => ({ invitationId: row.id, brandId })))
        .onConflictDoNothing();
    }
    return row;
  });
}

export async function getInvitationBrandIds(
  invitationId: string,
): Promise<string[]> {
  const rows = await db
    .select({ brandId: workspaceInvitationBrands.brandId })
    .from(workspaceInvitationBrands)
    .where(eq(workspaceInvitationBrands.invitationId, invitationId));
  return rows.map((r) => r.brandId);
}

/** Brand grants for every pending invitation in a workspace. */
export async function getInvitationBrandsByInvitation(workspaceId: string) {
  const rows = await db
    .select({
      invitationId: workspaceInvitationBrands.invitationId,
      brandId: workspaceInvitationBrands.brandId,
    })
    .from(workspaceInvitationBrands)
    .innerJoin(
      workspaceInvitations,
      eq(workspaceInvitations.id, workspaceInvitationBrands.invitationId),
    )
    .where(eq(workspaceInvitations.workspaceId, workspaceId));
  const byInvitation = new Map<string, string[]>();
  for (const row of rows) {
    const list = byInvitation.get(row.invitationId);
    if (list) list.push(row.brandId);
    else byInvitation.set(row.invitationId, [row.brandId]);
  }
  return byInvitation;
}

export async function getInvitationById(id: string) {
  const [row] = await db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.id, id))
    .limit(1);
  return row ?? null;
}

export async function getInvitationByTokenHash(tokenHash: string) {
  const [row] = await db
    .select({
      invitation: workspaceInvitations,
      workspaceName: workspaces.name,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
    .where(eq(workspaceInvitations.tokenHash, tokenHash))
    .limit(1);
  return row ? { ...row.invitation, workspaceName: row.workspaceName } : null;
}

export async function rotateInvitationToken(
  id: string,
  tokenHash: string,
  expiresAt: Date,
) {
  await db
    .update(workspaceInvitations)
    .set({ tokenHash, expiresAt })
    .where(eq(workspaceInvitations.id, id));
}

export async function deleteInvitation(id: string) {
  await db.delete(workspaceInvitations).where(eq(workspaceInvitations.id, id));
}

export async function markInvitationAccepted(id: string) {
  await db
    .update(workspaceInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(workspaceInvitations.id, id));
}

/** The owner user of a workspace (for notifications). */
export async function getWorkspaceOwner(workspaceId: string) {
  const [row] = await db
    .select({ id: users.id, email: users.email, firstName: users.firstName })
    .from(workspaces)
    .innerJoin(users, eq(workspaces.ownerId, users.id))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
}

// ── Workspace settings / lifecycle ───────────────────────────────────

export async function updateWorkspace(
  id: string,
  data: { name?: string; logoUrl?: string | null },
) {
  await db
    .update(workspaces)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(workspaces.id, id));
}

/**
 * Delete a workspace ONLY if `ownerId` still owns it — the ownership check
 * and the delete are one atomic statement, so a concurrent ownership change
 * can't slip through between check and delete. Brands (and their whole
 * content tree), memberships, and invitations go with it via FK cascades.
 */
export async function deleteWorkspaceOwnedBy(
  workspaceId: string,
  ownerId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, ownerId)))
    .returning({ id: workspaces.id });
  return deleted.length > 0;
}

export async function countWorkspaceBrands(workspaceId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId));
  return row?.value ?? 0;
}

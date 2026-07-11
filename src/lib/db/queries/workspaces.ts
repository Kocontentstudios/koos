import { and, desc, eq, inArray } from "drizzle-orm";
import {
  type Capability,
  evaluateBrandAccess,
  type WorkspaceRole,
} from "@/lib/auth/workspace-access";
import { db } from "@/lib/db/client";
import {
  brands,
  memberBrandAccess,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";

// ── Memberships ──────────────────────────────────────────────────────

export async function getMembership(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ id: workspaceMembers.id, role: workspaceMembers.role })
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
    // Ascending enum order: workspace_role declares ('owner','member'),
    // so owner sorts first.
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
  const restrictions = membership
    ? await db
        .select({ brandId: memberBrandAccess.brandId })
        .from(memberBrandAccess)
        .where(
          and(
            eq(memberBrandAccess.workspaceId, brand.workspaceId),
            eq(memberBrandAccess.userId, userId),
          ),
        )
    : [];
  const decision = evaluateBrandAccess({
    membership,
    capability,
    brandId,
    restrictedBrandIds: restrictions.map((r) => r.brandId),
  });
  if (!decision.ok) return decision;
  return { ok: true, brand };
}

// ── Workspace-scoped brand queries ───────────────────────────────────

/** Brands this member may see, honoring member_brand_access default-open. */
export async function getBrandsForMember(workspaceId: string, userId: string) {
  const membership = await getMembership(workspaceId, userId);
  if (!membership) return [];
  const restrictions = await db
    .select({ brandId: memberBrandAccess.brandId })
    .from(memberBrandAccess)
    .where(
      and(
        eq(memberBrandAccess.workspaceId, workspaceId),
        eq(memberBrandAccess.userId, userId),
      ),
    );
  const restricted =
    membership.role !== "owner" && restrictions.length > 0
      ? restrictions.map((r) => r.brandId)
      : null;
  return db
    .select()
    .from(brands)
    .where(
      restricted
        ? and(
            eq(brands.workspaceId, workspaceId),
            inArray(brands.id, restricted),
          )
        : eq(brands.workspaceId, workspaceId),
    )
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

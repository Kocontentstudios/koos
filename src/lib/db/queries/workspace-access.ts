import { and, asc, desc, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { WorkspaceAccessStatus } from "@/lib/auth/workspace-approval";
import { db } from "@/lib/db/client";
import { users, workspaces } from "@/lib/db/schema";

const decider = alias(users, "access_decider");

/** Every workspace for the admin Access page, those waiting for a decision first. */
export async function listWorkspacesForAccessReview() {
  return (
    db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        accessStatus: workspaces.accessStatus,
        accessDecidedAt: workspaces.accessDecidedAt,
        createdAt: workspaces.createdAt,
        ownerFirstName: users.firstName,
        ownerLastName: users.lastName,
        ownerEmail: users.email,
        deciderFirstName: decider.firstName,
        deciderLastName: decider.lastName,
      })
      .from(workspaces)
      .innerJoin(users, eq(workspaces.ownerId, users.id))
      .leftJoin(decider, eq(workspaces.accessDecidedBy, decider.id))
      // workspace_access_status is declared pending-first, so ascending
      // enum order puts the queue on top.
      .orderBy(asc(workspaces.accessStatus), desc(workspaces.createdAt))
  );
}

export async function getWorkspaceAccess(workspaceId: string) {
  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      accessStatus: workspaces.accessStatus,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
}

/**
 * Moves a workspace to `status` and records who decided. Conditional on the
 * status actually changing, so a double-clicked Approve updates once and the
 * caller sends one approval email, not two. Returns null when nothing changed.
 */
export async function setWorkspaceAccess(
  workspaceId: string,
  status: WorkspaceAccessStatus,
  decidedBy: string,
) {
  const now = new Date();
  const [row] = await db
    .update(workspaces)
    .set({
      accessStatus: status,
      accessDecidedAt: now,
      accessDecidedBy: decidedBy,
      updatedAt: now,
    })
    .where(
      and(eq(workspaces.id, workspaceId), ne(workspaces.accessStatus, status)),
    )
    .returning({
      id: workspaces.id,
      name: workspaces.name,
      accessStatus: workspaces.accessStatus,
    });
  return row ?? null;
}

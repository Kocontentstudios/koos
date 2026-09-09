import {
  can,
  evaluateMemberRemoval,
  evaluateRoleChange,
  isBrandScope,
  isWorkspaceRole,
  resolveBrandScope,
} from "@/lib/auth/workspace-access";
import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import {
  deletePendingInvitationsFrom,
  getAssignedBrandIds,
  getMembership,
  getWorkspaceBrandIds,
  removeWorkspaceMember,
  updateMembership,
} from "@/lib/db/queries";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const guard = await guardWorkspaceRoute("manage_team");
  if ("response" in guard) return guard.response;
  const { dbUser, workspace, role } = guard.ctx;

  if (userId === dbUser.id) {
    return Response.json(
      { error: "You can't remove yourself from your own workspace." },
      { status: 400 },
    );
  }
  const target = await getMembership(workspace.id, userId);
  if (!target) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }
  const decision = evaluateMemberRemoval({
    actorRole: role,
    actorUserId: dbUser.id,
    targetUserId: userId,
    targetRole: target.role,
    workspaceOwnerId: workspace.ownerId,
  });
  if (!decision.ok) {
    return Response.json(
      { error: decision.error },
      { status: decision.status },
    );
  }
  await removeWorkspaceMember(workspace.id, userId);
  return Response.json({ ok: true });
}

/** Change a member's role and/or which brands they reach. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const guard = await guardWorkspaceRoute("manage_team");
  if ("response" in guard) return guard.response;
  const { dbUser, workspace, role } = guard.ctx;

  let body: { role?: string; brandScope?: string; brandIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const target = await getMembership(workspace.id, userId);
  if (!target) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }

  const nextRole = body.role ?? target.role;
  if (!isWorkspaceRole(nextRole)) {
    return Response.json({ error: "Unknown role." }, { status: 400 });
  }
  if (body.brandScope !== undefined && !isBrandScope(body.brandScope)) {
    return Response.json({ error: "Unknown brand scope." }, { status: 400 });
  }

  const decision = evaluateRoleChange({
    actorRole: role,
    actorUserId: dbUser.id,
    targetUserId: userId,
    targetCurrentRole: target.role,
    targetNextRole: nextRole,
    workspaceOwnerId: workspace.ownerId,
  });
  if (!decision.ok) {
    return Response.json(
      { error: decision.error },
      { status: decision.status },
    );
  }

  /* Changing what someone reaches is a distinct capability from changing
     their role — and a pure role change can widen reach on its own (brand
     manager -> contributor goes from a few brands to all of them). Gate on
     the effect, not just on the presence of a brandIds field. */
  const wantsBrandChange =
    body.brandIds !== undefined ||
    resolveBrandScope(nextRole, target.brandScope) !== target.brandScope;
  if (wantsBrandChange && !can(role, "manage_brand_access")) {
    return Response.json(
      { error: "You need workspace admin access to change brand access." },
      { status: 403 },
    );
  }

  /* Ids are narrowed to this workspace before anything is written, so an id
     from another workspace can never become an assignment. */
  const requestedBrandIds = Array.isArray(body.brandIds)
    ? body.brandIds.filter((id): id is string => typeof id === "string")
    : null;
  const brandIds = requestedBrandIds
    ? await getWorkspaceBrandIds(workspace.id, requestedBrandIds)
    : await getAssignedBrandIds(workspace.id, userId);

  const nextScope = resolveBrandScope(
    nextRole,
    isBrandScope(body.brandScope) ? body.brandScope : target.brandScope,
  );

  /* An assignment-scoped member with no brands can reach nothing, which is a
     silent lockout rather than a permission. Refuse it at the edge. */
  if (nextScope === "assigned" && brandIds.length === 0) {
    return Response.json(
      { error: "Choose at least one brand for this person." },
      { status: 400 },
    );
  }

  // One transaction: a member must never be observable with the new role but
  // the old assignments, in either direction.
  await updateMembership(
    workspace.id,
    userId,
    { role: nextRole, brandScope: nextScope },
    nextScope === "assigned" ? brandIds : [],
  );

  /* Their own access just changed, so any invitation they already sent may
     grant more than they now hold. Revoke the pending ones rather than let
     them outlive the demotion. */
  if (nextRole !== target.role || nextScope !== target.brandScope) {
    await deletePendingInvitationsFrom(workspace.id, userId);
  }

  return Response.json({ ok: true, role: nextRole, brandScope: nextScope });
}

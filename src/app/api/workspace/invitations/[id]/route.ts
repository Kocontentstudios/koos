import { can } from "@/lib/auth/workspace-access";
import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import { deleteInvitation, getInvitationById } from "@/lib/db/queries";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await guardWorkspaceRoute([
    "manage_team",
    "invite_contributor",
  ]);
  if ("response" in guard) return guard.response;
  const { dbUser, workspace, role } = guard.ctx;
  const invite = await getInvitationById(id);
  if (!invite || invite.workspaceId !== workspace.id) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }
  // A brand manager can revoke only the invitations they sent themselves.
  if (!can(role, "manage_team") && invite.invitedById !== dbUser.id) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }
  await deleteInvitation(id);
  return Response.json({ ok: true });
}

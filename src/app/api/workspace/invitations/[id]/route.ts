import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { deleteInvitation, getInvitationById } from "@/lib/db/queries";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!can(role, "manage_team")) {
    return Response.json(
      { error: "Only the workspace owner can manage the team." },
      { status: 403 },
    );
  }
  const invite = await getInvitationById(id);
  if (!invite || invite.workspaceId !== workspace.id) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }
  await deleteInvitation(id);
  return Response.json({ ok: true });
}

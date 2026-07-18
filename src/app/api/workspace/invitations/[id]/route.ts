import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import { deleteInvitation, getInvitationById } from "@/lib/db/queries";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await guardWorkspaceRoute("manage_team");
  if ("response" in guard) return guard.response;
  const { workspace } = guard.ctx;
  const invite = await getInvitationById(id);
  if (!invite || invite.workspaceId !== workspace.id) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }
  await deleteInvitation(id);
  return Response.json({ ok: true });
}

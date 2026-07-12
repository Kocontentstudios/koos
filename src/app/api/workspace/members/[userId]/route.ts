import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { getMembership, removeWorkspaceMember } from "@/lib/db/queries";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
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
  if (userId === dbUser.id) {
    return Response.json(
      { error: "You can't remove yourself from your own workspace." },
      { status: 400 },
    );
  }
  if (!(await getMembership(workspace.id, userId))) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }
  await removeWorkspaceMember(workspace.id, userId);
  return Response.json({ ok: true });
}

import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import { getMembership, removeWorkspaceMember } from "@/lib/db/queries";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const guard = await guardWorkspaceRoute("manage_team");
  if ("response" in guard) return guard.response;
  const { dbUser, workspace } = guard.ctx;
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

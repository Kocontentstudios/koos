import { getActiveWorkspace } from "@/lib/auth/workspace";
import { getPendingInvitations, getWorkspaceMembers } from "@/lib/db/queries";

export async function GET() {
  const { dbUser, workspace } = await getActiveWorkspace();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const [members, invitations] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    getPendingInvitations(workspace.id),
  ]);
  return Response.json({
    members,
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })),
  });
}

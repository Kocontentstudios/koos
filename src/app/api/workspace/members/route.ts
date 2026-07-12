import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import { getPendingInvitations, getWorkspaceMembers } from "@/lib/db/queries";

export async function GET() {
  const guard = await guardWorkspaceRoute();
  if ("response" in guard) return guard.response;
  const { workspace } = guard.ctx;
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

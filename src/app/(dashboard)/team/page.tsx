import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { getPendingInvitations, getWorkspaceMembers } from "@/lib/db/queries";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) redirect("/login");

  const [members, invitations] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    getPendingInvitations(workspace.id),
  ]);

  return (
    <TeamClient
      workspaceName={workspace.name}
      currentUserId={dbUser.id}
      canManage={can(role, "manage_team")}
      members={members.map((m) => ({
        userId: m.user.id,
        name: `${m.user.firstName} ${m.user.lastName}`.trim(),
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
      }))}
      invitations={invitations.map((i) => ({
        id: i.id,
        email: i.email,
        expiresAt: i.expiresAt.toISOString(),
      }))}
    />
  );
}

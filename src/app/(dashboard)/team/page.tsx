import { redirectToLogin } from "@/lib/auth/redirects";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import {
  getBrandAccessByMember,
  getBrandsForMember,
  getInvitationBrandsByInvitation,
  getMembership,
  getPendingInvitations,
  getWorkspaceMembers,
} from "@/lib/db/queries";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) redirectToLogin();

  const [members, invitations, brandsByMember, brandsByInvitation, brands, me] =
    await Promise.all([
      getWorkspaceMembers(workspace.id),
      getPendingInvitations(workspace.id),
      getBrandAccessByMember(workspace.id),
      getInvitationBrandsByInvitation(workspace.id),
      // The assignable list is the viewer's OWN reach, so a brand manager can
      // never hand out a brand they don't hold.
      getBrandsForMember(workspace.id, dbUser.id),
      getMembership(workspace.id, dbUser.id),
    ]);

  /* Brand assignments name brands the viewer may have no access to, and a
     brand id is the primary key every other route accepts. Only someone who
     can change assignments gets to see them. */
  const showAssignments = can(role, "manage_brand_access");

  return (
    <TeamClient
      workspaceName={workspace.name}
      currentUserId={dbUser.id}
      viewerRole={role}
      viewerBrandScope={me?.brandScope ?? "assigned"}
      canManage={can(role, "manage_team")}
      canInvite={can(role, "manage_team") || can(role, "invite_contributor")}
      canManageBrandAccess={can(role, "manage_brand_access")}
      brands={brands.map((b) => ({ id: b.id, name: b.name }))}
      members={members.map((m) => ({
        userId: m.user.id,
        name: `${m.user.firstName} ${m.user.lastName}`.trim(),
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
        brandScope: m.brandScope,
        assignedBrandIds: showAssignments
          ? (brandsByMember.get(m.user.id) ?? [])
          : [],
      }))}
      invitations={invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        brandScope: i.brandScope,
        assignedBrandIds: showAssignments
          ? (brandsByInvitation.get(i.id) ?? [])
          : [],
        expiresAt: i.expiresAt.toISOString(),
      }))}
    />
  );
}

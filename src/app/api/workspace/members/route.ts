import { can } from "@/lib/auth/workspace-access";
import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import {
  getBrandAccessByMember,
  getInvitationBrandsByInvitation,
  getPendingInvitations,
  getWorkspaceMembers,
} from "@/lib/db/queries";

export async function GET() {
  const guard = await guardWorkspaceRoute();
  if ("response" in guard) return guard.response;
  const { workspace, role } = guard.ctx;
  // See team/page.tsx: the roster is readable by every member, the brand ids
  // behind it are not.
  const showAssignments = can(role, "manage_brand_access");
  const [members, invitations, brandsByMember, brandsByInvitation] =
    await Promise.all([
      getWorkspaceMembers(workspace.id),
      getPendingInvitations(workspace.id),
      getBrandAccessByMember(workspace.id),
      getInvitationBrandsByInvitation(workspace.id),
    ]);
  return Response.json({
    members: members.map((m) => ({
      ...m,
      assignedBrandIds: showAssignments
        ? (brandsByMember.get(m.user.id) ?? [])
        : [],
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      brandScope: i.brandScope,
      assignedBrandIds: showAssignments
        ? (brandsByInvitation.get(i.id) ?? [])
        : [],
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })),
  });
}

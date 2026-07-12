import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { getInvitationById, rotateInvitationToken } from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { sendWorkspaceInviteEmail } from "@/lib/notify/workspace";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { resendInvitation } from "@/lib/workspace/invitations";

export async function POST(
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

  const verdict = await checkRateLimit({
    key: `invite:${dbUser.id}`,
    limit: 20,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  try {
    const result = await resendInvitation(
      {
        getInvitationById,
        rotateInvitationToken,
        sendInviteEmail: (args) =>
          sendWorkspaceInviteEmail({
            to: args.to,
            input: {
              inviterName: args.inviterName,
              workspaceName: args.workspaceName,
              acceptUrl: args.acceptUrl,
              expiresInDays: 7,
            },
          }),
        buildAcceptUrl: (token) =>
          appUrl(`/invite/${encodeURIComponent(token)}`),
      },
      {
        invitationId: id,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        inviterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
      },
    );
    if (!result.ok) {
      return Response.json({ error: "Invitation not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("resend invitation failed", err);
    return Response.json(
      { error: "Could not resend the invitation. Please try again." },
      { status: 500 },
    );
  }
}

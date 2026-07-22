import { requireVerifiedEmail } from "@/lib/auth/require-verified-email";
import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import { getInvitationById, rotateInvitationToken } from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { describeMailError } from "@/lib/email";
import { sendWorkspaceInviteEmail } from "@/lib/notify/workspace";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { resendInvitation } from "@/lib/workspace/invitations";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await guardWorkspaceRoute("manage_team");
  if ("response" in guard) return guard.response;
  const { dbUser, workspace } = guard.ctx;
  const unverified = requireVerifiedEmail(dbUser);
  if (unverified) return unverified;

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
    console.error("resend invitation failed", describeMailError(err));
    return Response.json(
      { error: "Could not resend the invitation. Please try again." },
      { status: 500 },
    );
  }
}

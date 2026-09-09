import { linkHostVerdict, requestHost } from "@/lib/app-url";
import { requireVerifiedEmail } from "@/lib/auth/require-verified-email";
import { can } from "@/lib/auth/workspace-access";
import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import { getInvitationById, rotateInvitationToken } from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import {
  describeMailError,
  isMailError,
  retryCanHelp,
  tenantMailMessage,
  wasAbandoned,
} from "@/lib/email";
import { sendWorkspaceInviteEmail } from "@/lib/notify/workspace";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { resendInvitation } from "@/lib/workspace/invitations";

export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await guardWorkspaceRoute([
    "manage_team",
    "invite_contributor",
  ]);
  if ("response" in guard) return guard.response;
  const { dbUser, workspace, role } = guard.ctx;
  const unverified = requireVerifiedEmail(dbUser);
  if (unverified) return unverified;

  const verdict = await checkRateLimit({
    key: `invite:${dbUser.id}`,
    limit: 20,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  /* Someone who can invite but not manage the team (a brand manager) may act
     only on invitations they sent themselves — otherwise they could resend,
     and so silently re-open, an admin's invitation. */
  if (!can(role, "manage_team")) {
    const invitation = await getInvitationById(id);
    if (
      !invitation ||
      invitation.workspaceId !== workspace.id ||
      invitation.invitedById !== dbUser.id
    ) {
      return Response.json({ error: "Invitation not found" }, { status: 404 });
    }
  }

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
              roleLabel: args.roleLabel,
              expiresInDays: 7,
            },
          }),
        wasAbandoned,
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
    /* The owner who pressed the button cannot reach the admin Email panel, so
       a provably wrong link host has to reach them here — reporting plain
       success would hand them a link that cannot work. An unconfirmable host
       only goes to the log: a custom staging domain looks identical, and
       warning on every correct send is how the real case gets ignored. */
    const verdict = linkHostVerdict(process.env, requestHost(req));
    if (verdict) {
      console.warn(`invitation link host: ${verdict.message}`);
    }
    return Response.json({
      ok: true,
      ...(verdict?.severity === "wrong"
        ? {
            warning:
              "The invitation was sent, but this environment builds links for a different deployment, so the link will not work. Ask an administrator to set the app URL for this environment.",
          }
        : {}),
    });
  } catch (err) {
    console.error("resend invitation failed", describeMailError(err));
    return Response.json(
      {
        error: isMailError(err)
          ? `${tenantMailMessage(err)}${retryCanHelp(err) ? " Please try again in a moment." : ""}`
          : "Could not resend the invitation. Please try again.",
      },
      { status: 500 },
    );
  }
}

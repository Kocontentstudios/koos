import { requireVerifiedEmail } from "@/lib/auth/require-verified-email";
import { isWorkspaceRole } from "@/lib/auth/workspace-access";
import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import {
  createWorkspaceInvitation,
  getAssignedBrandIds,
  getMembership,
  getPendingInvitationByEmail,
  getUserByEmail,
  getWorkspaceBrandIds,
} from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { describeMailError } from "@/lib/email";
import { sendWorkspaceInviteEmail } from "@/lib/notify/workspace";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { createInvitation } from "@/lib/workspace/invitations";

export async function POST(req: Request) {
  // A brand manager holds invite_contributor but not manage_team; the
  // per-role limits on WHAT they may invite are enforced in createInvitation.
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

  let body: { email?: string; role?: string; brandIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.email) {
    return Response.json({ error: "Enter an email address." }, { status: 400 });
  }
  const invitedRole = body.role ?? "contributor";
  if (!isWorkspaceRole(invitedRole)) {
    return Response.json({ error: "Unknown role." }, { status: 400 });
  }
  const brandIds = Array.isArray(body.brandIds)
    ? body.brandIds.filter((id): id is string => typeof id === "string")
    : [];

  const membership = await getMembership(workspace.id, dbUser.id);
  if (!membership) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }

  try {
    const result = await createInvitation(
      {
        getUserByEmail,
        getMembership,
        getPendingInvitationByEmail,
        createWorkspaceInvitation,
        filterWorkspaceBrandIds: getWorkspaceBrandIds,
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
        buildAcceptUrl: (token) =>
          appUrl(`/invite/${encodeURIComponent(token)}`),
      },
      {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        inviterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
        invitedById: dbUser.id,
        email: body.email,
        role: invitedRole,
        brandIds,
        inviter: {
          role,
          brandScope: membership.brandScope,
          assignedBrandIds:
            membership.brandScope === "assigned"
              ? await getAssignedBrandIds(workspace.id, dbUser.id)
              : [],
        },
      },
    );
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("create invitation failed", describeMailError(err));
    return Response.json(
      {
        error:
          "The invitation was saved but the email could not be sent — use Resend from the Pending tab.",
      },
      { status: 500 },
    );
  }
}

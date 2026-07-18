import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import {
  createWorkspaceInvitation,
  getMembership,
  getPendingInvitationByEmail,
  getUserByEmail,
} from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { sendWorkspaceInviteEmail } from "@/lib/notify/workspace";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { createInvitation } from "@/lib/workspace/invitations";

export async function POST(req: Request) {
  const guard = await guardWorkspaceRoute("manage_team");
  if ("response" in guard) return guard.response;
  const { dbUser, workspace } = guard.ctx;

  const verdict = await checkRateLimit({
    key: `invite:${dbUser.id}`,
    limit: 20,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.email) {
    return Response.json({ error: "Enter an email address." }, { status: 400 });
  }

  try {
    const result = await createInvitation(
      {
        getUserByEmail,
        getMembership,
        getPendingInvitationByEmail,
        createWorkspaceInvitation,
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
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        inviterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
        invitedById: dbUser.id,
        email: body.email,
      },
    );
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("create invitation failed", err);
    return Response.json(
      {
        error:
          "The invitation was saved but the email could not be sent — use Resend from the Pending tab.",
      },
      { status: 500 },
    );
  }
}

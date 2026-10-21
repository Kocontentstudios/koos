import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { appUrl } from "@/lib/app-url";
import { getAuthUser } from "@/lib/auth/get-user";
import { isWorkspaceAccessStatus } from "@/lib/auth/workspace-approval";
import {
  getWorkspaceAccess,
  getWorkspaceOwner,
  setWorkspaceAccess,
} from "@/lib/db/queries";
import { sendWorkspaceApprovedEmail } from "@/lib/notify/workspace";
import { isUuid } from "@/lib/validation/uuid";

/* This route sends mail. Vercel's default budget is shorter than the SMTP
   socket timeout in email.ts, so without this a stalled send is killed before
   the handler can log or report it. */
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  // Approval is a commercial decision, so admins only — not designers.
  if (dbUser?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }

  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!isWorkspaceAccessStatus(body.status)) {
    return Response.json({ error: "Invalid access status" }, { status: 400 });
  }
  const status = body.status;

  if (!(await getWorkspaceAccess(id))) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }

  const updated = await setWorkspaceAccess(id, status, dbUser.id);
  if (!updated) {
    // Already in that state (or a concurrent click got there first): no
    // second audit stamp, no second email.
    return Response.json({
      workspace: { id, accessStatus: status },
      changed: false,
      emailSent: false,
    });
  }

  const owner = await getWorkspaceOwner(id);
  /* Keyed on the owner, not the admin, so signed_up → access_book_call_clicked
     → workspace_access_changed is one person's funnel in PostHog. */
  await captureServerEvent({
    distinctId: owner?.id ?? dbUser.id,
    event: "workspace_access_changed",
    properties: { workspaceId: id, status, decidedBy: dbUser.id },
  });

  const emailSent =
    status === "approved" && owner
      ? await emailOwnerApproval(owner, id, updated.name)
      : false;

  return Response.json({
    workspace: { id, accessStatus: updated.accessStatus },
    changed: true,
    emailSent,
  });
}

/* Never throws: the approval is already committed, and the admin needs to
   hear "approved, but the email failed" rather than a 500 that reads as
   "approval failed" and invites a retry that would no-op. */
async function emailOwnerApproval(
  owner: { email: string; firstName: string },
  workspaceId: string,
  workspaceName: string,
): Promise<boolean> {
  try {
    await sendWorkspaceApprovedEmail({
      to: owner.email,
      input: {
        firstName: owner.firstName,
        workspaceName,
        dashboardUrl: appUrl("/dashboard"),
      },
    });
    return true;
  } catch (err) {
    console.error("access: approval email failed", { workspaceId, err });
    return false;
  }
}

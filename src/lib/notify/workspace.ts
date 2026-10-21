import { sendMail } from "@/lib/email";
import {
  type MemberJoinedEmailInput,
  memberJoinedEmail,
  type WorkspaceApprovedEmailInput,
  type WorkspaceInviteEmailInput,
  workspaceApprovedEmail,
  workspaceInviteEmail,
} from "@/lib/email-templates";

/** Sends the invite email. THROWS on failure — the invite route surfaces
 * "email could not be sent" to the owner instead of silently succeeding. */
export async function sendWorkspaceInviteEmail(args: {
  to: string;
  input: WorkspaceInviteEmailInput;
}): Promise<void> {
  const built = workspaceInviteEmail(args.input);
  await sendMail({ to: args.to, subject: built.subject, html: built.html });
}

/** Best-effort owner notification — never throws. */
export async function sendMemberJoinedEmail(args: {
  to: string;
  input: MemberJoinedEmailInput;
}): Promise<void> {
  try {
    const built = memberJoinedEmail(args.input);
    await sendMail({ to: args.to, subject: built.subject, html: built.html });
  } catch (err) {
    console.error("member joined email failed", { to: args.to, err });
  }
}

/** Tells the owner their workspace was approved. THROWS on failure — the admin
 * route reports "approved, but the email did not send" so the team can follow
 * up by hand instead of assuming the client knows. */
export async function sendWorkspaceApprovedEmail(args: {
  to: string;
  input: WorkspaceApprovedEmailInput;
}): Promise<void> {
  const built = workspaceApprovedEmail(args.input);
  await sendMail({ to: args.to, subject: built.subject, html: built.html });
}

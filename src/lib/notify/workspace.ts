import { sendMail } from "@/lib/email";
import {
  type MemberJoinedEmailInput,
  memberJoinedEmail,
  type WorkspaceInviteEmailInput,
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

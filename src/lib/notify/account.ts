import { sendMail } from "@/lib/email";
import {
  type RoleChangeEmailInput,
  roleChangeEmail,
  type WelcomeEmailInput,
  welcomeEmail,
} from "@/lib/email-templates";

/** Tell a user their role changed. Never throws. */
export async function sendRoleChangeEmail(args: {
  to: string;
  input: RoleChangeEmailInput;
}): Promise<void> {
  try {
    const { subject, html } = roleChangeEmail(args.input);
    await sendMail({ to: args.to, subject, html });
  } catch (err) {
    console.error("role change email failed", { to: args.to, err });
  }
}

/** Welcome a newly created account. Never throws. */
export async function sendWelcomeEmail(args: {
  to: string;
  input: WelcomeEmailInput;
}): Promise<void> {
  try {
    const { subject, html } = welcomeEmail(args.input);
    await sendMail({ to: args.to, subject, html });
  } catch (err) {
    console.error("welcome email failed", { to: args.to, err });
  }
}

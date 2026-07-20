import { sendMail } from "@/lib/email";
import {
  type PasswordResetEmailInput,
  passwordResetEmail,
  type RoleChangeEmailInput,
  roleChangeEmail,
  type VerifyEmailInput,
  verifyEmailEmail,
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

/** Send the email-verification link. THROWS on failure — signup catches and
 * logs (the account still works), while the resend action surfaces it. */
export async function sendVerificationEmail(args: {
  to: string;
  input: VerifyEmailInput;
}): Promise<void> {
  const { subject, html } = verifyEmailEmail(args.input);
  await sendMail({ to: args.to, subject, html });
}

/** Send the password-reset link. Never throws. */
export async function sendPasswordResetEmail(args: {
  to: string;
  input: PasswordResetEmailInput;
}): Promise<void> {
  try {
    const { subject, html } = passwordResetEmail(args.input);
    await sendMail({ to: args.to, subject, html });
  } catch (err) {
    console.error("password reset email failed", { to: args.to, err });
  }
}

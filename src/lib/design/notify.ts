import { getAppSettings } from "@/lib/db/queries";
import { sendMail } from "@/lib/email";
import {
  type DesignDeliveryEmailInput,
  type DesignRequestEmailInput,
  designDeliveryEmail,
  designRequestConfirmationEmail,
  designRequestTeamEmail,
} from "@/lib/email-templates";

/** Design-team inbox: DB setting first, then env fallbacks. Never throws — a
 * settings-lookup failure degrades to the env fallback. */
export async function getDesignTeamEmail(): Promise<string> {
  let dbEmail: string | null = null;
  try {
    const settings = await getAppSettings();
    dbEmail = settings?.designTeamEmail ?? null;
  } catch (err) {
    console.error(
      "getDesignTeamEmail: settings lookup failed; using env fallback",
      err,
    );
  }
  return (
    dbEmail ||
    process.env.DESIGN_TEAM_EMAIL ||
    process.env.ZOHO_MAIL_FROM ||
    process.env.ZOHO_SMTP_USER ||
    ""
  ).trim();
}

/** Absolute app URL for links inside emails. */
export function appUrl(path: string): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Notify the design team and confirm to the requester. Never throws — a mail
 * failure is logged and swallowed so it cannot fail ticket creation.
 */
export async function sendDesignRequestEmails(
  input: DesignRequestEmailInput,
): Promise<void> {
  const team = await getDesignTeamEmail();
  if (team) {
    try {
      const { subject, html } = designRequestTeamEmail(input);
      await sendMail({
        to: team,
        subject,
        html,
        replyTo: input.requesterEmail,
      });
    } catch (err) {
      console.error("design request team email failed", {
        ticketNumber: input.ticketNumber,
        err,
      });
    }
  } else {
    console.warn(
      "design request: no design team email configured; skipping team notification",
      { ticketNumber: input.ticketNumber },
    );
  }

  const requesterTo = input.deliveryEmail || input.requesterEmail;
  try {
    const { subject, html } = designRequestConfirmationEmail(input);
    await sendMail({ to: requesterTo, subject, html });
  } catch (err) {
    console.error("design request confirmation email failed", {
      ticketNumber: input.ticketNumber,
      to: requesterTo,
      err,
    });
  }
}

/** Email the finished design. Never throws. */
export async function sendDesignDeliveryEmail(args: {
  to: string;
  input: DesignDeliveryEmailInput;
}): Promise<void> {
  try {
    const { subject, html } = designDeliveryEmail(args.input);
    await sendMail({ to: args.to, subject, html });
  } catch (err) {
    console.error("design delivery email failed", {
      ticketNumber: args.input.ticketNumber,
      to: args.to,
      err,
    });
  }
}

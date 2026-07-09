import nodemailer, { type Transporter } from "nodemailer";

/** Thrown when SMTP env vars are absent — distinguishes "misconfigured
    deployment" from a live Zoho auth/connection failure in the logs. */
export class EmailConfigError extends Error {
  constructor(missing: string[]) {
    super(
      `SMTP is not configured — missing env: ${missing.join(", ")}. ` +
        "Set the ZOHO_SMTP_* variables (see .env.example).",
    );
    this.name = "EmailConfigError";
  }
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  const missing = ["ZOHO_SMTP_USER", "ZOHO_SMTP_PASS"].filter(
    (key) => !process.env[key],
  );
  if (missing.length > 0) {
    throw new EmailConfigError(missing);
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.ZOHO_SMTP_HOST ?? "smtp.zoho.com",
      port: Number(process.env.ZOHO_SMTP_PORT) || 465,
      secure: process.env.ZOHO_SMTP_SECURE !== "false",
      auth: {
        user: process.env.ZOHO_SMTP_USER,
        pass: process.env.ZOHO_SMTP_PASS,
      },
    });
  }
  return transporter;
}

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

export async function sendMail(options: SendMailOptions) {
  const { to, subject, html, cc, bcc, replyTo, attachments } = options;

  const result = await getTransporter().sendMail({
    from: process.env.ZOHO_MAIL_FROM ?? process.env.ZOHO_SMTP_USER,
    to: Array.isArray(to) ? to.join(",") : to,
    subject,
    html,
    cc: cc ? (Array.isArray(cc) ? cc.join(",") : cc) : undefined,
    bcc: bcc ? (Array.isArray(bcc) ? bcc.join(",") : bcc) : undefined,
    replyTo,
    attachments,
  });

  return result;
}

/** Summarize a nodemailer/SMTP failure for logs: surfaces the SMTP error
    code and server response, which pinpoint auth vs. connect vs. policy
    rejections in production logs. */
export function describeMailError(err: unknown): string {
  if (err instanceof EmailConfigError) return err.message;
  if (err instanceof Error) {
    const smtp = err as Error & {
      code?: string;
      command?: string;
      responseCode?: number;
      response?: string;
    };
    const parts = [smtp.message];
    if (smtp.code) parts.push(`code=${smtp.code}`);
    if (smtp.command) parts.push(`command=${smtp.command}`);
    if (smtp.responseCode) parts.push(`responseCode=${smtp.responseCode}`);
    if (smtp.response) parts.push(`response=${smtp.response}`);
    return parts.join(" | ");
  }
  return String(err);
}

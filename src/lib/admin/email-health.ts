import { appUrlBase, hasUnusableAppUrl, linkHostVerdict } from "@/lib/app-url";
import {
  type MailEnv,
  mailFrom,
  missingSmtpVars,
  smtpHost,
  smtpPort,
  smtpSecure,
} from "@/lib/email";

export interface EmailHealthReport {
  configured: boolean;
  missing: string[];
  host: string;
  port: number;
  secure: boolean;
  /** Masked: enough to compare the two addresses, not enough to reuse them. */
  smtpUser: string | null;
  mailFrom: string | null;
  fromMatchesUser: boolean;
  inviteLinkBase: string;
  vercelEnv: string | null;
  /** Definitely broken. Downgrades the panel headline. */
  warnings: string[];
  /** Cannot be decided from the environment alone; the operator must confirm.
      Deliberately not a warning, so a correct setup is not permanently amber. */
  notes: string[];
}

/** Masks the local part so an operator can still compare two addresses and
    spot the alias mismatch without the panel printing a mailbox. Splits by
    code point — slicing a surrogate pair in half puts a lone surrogate on the
    wire. */
export function maskAddress(value: string | undefined | null): string | null {
  const address = value?.trim();
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = [...address.slice(0, at)];
  const domain = address.slice(at);
  if (local.length === 1) return `*${domain}`;
  return `${local[0]}${"*".repeat(local.length - 1)}${domain}`;
}

/**
 * Everything an operator needs to tell a broken email environment from a
 * working one, with no credential values in the payload. Pure: the live
 * connection check is a separate call, because this must still render when
 * SMTP is unreachable.
 */
export function emailHealthReport(
  env: MailEnv = process.env,
): EmailHealthReport {
  const missing = missingSmtpVars(env);
  const user = env.ZOHO_SMTP_USER?.trim() || null;
  const from = mailFrom(env)?.trim() || null;
  const inviteLinkBase = appUrlBase(env);
  const vercelEnv = env.VERCEL_ENV ?? null;

  const warnings: string[] = [];
  const notes: string[] = [];

  if (missing.length > 0) {
    warnings.push(
      `SMTP is not configured — set ${missing.join(" and ")} for this environment, then redeploy.`,
    );
  }
  if (env.ZOHO_MAIL_FROM !== undefined && !env.ZOHO_MAIL_FROM.trim()) {
    warnings.push(
      "ZOHO_MAIL_FROM exists but is blank. Remove it, or set it to the authenticated mailbox.",
    );
  }
  /* Caught here rather than diagnosed from a failure: the pairing is decidable
     from two variables, and the failure it produces is an ESOCKET that reads
     as an unreachable network. .env.example ships 465/true adjacently, so
     moving to Zoho's 587 without touching the second line lands here. */
  const port = smtpPort(env);
  const secure = smtpSecure(env);
  if (port === 587 && secure) {
    warnings.push(
      "ZOHO_SMTP_PORT is 587 but ZOHO_SMTP_SECURE is true. 587 uses STARTTLS — set ZOHO_SMTP_SECURE to false, or use port 465.",
    );
  }
  if (port === 465 && !secure) {
    warnings.push(
      "ZOHO_SMTP_PORT is 465 but ZOHO_SMTP_SECURE is false. 465 requires implicit TLS — set ZOHO_SMTP_SECURE to true, or use port 587.",
    );
  }

  if (hasUnusableAppUrl(env)) {
    warnings.push(
      "NEXT_PUBLIC_APP_URL is not a bare absolute http(s) origin, so it is being ignored. A value carrying a path, query or fragment produces dead links in email.",
    );
  }

  const verdict = linkHostVerdict(env);
  if (verdict?.severity === "wrong") warnings.push(verdict.message);
  else if (verdict) notes.push(verdict.message);

  /* Cannot be settled from the environment: Zoho alone knows whether the From
     address is a registered alias, and Vercel does not expose custom domain
     aliases, so a deliberate staging domain looks identical to a stale one. */
  if (user && from && user !== from) {
    notes.push(
      "Sends as an address other than the authenticated mailbox. Confirm it is a registered Zoho alias — if it is not, every send is rejected with 553.",
    );
  }
  if (!vercelEnv && env.NODE_ENV === "production") {
    notes.push(
      "No Vercel environment variables are visible, so the invite host cannot be checked automatically. Confirm NEXT_PUBLIC_APP_URL matches this deployment.",
    );
  }

  return {
    configured: missing.length === 0,
    missing,
    host: smtpHost(env),
    port: smtpPort(env),
    secure: smtpSecure(env),
    smtpUser: maskAddress(user),
    mailFrom: maskAddress(from),
    fromMatchesUser: Boolean(user && from && user === from),
    inviteLinkBase,
    vercelEnv,
    warnings,
    notes,
  };
}

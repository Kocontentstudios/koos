/**
 * SMTP diagnostic — verifies the Zoho SMTP credentials the app sends all
 * email through (contact form, password reset, welcome, design tickets).
 *
 * Usage:
 *   node scripts/check-smtp.mjs                  # connect + auth check only
 *   node scripts/check-smtp.mjs --send you@x.com # also deliver a test email
 *
 * To test PRODUCTION credentials, pull them first:
 *   vercel env pull .env.production.local
 *   node --env-file=.env.production.local scripts/check-smtp.mjs --send you@x.com
 *
 * Common Zoho failures this surfaces:
 *   - EAUTH 535: wrong password, or the mailbox has 2FA and needs an
 *     app-specific password (Zoho Mail → Settings → Security → App Passwords)
 *   - 553 relaying disallowed: ZOHO_MAIL_FROM is not the authenticated
 *     mailbox (or an authorized alias)
 *   - ETIMEDOUT/ECONNECTION: port 465 blocked or wrong ZOHO_SMTP_HOST
 *
 * Also prints the host invite links would resolve to. Sending mail successfully
 * from staging is only half of a working invitation: a link pointing at the
 * production host lands the recipient on a deployment where the invitation row
 * does not exist.
 */

import nodemailer from "nodemailer";

// The type-stripping loader emits this on every run for a .ts file in a
// package with no "type" field; it is noise ahead of diagnostic output.
process.removeAllListeners("warning");

// The real resolver, imported rather than reimplemented so the script and the
// app can never disagree about which host an invite link points at. Requires
// Node >= 22.18 for unflagged type stripping (see "engines" in package.json);
// on an older runtime the SMTP checks below still run.
let appUrlBase = null;
let linkHostVerdict = null;
let mailHelpers = null;
let importFailure = null;
try {
  ({ appUrlBase, linkHostVerdict } = await import("../src/lib/app-url.ts"));
  mailHelpers = await import("../src/lib/email.ts");
} catch (err) {
  // Reported rather than swallowed: falling back silently would print
  // different verdicts from the app's and look like a passing check.
  importFailure = err;
}

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
};
const ok = (m) => console.log(`${C.green}✓${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}⚠${C.reset} ${m}`);
const bad = (m) => console.log(`${C.red}✗${C.reset} ${m}`);

try {
  process.loadEnvFile(".env");
} catch {
  // rely on ambient env (CI / --env-file)
}

// The app's own helpers, imported rather than reimplemented, so the script
// cannot diagnose "wrong password" where the app refuses to connect at all.
if (importFailure) {
  bad(
    "Could not load the app's own helpers, so these checks would disagree with " +
      `the app: ${importFailure.message}. Node >= 22.18 is required (running ${process.version}).`,
  );
  process.exit(1);
}

const host = mailHelpers?.smtpHost(process.env) ?? "smtp.zoho.com";
const port = mailHelpers?.smtpPort(process.env) ?? 465;
const secure = mailHelpers?.smtpSecure(process.env) ?? port === 465;
const user =
  mailHelpers?.smtpUser(process.env) ?? process.env.ZOHO_SMTP_USER?.trim();
const pass =
  mailHelpers?.smtpPass(process.env) ?? process.env.ZOHO_SMTP_PASS?.trim();
const from = mailHelpers?.mailFrom(process.env) ?? user;

console.log(`SMTP config: ${C.dim}${host}:${port} secure=${secure}${C.reset}`);
console.log(
  `User: ${user ? `${C.dim}${user}${C.reset}` : `${C.red}NOT SET${C.reset}`}`,
);
console.log(
  `Pass: ${pass ? `${C.dim}(set, ${pass.length} chars)${C.reset}` : `${C.red}NOT SET${C.reset}`}`,
);
console.log(`From: ${C.dim}${from ?? "(unset)"}${C.reset}`);

const inviteBase = appUrlBase ? appUrlBase(process.env) : null;
const vercelEnv = process.env.VERCEL_ENV ?? "local";
console.log(
  inviteBase
    ? `Invite links: ${C.dim}${inviteBase}/invite/... (env: ${vercelEnv})${C.reset}\n`
    : `Invite links: ${C.dim}NOT CHECKED — needs Node >= 22.18 (running ${process.version})${C.reset}\n`,
);

// The same classifier the app and the admin panel use, so the script cannot
// disagree with what the operator sees in the panel.
const verdict = linkHostVerdict?.(process.env) ?? null;
if (verdict?.severity === "wrong") {
  warn(verdict.message);
} else if (verdict) {
  console.log(`${C.dim}Note: ${verdict.message}${C.reset}`);
}

const missing = mailHelpers?.missingSmtpVars(process.env) ?? [];
if (missing.length > 0 || !user || !pass) {
  bad(
    `${missing.join(" and ") || "ZOHO_SMTP_USER / ZOHO_SMTP_PASS"} missing or blank — every app email fails.`,
  );
  process.exit(1);
}
if (from && user && from !== user) {
  warn(
    `ZOHO_MAIL_FROM (${from}) differs from ZOHO_SMTP_USER (${user}) — that is ` +
      "fine only if it is a REGISTERED Zoho alias of the mailbox. If it is not, " +
      "connect and auth still succeed and every send is rejected with 553. " +
      "Use --send to find out.",
  );
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
  connectionTimeout: 15_000,
});

function describe(err) {
  const parts = [err.message];
  if (err.code) parts.push(`code=${err.code}`);
  if (err.command) parts.push(`command=${err.command}`);
  if (err.responseCode) parts.push(`responseCode=${err.responseCode}`);
  if (err.response) parts.push(`response=${err.response}`);
  return parts.join(" | ");
}

try {
  await transporter.verify();
  ok("SMTP connection + authentication OK.");
} catch (err) {
  bad(`SMTP verify failed: ${describe(err)}`);
  if (err.code === "EAUTH") {
    warn(
      "Auth rejected. If the Zoho mailbox has 2FA enabled, generate an " +
        "app-specific password and use THAT as ZOHO_SMTP_PASS.",
    );
  }
  process.exit(1);
}

const sendIdx = process.argv.indexOf("--send");
if (sendIdx !== -1) {
  const to = process.argv[sendIdx + 1];
  if (!to?.includes("@")) {
    bad("Usage: node scripts/check-smtp.mjs --send you@example.com");
    process.exit(1);
  }
  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: "KO OS SMTP diagnostic",
      html: `<p>Test email from <code>scripts/check-smtp.mjs</code> at ${new Date().toISOString()}.</p>`,
    });
    ok(
      `Test email accepted by server (id ${info.messageId}). Check the ${to} inbox (and spam).`,
    );
  } catch (err) {
    bad(`Test send failed: ${describe(err)}`);
    process.exit(1);
  }
}

ok("SMTP diagnostic complete.");

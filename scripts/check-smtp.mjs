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
 */

import nodemailer from "nodemailer";

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

const host = process.env.ZOHO_SMTP_HOST ?? "smtp.zoho.com";
const port = Number(process.env.ZOHO_SMTP_PORT) || 465;
const secure = process.env.ZOHO_SMTP_SECURE !== "false";
const user = process.env.ZOHO_SMTP_USER;
const pass = process.env.ZOHO_SMTP_PASS;
const from = process.env.ZOHO_MAIL_FROM ?? user;

console.log(`SMTP config: ${C.dim}${host}:${port} secure=${secure}${C.reset}`);
console.log(
  `User: ${user ? `${C.dim}${user}${C.reset}` : `${C.red}NOT SET${C.reset}`}`,
);
console.log(
  `Pass: ${pass ? `${C.dim}(set, ${pass.length} chars)${C.reset}` : `${C.red}NOT SET${C.reset}`}`,
);
console.log(`From: ${C.dim}${from ?? "(unset)"}${C.reset}\n`);

if (!user || !pass) {
  bad(
    "ZOHO_SMTP_USER and/or ZOHO_SMTP_PASS are missing — every app email fails.",
  );
  process.exit(1);
}
if (from && user && from !== user) {
  warn(
    `ZOHO_MAIL_FROM (${from}) differs from ZOHO_SMTP_USER (${user}) — ` +
      "Zoho rejects sends unless the From address is an authorized alias of the mailbox.",
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
  if (!to || !to.includes("@")) {
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

import nodemailer, { type Transporter } from "nodemailer";
import { ERROR_CODES } from "nodemailer/lib/errors.js";

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

export const REQUIRED_SMTP_VARS = ["ZOHO_SMTP_USER", "ZOHO_SMTP_PASS"] as const;

/** Loose env shape so callers and tests can pass a plain object without
    satisfying all of NodeJS.ProcessEnv. */
export type MailEnv = Record<string, string | undefined>;

/**
 * Every timeout is set below the serverless request budget on purpose.
 * Nodemailer's defaults (30s greeting, 2min connection) outlive the function
 * itself, so a blocked port 465 gets the process killed before any catch block
 * runs: no mail, no log line, nothing to diagnose. Failing at 10s keeps the
 * error inside the request, where it is caught, logged and shown to the user.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
} as const;

/**
 * A hard ceiling on one send attempt.
 *
 * The per-stage timeouts above are not a bound: socketTimeout is an IDLE
 * timeout that re-arms on every SMTP command, so a server answering each
 * command just inside it keeps the send alive indefinitely — measured at 90s
 * across six replies with a 20s idle limit. Summing the three and calling it a
 * worst case is arithmetic, not a guarantee, and the guarantee is the whole
 * point: the handler must always reach its own catch, log the diagnostics and
 * tell the owner, rather than being killed mid-send with nothing recorded.
 */
export const SMTP_SEND_DEADLINE_MS = 30_000;

/**
 * The smallest `maxDuration` a mail-sending route may declare, in seconds.
 *
 * Twice the deadline that is actually enforced, so the database work a handler
 * does around the send — and, on the resend path, the compensating rollback
 * and the log line that is its only record — get as much budget as the send
 * itself. mail-route-config.test.ts enforces it, so raising the deadline
 * without raising the routes fails the build instead of silently reopening
 * BUG-008.
 */
export const MIN_MAIL_ROUTE_MAX_DURATION = Math.ceil(
  (SMTP_SEND_DEADLINE_MS / 1000) * 2,
);

/* Blank-but-set is the dashboard's most common accident: `?? "smtp.zoho.com"`
   would leave host "" and the failure reads as a firewall problem. */
export function smtpHost(env: MailEnv = process.env): string {
  return env.ZOHO_SMTP_HOST?.trim() || "smtp.zoho.com";
}

/* The SAME values that missingSmtpVars() trims to decide "configured" must be
   the ones that reach AUTH. Trimming in one place and not the other is worse
   than not trimming at all: a password with a trailing space authenticates as
   configured, the diagnostic script (which also trims) reports OK, and only
   the app sends the untrimmed string and fails. */
export function smtpUser(env: MailEnv = process.env): string | undefined {
  return env.ZOHO_SMTP_USER?.trim();
}

export function smtpPass(env: MailEnv = process.env): string | undefined {
  return env.ZOHO_SMTP_PASS?.trim();
}

export function smtpPort(env: MailEnv = process.env): number {
  const port = Number(env.ZOHO_SMTP_PORT);
  /* A non-integer or out-of-range value falls back rather than being passed
     through: smtpSecure() reads the port, so 465.9 would silently drop the
     connection to plaintext. */
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 465;
}

/* Implicit TLS on 465, STARTTLS on 587. Defaulting to secure regardless of
   port makes ZOHO_SMTP_PORT=587 fail the TLS handshake with ETLS — a
   misconfiguration whose fix is one variable, reported as a dead connection. */
export function smtpSecure(env: MailEnv = process.env): boolean {
  const configured = env.ZOHO_SMTP_SECURE?.trim().toLowerCase();
  if (configured) return !["false", "0", "no", "off"].includes(configured);
  return smtpPort(env) === 465;
}

let transporter: Transporter | null = null;

/* Trimmed, not just present: a variable pasted into the Vercel dashboard with
   a stray space is "set" but authenticates as whitespace, which fails exactly
   like an unset one while every presence check reports healthy. */
export function missingSmtpVars(env: MailEnv = process.env): string[] {
  return REQUIRED_SMTP_VARS.filter((key) => !env[key]?.trim());
}

function getTransporter(): Transporter {
  const missing = missingSmtpVars();
  if (missing.length > 0) {
    throw new EmailConfigError(missing);
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtpHost(),
      port: smtpPort(),
      secure: smtpSecure(),
      auth: { user: smtpUser(), pass: smtpPass() },
      ...SMTP_TIMEOUTS,
    });
  }
  return transporter;
}

/** Opens a connection and authenticates without sending, for the admin health
    panel. Throws the same errors a real send would. */
export async function verifyTransport(): Promise<true> {
  // Tagged like every other path below the mail boundary, so a caller can
  // classify a verify failure the same way it classifies a send failure.
  return tagMailFailures(async () => {
    await getTransporter().verify();
    return true as const;
  });
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

/* Blank, not just unset: an env var created in the Vercel dashboard and left
   empty would otherwise send `from: ""`, which every SMTP server rejects.
   Both sides are trimmed — a space-padded mailbox fails the same way. */
export function mailFrom(env: MailEnv = process.env) {
  return env.ZOHO_MAIL_FROM?.trim() || smtpUser(env);
}

/* Tagged here rather than at each call site: this is the mail boundary, so
   every failure below it is a mail failure by construction and no caller has
   to remember. A caller that forgets would otherwise have a database error
   reported to the user as an email problem. */
export async function sendMail(options: SendMailOptions) {
  return tagMailFailures(() => withSendDeadline(send(options)));
}

/* nodemailer exposes no overall-send timeout and accepts no AbortSignal, so
   the ceiling has to be imposed from outside. The underlying socket is left to
   its own timeouts; what matters is that the caller regains control in time to
   log and respond. ETIMEDOUT so it classifies as a connection failure. */
async function withSendDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(
          new MailSendAbandoned(
            `SMTP send exceeded ${SMTP_SEND_DEADLINE_MS}ms and was abandoned`,
          ),
          { code: "ETIMEDOUT" },
        ),
      );
    }, SMTP_SEND_DEADLINE_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function send(options: SendMailOptions) {
  const { to, subject, html, cc, bcc, replyTo, attachments } = options;

  const result = await getTransporter().sendMail({
    from: mailFrom(),
    to: Array.isArray(to) ? to.join(",") : to,
    subject,
    html,
    cc: cc ? (Array.isArray(cc) ? cc.join(",") : cc) : undefined,
    bcc: bcc ? (Array.isArray(bcc) ? bcc.join(",") : bcc) : undefined,
    replyTo,
    attachments,
  });

  /* nodemailer only throws when EVERY recipient is refused; a partial
     rejection resolves, and reading it here is the only place that can tell
     the caller some addresses were dropped. */
  if (result.rejected?.length) {
    throw Object.assign(
      new Error(`Rejected recipients: ${result.rejected.join(", ")}`),
      { code: "EENVELOPE", command: "RCPT TO" },
    );
  }

  return result;
}

export type MailFailureKind =
  | "config"
  | "auth"
  | "relay"
  | "recipient"
  | "message"
  | "tls"
  | "throttled"
  | "connection"
  | "unknown";

/**
 * Every code nodemailer documents, mapped to something an operator can act on.
 *
 * The test compares this against the library's own exported table, so an
 * upgrade that adds a code fails there rather than silently classifying it as
 * "unknown" and telling the operator only that the email could not be sent.
 * ESENDMAIL and ESES belong to transports this app does not use.
 */
export const MAIL_ERROR_KINDS: Record<string, MailFailureKind> = {
  ECONNECTION: "connection",
  ETIMEDOUT: "connection",
  ESOCKET: "connection",
  EDNS: "connection",
  EPROXY: "connection",
  // Raw socket codes, surfaced before nodemailer relabels them.
  ECONNREFUSED: "connection",
  EHOSTUNREACH: "connection",
  ETLS: "tls",
  EREQUIRETLS: "tls",
  // NOT tls: a proxy or captive portal answering "HTTP/1.1 200 OK" on the SMTP
  // port lands here, and blaming ZOHO_SMTP_SECURE for that is a misdirection.
  EPROTOCOL: "connection",
  EENVELOPE: "relay",
  EMESSAGE: "message",
  ESTREAM: "message",
  EFILEACCESS: "message",
  EURLACCESS: "message",
  EFETCH: "message",
  EAUTH: "auth",
  ENOAUTH: "auth",
  EOAUTH2: "auth",
  EMAXLIMIT: "throttled",
  ECONFIG: "config",
  ESENDMAIL: "unknown",
  ESES: "unknown",
};

/** The library's own list, so the test can prove the map covers all of it. */
export const NODEMAILER_ERROR_CODES: readonly string[] =
  Object.keys(ERROR_CODES);

/** Classifies a send failure into the four things an operator can actually act
    on. Kept separate from describeMailError because the log may carry the raw
    server response and the user-facing message may not. */
const TLS_MISMATCH_SIGNS = [
  "wrong version number",
  "record layer",
  "packet length too long",
  "unknown protocol",
  "ssl routines",
];

function looksLikeTlsMismatch(err: {
  code?: string;
  message?: string;
  response?: string;
}): boolean {
  if (err.code !== "ESOCKET" && err.code !== "EPROTOCOL") return false;
  const text = `${err.message ?? ""} ${err.response ?? ""}`.toLowerCase();
  return TLS_MISMATCH_SIGNS.some((sign) => text.includes(sign));
}

export function mailFailureKind(err: unknown): MailFailureKind {
  const inner = unwrap(err);
  if (inner instanceof EmailConfigError) return "config";
  if (!(inner instanceof Error)) return "unknown";
  const smtp = inner as Error & {
    code?: string;
    command?: string;
    responseCode?: number;
    response?: string;
  };

  /* 4xx first, and before the envelope split: a 4xx is the far end asking us
     to come back later, whatever stage it arrives at. Greylisting answers
     "451 try again later" to RCPT TO, and reading the command first reported
     the most common rejection in SMTP as a permanently bad address. */
  const transient =
    smtp.responseCode !== undefined &&
    smtp.responseCode >= 400 &&
    smtp.responseCode < 500;
  /* "454 Temporary authentication failure" is what Zoho and Google return
     after repeated bad app-password attempts. Keeping the auth diagnosis (the
     retry advice comes from retryCanHelp, which reads the 4xx separately)
     stops it being reported as a sending-limit problem. */
  if (transient) {
    return smtp.code &&
      Object.hasOwn(MAIL_ERROR_KINDS, smtp.code) &&
      MAIL_ERROR_KINDS[smtp.code] === "auth"
      ? "auth"
      : "throttled";
  }

  /* Envelope rejections are the one place a code alone lies. nodemailer raises
     EENVELOPE for RCPT TO as well as MAIL FROM, so a mistyped invitee address
     would otherwise be reported as OUR sender being refused — sending the
     owner to press Resend forever and the operator to Zoho's alias settings,
     when the fix is to correct the address. The command says which end failed. */
  /* A port/secure mismatch does NOT surface as ETLS. nodemailer only emits
     that from tls.connect's own error callback, which the implicit-TLS path
     never reaches: talking TLS to a STARTTLS port (587 with secure=true)
     fails as ESOCKET "wrong version number", and the reverse times out. Both
     were being reported as an unreachable network and marked retryable, while
     the one message naming ZOHO_SMTP_SECURE was unreachable. */
  if (looksLikeTlsMismatch(smtp)) return "tls";

  const command = smtp.command?.toUpperCase();
  // Checked before the code map: nodemailer labels a size or content refusal
  // at DATA as EENVELOPE, which the map alone would call a sender problem and
  // send the operator to Zoho's alias settings.
  if (command === "DATA") return "message";
  // Postfix's reject_sender_login_mismatch and several SPF setups refuse the
  // SENDER at RCPT stage, so the stage alone would blame the invitee.
  if (command === "RCPT TO") {
    return /sender/i.test(smtp.response ?? "") ? "relay" : "recipient";
  }
  if (command === "MAIL FROM") return "relay";
  // No socket was opened: nodemailer rejected the message we handed it.
  if (command === "API") return "message";

  const byCode =
    smtp.code && Object.hasOwn(MAIL_ERROR_KINDS, smtp.code)
      ? MAIL_ERROR_KINDS[smtp.code]
      : undefined;
  if (byCode && byCode !== "unknown") return byCode;
  if (smtp.responseCode === 535) return "auth";
  // 550 mailbox unavailable, 551 not local, 552 over quota: all the far end.
  if (
    smtp.responseCode === 550 ||
    smtp.responseCode === 551 ||
    smtp.responseCode === 552
  ) {
    return "recipient";
  }
  // 553 is the sender address Zoho refuses when it is not a registered alias.
  if (smtp.responseCode === 553 || smtp.responseCode === 554) {
    return "relay";
  }
  // 4xx is the server asking us to come back later, not a broken config.
  if (
    smtp.responseCode &&
    smtp.responseCode >= 400 &&
    smtp.responseCode < 500
  ) {
    return "throttled";
  }
  return "unknown";
}

/**
 * Wraps anything thrown while sending, so callers can tell a mail failure from
 * everything else by TYPE rather than by sniffing error codes.
 *
 * Sniffing is not good enough: postgres.js rejects a query with a plain Error
 * carrying code ECONNREFUSED / ETIMEDOUT when the database is unreachable, so
 * a code-based test reports a database outage to the user as an email problem
 * — and, in the invite route, promises a saved invitation that was never
 * written. Callers that mix DB and mail work in one try block MUST wrap their
 * send with this.
 */
/** Marks a send abandoned at the deadline: the socket was not aborted, so the
    server may still accept it. The outcome is unknown, not failed. */
export class MailSendAbandoned extends Error {}

export function wasAbandoned(err: unknown): boolean {
  const current = unwrapCause(err);
  return current instanceof MailSendAbandoned;
}

export class MailSendError extends Error {
  /* A plain field, not a TypeScript parameter property: parameter properties
     are not erasable syntax, so they make this module unloadable by Node's
     type stripping — which scripts/check-smtp.mjs relies on to share these
     helpers instead of reimplementing them. */
  constructor(cause: unknown) {
    super("Sending mail failed");
    this.name = "MailSendError";
    this.cause = cause;
  }
}

export async function tagMailFailures<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (err) {
    throw new MailSendError(err);
  }
}

const unwrapCause = (err: unknown): unknown => unwrap(err);

/** Unwraps nested tags — a call site may wrap a sendMail that already tagged.
    Depth-bounded: a self-referential cause would otherwise spin forever. */
function unwrap(err: unknown): unknown {
  let current = err;
  for (let depth = 0; depth < 16; depth += 1) {
    if (!(current instanceof MailSendError)) return current;
    current = current.cause;
  }
  return current;
}

/**
 * True when the throw came from the mail layer.
 *
 * Answered by origin, never by error shape. postgres.js rejects with a plain
 * Error carrying ECONNREFUSED / ETIMEDOUT when the database is unreachable, so
 * any shape-based test reports a database outage as an email failure. A caller
 * that mixes database and mail work inside one try block must wrap its send in
 * tagMailFailures; an untagged throw is treated as not-mail on purpose, so the
 * failure mode is a vaguer message rather than a false one.
 */
export function isMailError(err: unknown): boolean {
  return err instanceof MailSendError || err instanceof EmailConfigError;
}

/* Two audiences, deliberately separate. OPERATOR_MESSAGE names our vendor,
   our environment variables and our deploy process; it belongs in the admin
   panel and the logs. TENANT_MESSAGE goes to a customer's workspace owner,
   who can neither set an env var nor redeploy, and must not be shown our
   internals. */
const OPERATOR_MESSAGE: Record<MailFailureKind, string> = {
  config:
    "Email is not configured for this environment — set ZOHO_SMTP_USER and ZOHO_SMTP_PASS, then redeploy.",
  auth: "The mail server rejected our credentials. Zoho needs an app password when 2FA is on.",
  relay:
    "The mail server refused the sender address. ZOHO_MAIL_FROM must be the authenticated mailbox or a registered alias of it.",
  recipient:
    "The recipient's mail server rejected the address at RCPT. Usually the address itself is wrong; if the response mentions relaying, that server will not accept mail for the domain from us.",
  message:
    "The server accepted the connection but rejected the message: size, content, or a sending limit on the mailbox. The full server response is in the log.",
  tls: "The TLS handshake failed. ZOHO_SMTP_SECURE must be false on port 587 and true on port 465.",
  throttled:
    "The mail server asked us to slow down. Wait and retry; if it persists, check the mailbox's sending limits.",
  connection:
    "Could not reach the mail server — refused, unresolved or not answering. Check that outbound SMTP on this port is reachable from this deployment.",
  unknown: "The email could not be sent.",
};

/** For the admin panel and the logs. Names the class of failure and the fix,
    never the credentials or the raw SMTP response. */
export function operatorMailMessage(err: unknown): string {
  return OPERATOR_MESSAGE[mailFailureKind(err)];
}

const TENANT_MESSAGE: Record<MailFailureKind, string> = {
  config: "Email delivery is not set up on this deployment yet.",
  auth: "Our email service rejected the message.",
  relay: "Our email service refused to send from this address.",
  recipient:
    "The invitation could not be delivered to that address. Check it is spelled correctly; if it is, that mail server is refusing messages from us.",
  message: "Our email service rejected the message.",
  tls: "Our email service could not be reached securely.",
  throttled: "Our email service is rate limiting us right now.",
  connection: "We could not reach our email service.",
  unknown: "The email could not be sent.",
};

/** For a customer's workspace owner. States what happened without naming the
    provider, an environment variable or a deploy — none of which they can act
    on — so the actionable part is the retry, not our configuration. */
export function tenantMailMessage(err: unknown): string {
  return TENANT_MESSAGE[mailFailureKind(err)];
}

/* Retrying is useless for all of these, and every one of them is a real
   historical failure here: no SMTP credentials, a password Zoho rejects (the
   535 EAUTH outage), TLS misconfigured for the port, a sender address that is
   not a registered alias (the 553), and a recipient address that is simply
   wrong. Each fails identically on every attempt, so telling the owner to
   press Resend is an instruction that cannot succeed. */
const RETRY_IS_FUTILE = new Set<MailFailureKind>([
  "config",
  "auth",
  "tls",
  "relay",
  "recipient",
]);

export function retryCanHelp(err: unknown): boolean {
  const inner = unwrap(err);
  const responseCode =
    inner instanceof Error
      ? (inner as Error & { responseCode?: number }).responseCode
      : undefined;
  /* A 5xx is permanent by definition, whatever kind it maps to — a daily
     sending quota arrives as "550 5.4.5" at end-of-DATA and classifies as
     `message`, which is otherwise worth retrying. Deciding from the code as
     well as the kind stops the owner being told to try again for a day. */
  if (responseCode !== undefined && responseCode >= 500) return false;
  // ...and a 4xx is transient whatever kind it maps to, so a temporary auth
  // failure is not treated as the permanent kind.
  if (responseCode !== undefined && responseCode >= 400) return true;
  return !RETRY_IS_FUTILE.has(mailFailureKind(err));
}

/** Summarize a nodemailer/SMTP failure for logs: surfaces the SMTP error
    code and server response, which pinpoint auth vs. connect vs. policy
    rejections in production logs. */
export function describeMailError(err: unknown): string {
  /* Unwrapped first: the tag carries no diagnostics of its own, and every
     failure on the invite path arrives tagged. Skipping this reduced the only
     log line that matters to "Sending mail failed". */
  const inner = unwrap(err);
  if (inner instanceof EmailConfigError) return inner.message;
  if (inner instanceof Error) {
    const smtp = inner as Error & {
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
  return inner === undefined || inner === null
    ? "unknown mail failure (no cause recorded)"
    : String(inner);
}

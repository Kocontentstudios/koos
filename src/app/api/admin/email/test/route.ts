import { emailHealthReport } from "@/lib/admin/email-health";
import { getAuthUser } from "@/lib/auth/get-user";
import { describeMailError, operatorMailMessage, sendMail } from "@/lib/email";
import { smtpTestEmail } from "@/lib/email-templates";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { isValidEmail } from "@/lib/validation/email";

export const maxDuration = 60;

/** Proves delivery, not just authentication: verify() succeeds against Zoho
    even when the From address is an unregistered alias that every send is
    rejected for. */
export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (dbUser?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const verdict = await checkRateLimit({
    key: `email-test:${dbUser.id}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  /* A cross-site form can send text/plain with a body that parses as JSON,
     and the session cookie is sameSite=lax, so a logged-in admin could be made
     to mail this deployment's details to an attacker-chosen address. A JSON
     content-type cannot be set by a simple form, so requiring it closes that
     without a token round-trip. */
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return Response.json(
      { error: "Expected application/json." },
      { status: 415 },
    );
  }

  let body: { to?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!isValidEmail(to)) {
    return Response.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  const report = emailHealthReport();
  const built = smtpTestEmail({
    environment: report.vercelEnv ?? "local",
    inviteLinkBase: report.inviteLinkBase,
    sentAt: new Date(),
  });

  try {
    await sendMail({ to, subject: built.subject, html: built.html });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("email test send failed", describeMailError(err));
    return Response.json({ error: operatorMailMessage(err) }, { status: 502 });
  }
}

import { emailHealthReport } from "@/lib/admin/email-health";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  describeMailError,
  mailFailureKind,
  operatorMailMessage,
  verifyTransport,
} from "@/lib/email";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const maxDuration = 60;

/**
 * Whether this deployment can actually send email, answered from the browser.
 * Staging has no shell, so without this the only way to tell a broken SMTP
 * environment from a working one is to invite someone and wait.
 */
export async function GET() {
  const { dbUser } = await getAuthUser();
  if (dbUser?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  /* Rate limited despite being a GET: it opens a real SMTP AUTH on every
     call, and the session cookie is sameSite=lax, so a lured top-level
     navigation could hammer Zoho into throttling every email path. */
  const verdict = await checkRateLimit({
    key: `email-health:${dbUser.id}`,
    limit: 30,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  const report = emailHealthReport();
  if (!report.configured) {
    return Response.json({
      ...report,
      connection: { ok: false, kind: "config" },
    });
  }

  try {
    await verifyTransport();
    return Response.json({
      ...report,
      connection: { ok: true, kind: null, detail: null },
    });
  } catch (err) {
    console.error("email health check failed", describeMailError(err));
    return Response.json({
      ...report,
      connection: {
        ok: false,
        kind: mailFailureKind(err),
        detail: operatorMailMessage(err),
      },
    });
  }
}

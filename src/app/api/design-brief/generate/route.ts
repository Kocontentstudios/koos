import { after } from "next/server";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import { requireVerifiedEmail } from "@/lib/auth/require-verified-email";
import { checkBrandAccess, createGenerationJob } from "@/lib/db/queries";
import {
  executeGenerationJob,
  generateDesignBriefWork,
} from "@/lib/jobs/run-generation";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validation/uuid";

// Headroom for the post-response generation work kicked off via after().
export const maxDuration = 300;

/**
 * Turns a Design Request Mode conversation into a structured brief as an async
 * job: returns 202 + jobId immediately; the client polls /api/jobs/[id] and
 * shows the brief for review before submitting it as a design ticket.
 */
export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const unverified = requireVerifiedEmail(dbUser);
  if (unverified) return unverified;

  const verdict = await checkRateLimit({
    key: `design-brief:${dbUser.id}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let body: { brandId?: string; conversation?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { brandId, conversation } = body;
  if (!brandId || !conversation || !isUuid(brandId)) {
    return Response.json(
      { error: "Missing or invalid brandId or conversation" },
      { status: 400 },
    );
  }
  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }
  const brand = access.brand;

  const job = await createGenerationJob({
    kind: "design_brief",
    userId: dbUser.id,
    brandId,
    input: {},
  });

  const sessionId = await getAnalyticsSessionId();
  after(() =>
    executeGenerationJob(job.id, () =>
      generateDesignBriefWork({
        brand,
        conversation,
        userId: dbUser.id,
        sessionId,
      }),
    ),
  );

  return Response.json({ jobId: job.id }, { status: 202 });
}

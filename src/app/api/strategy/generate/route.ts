import { after } from "next/server";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess, createGenerationJob } from "@/lib/db/queries";
import {
  executeGenerationJob,
  generateStrategyWork,
} from "@/lib/jobs/run-generation";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validation/uuid";

// Headroom for the post-response generation work kicked off via after().
export const maxDuration = 300;

/**
 * Kicks off strategy generation as an async job and returns 202 + jobId
 * immediately; the client polls /api/jobs/[id]. The request is never held
 * open for the model call, so proxy timeouts (Cloudflare 524) can't trigger.
 */
export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const verdict = await checkRateLimit({
    key: `strategy-generate:${dbUser.id}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let body: {
    brandId?: string;
    conversation?: string;
    conversationId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { brandId, conversation, conversationId } = body;
  if (!brandId || !conversation || !isUuid(brandId)) {
    return Response.json(
      { error: "Missing or invalid brandId or conversation" },
      { status: 400 },
    );
  }
  if (conversationId != null && !isUuid(conversationId)) {
    return Response.json({ error: "Invalid conversationId" }, { status: 400 });
  }
  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }
  const brand = access.brand;

  const job = await createGenerationJob({
    kind: "strategy",
    userId: dbUser.id,
    brandId,
    input: { conversationId: conversationId ?? null },
  });

  const sessionId = await getAnalyticsSessionId();
  after(() =>
    executeGenerationJob(job.id, () =>
      generateStrategyWork({
        brand,
        conversation,
        conversationId: conversationId ?? null,
        userId: dbUser.id,
        sessionId,
      }),
    ),
  );

  return Response.json({ jobId: job.id }, { status: 202 });
}

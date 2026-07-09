import { after } from "next/server";
import { strategySchema } from "@/lib/ai/strategy-schema";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  createGenerationJob,
  getBrandById,
  getStrategyById,
} from "@/lib/db/queries";
import {
  executeGenerationJob,
  generateCalendarWork,
} from "@/lib/jobs/run-generation";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

// Headroom for the post-response generation work kicked off via after().
export const maxDuration = 300;

/**
 * Kicks off calendar generation as an async job and returns 202 + jobId
 * immediately; the client polls /api/jobs/[id]. Calendar generation is the
 * slowest AI call in the app (a full 14-day plan), which previously exceeded
 * Cloudflare's ~100s origin timeout and surfaced as a 524.
 */
export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const verdict = await checkRateLimit({
    key: `calendar-generate:${dbUser.id}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let body: { strategyId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.strategyId) {
    return Response.json({ error: "Missing strategyId" }, { status: 400 });
  }

  const strategy = await getStrategyById(body.strategyId);
  if (!strategy) {
    return Response.json({ error: "Strategy not found" }, { status: 404 });
  }
  const brand = await getBrandById(strategy.brandId);
  if (!brand || brand.userId !== dbUser.id) {
    return Response.json({ error: "Strategy not found" }, { status: 404 });
  }
  const parsedStrategy = strategySchema.safeParse(strategy.structured);
  if (!parsedStrategy.success) {
    return Response.json(
      { error: "This strategy has no structured plan to build from." },
      { status: 422 },
    );
  }

  const job = await createGenerationJob({
    kind: "calendar",
    userId: dbUser.id,
    brandId: brand.id,
    input: { strategyId: strategy.id },
  });

  after(() =>
    executeGenerationJob(job.id, () =>
      generateCalendarWork({
        brand,
        strategy,
        structured: parsedStrategy.data,
        userId: dbUser.id,
      }),
    ),
  );

  return Response.json({ jobId: job.id }, { status: 202 });
}

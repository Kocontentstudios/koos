import { after } from "next/server";
import { z } from "zod";
import { strategySchema } from "@/lib/ai/strategy-schema";
import { ProposalSchema } from "@/lib/ai/tools/proposals";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  createGenerationJob,
  getStrategyById,
  updateBrand,
} from "@/lib/db/queries";
import { createTicketFromRequest } from "@/lib/design/ticket-create";
import {
  CALENDAR_SLICE_BUDGET_MS,
  executeGenerationJob,
  generateCalendarWork,
  generateStrategyWork,
} from "@/lib/jobs/run-generation";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

const bodySchema = z.object({ brandId: z.string().uuid(), proposal: ProposalSchema });

// Headroom for the post-response generation work kicked off via after().
export const maxDuration = 300;

/**
 * The single path that persists AI-proposed writes. The chat surface never
 * mutates state directly — it only produces a Proposal, and the user must
 * confirm it through this endpoint before anything touches the database.
 */
export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const verdict = await checkRateLimit({
    key: `confirm:${dbUser.id}`,
    limit: 30,
    windowSeconds: 300,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid proposal" }, { status: 400 });
  }

  const { brandId, proposal } = parsed;
  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }
  const brand = access.brand;

  switch (proposal.kind) {
    case "brand_fields": {
      // No usage_events row: the usage_kind enum has no brand-update value,
      // and adding one is out of this epic's scope.
      await updateBrand(brandId, proposal.data.fields);
      return Response.json({ ok: true, kind: proposal.kind, resultId: brandId });
    }

    case "design_ticket": {
      const { ticket } = await createTicketFromRequest(
        { brandId, userId: dbUser.id, ...proposal.data },
        {
          brandName: brand.name,
          requesterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
          requesterEmail: dbUser.email,
        },
      );
      return Response.json({ ok: true, kind: proposal.kind, resultId: ticket.id });
    }

    case "strategy": {
      const job = await createGenerationJob({
        kind: "strategy",
        userId: dbUser.id,
        brandId,
        input: proposal.data,
      });
      const sessionId = await getAnalyticsSessionId();
      after(() =>
        executeGenerationJob(job.id, () =>
          generateStrategyWork({
            brand,
            conversation: proposal.data.seed,
            conversationId: null,
            userId: dbUser.id,
            sessionId,
          }),
        ),
      );
      return Response.json({ ok: true, kind: proposal.kind, resultId: job.id }, { status: 202 });
    }

    case "calendar": {
      // A calendar builds on an existing structured strategy; the model must
      // propose a strategyId before this branch can run.
      if (!proposal.data.strategyId) {
        return Response.json(
          {
            error:
              "A completed strategy is required first. Ask me to create a strategy, then generate the calendar.",
          },
          { status: 400 },
        );
      }
      const strategy = await getStrategyById(proposal.data.strategyId);
      if (!strategy || strategy.brandId !== brandId) {
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
        brandId,
        input: { strategyId: strategy.id },
      });
      const sessionId = await getAnalyticsSessionId();
      after(() =>
        executeGenerationJob(
          job.id,
          (runtime) =>
            generateCalendarWork(
              {
                brand,
                strategy,
                structured: parsedStrategy.data,
                userId: dbUser.id,
                sessionId,
              },
              runtime,
            ),
          { softDeadlineMs: CALENDAR_SLICE_BUDGET_MS },
        ),
      );
      return Response.json({ ok: true, kind: proposal.kind, resultId: job.id }, { status: 202 });
    }
  }
}

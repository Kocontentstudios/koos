import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { strategySchema } from "@/lib/ai/strategy-schema";
import { ProposalSchema } from "@/lib/ai/tools/proposals";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import { requireVerifiedEmail } from "@/lib/auth/require-verified-email";
import { progressAfterFieldWrite } from "@/lib/brand-profile";
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

const bodySchema = z.object({
  brandId: z.string().uuid(),
  proposal: ProposalSchema,
  /** The chat the proposal was made in. A strategy confirmed here is that
   * chat's campaign, so it must carry the link the same way the Build
   * Strategy button does. */
  conversationId: z.string().uuid().optional(),
});

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

  const { brandId, proposal, conversationId } = parsed;
  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }
  const brand = access.brand;

  if (proposal.kind === "strategy" || proposal.kind === "calendar") {
    const unverified = requireVerifiedEmail(dbUser);
    if (unverified) return unverified;

    const genVerdict = await checkRateLimit({
      key: `confirm-generate:${dbUser.id}`,
      limit: 10,
      windowSeconds: 3600,
    });
    if (!genVerdict.ok) return tooManyRequests(genVerdict);
  }

  switch (proposal.kind) {
    case "brand_fields": {
      // No usage_events row: the usage_kind enum has no brand-update value,
      // and adding one is out of this epic's scope.
      const { fields } = proposal.data;
      /* Advance onboarding off the back of what the conversation captured.
         Confirming fields used to leave the status at "draft", which left a
         chat-only user permanently redirected back into onboarding. */
      const progress = progressAfterFieldWrite({ ...brand, ...fields });
      const wasCompleted = brand.onboardingStatus === "completed";
      await updateBrand(brandId, { ...fields, ...progress });

      if (!wasCompleted && progress.onboardingStatus === "completed") {
        const sessionId = await getAnalyticsSessionId();
        after(() =>
          captureServerEvent({
            distinctId: dbUser.id,
            event: "brand_brain_completed",
            properties: {
              brand_id: brandId,
              onboarding_type: brand.onboardingType,
              session_id: sessionId,
            },
          }),
        );
      }

      /* Synchronously, not in after(): the client navigates to /brand and then
         /dashboard immediately, and both read onboardingStatus. Revalidating
         after the response returns lets those pages render the pre-write
         status — which, on the dashboard, silently suppresses the product tour. */
      revalidatePath("/brand");
      revalidatePath("/dashboard");

      return Response.json({
        ok: true,
        kind: proposal.kind,
        resultId: brandId,
        brandCompleted: progress.onboardingStatus === "completed",
      });
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
      return Response.json({
        ok: true,
        kind: proposal.kind,
        resultId: ticket.id,
      });
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
            conversationId: conversationId ?? null,
            userId: dbUser.id,
            sessionId,
          }),
        ),
      );
      return Response.json(
        { ok: true, kind: proposal.kind, resultId: job.id },
        { status: 202 },
      );
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
      return Response.json(
        { ok: true, kind: proposal.kind, resultId: job.id },
        { status: 202 },
      );
    }
  }
}

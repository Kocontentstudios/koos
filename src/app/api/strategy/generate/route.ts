import { generateObject } from "ai";
import {
  buildStrategistSystemPrompt,
  buildStrategyGenerationPrompt,
} from "@/lib/ai/prompts/strategy";
import { getModel } from "@/lib/ai/provider";
import { strategySchema } from "@/lib/ai/strategy-schema";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  createStrategy,
  getBrandById,
  recordUsageEvent,
} from "@/lib/db/queries";

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  let body: { brandId?: string; conversation?: string; conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { brandId, conversation, conversationId } = body;
  if (!brandId || !conversation) {
    return Response.json(
      { error: "Missing brandId or conversation" },
      { status: 400 },
    );
  }
  const brand = await getBrandById(brandId);
  if (!brand || brand.userId !== dbUser.id) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }
  const summary = {
    name: brand.name,
    overview: brand.overview,
    businessType: brand.businessType,
    stage: brand.stage,
    targetAudience: brand.targetAudience,
    offer: brand.offer,
    tone: brand.tone,
    primaryGoal: brand.primaryGoal,
    values: brand.values,
    wordsLove: brand.wordsLove,
    wordsAvoid: brand.wordsAvoid,
    brandStyle: brand.brandStyle,
    competitors: brand.competitors,
    differentiators: brand.differentiators,
    platforms: brand.platforms,
    primaryPlatform: brand.primaryPlatform,
    postingFrequency: brand.postingFrequency,
  };
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: strategySchema,
      system: buildStrategistSystemPrompt(summary),
      prompt: buildStrategyGenerationPrompt(conversation, summary),
    });
    const strategy = await createStrategy({
      brandId,
      conversationId: conversationId ?? null,
      name: object.campaignName,
      structured: object,
      status: "active",
    });
    await recordUsageEvent({
      userId: dbUser.id,
      brandId,
      kind: "strategy_generated",
      metadata: { strategyId: strategy.id },
    });
    return Response.json({ strategy: object, strategyId: strategy.id });
  } catch (err) {
    console.error("strategy generation failed", err);
    return Response.json(
      { error: "Strategy generation failed. Please try again." },
      { status: 500 },
    );
  }
}

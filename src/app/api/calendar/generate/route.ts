import { generateObject } from "ai";
import { calendarPlanSchema } from "@/lib/ai/calendar-schema";
import {
  buildCalendarGenerationPrompt,
  buildCalendarSystemPrompt,
} from "@/lib/ai/prompts/calendar";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import { getModel } from "@/lib/ai/provider";
import { strategySchema } from "@/lib/ai/strategy-schema";
import { getAuthUser } from "@/lib/auth/get-user";
import { toCalendarRows, upcomingMonday } from "@/lib/calendar/schedule";
import {
  createCalendar,
  getBrandById,
  getStrategyById,
  insertCalendarItems,
  recordUsageEvent,
} from "@/lib/db/queries";

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

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

  const summary: BrandSummary = {
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

  let plan: ReturnType<typeof calendarPlanSchema.parse>;
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: calendarPlanSchema,
      system: buildCalendarSystemPrompt(summary),
      prompt: buildCalendarGenerationPrompt(parsedStrategy.data, summary),
    });
    plan = object;
  } catch (err) {
    console.error("calendar generation failed", err);
    return Response.json(
      { error: "The AI could not generate a calendar. Please try again." },
      { status: 502 },
    );
  }

  const scheduled = toCalendarRows(plan, upcomingMonday(new Date()));

  try {
    const calendar = await createCalendar({
      brandId: brand.id,
      strategyId: strategy.id,
      startDate: scheduled.startDate,
      endDate: scheduled.endDate,
    });
    await insertCalendarItems(
      scheduled.rows.map((r) => ({
        calendarId: calendar.id,
        date: r.date,
        time: r.time,
        platform: r.platform,
        contentType: r.contentType,
        title: r.title,
        brief: r.brief,
        designRequired: r.designRequired,
        designType: r.designType,
        dimensions: r.dimensions,
        sortOrder: r.sortOrder,
      })),
    );
    await recordUsageEvent({
      userId: dbUser.id,
      brandId: brand.id,
      kind: "calendar_generated",
      metadata: { calendarId: calendar.id, items: scheduled.rows.length },
    });
    return Response.json({ calendarId: calendar.id });
  } catch (err) {
    console.error("calendar persist failed", err);
    return Response.json(
      { error: "Could not save the calendar. Please try again." },
      { status: 500 },
    );
  }
}

import { generateObject } from "ai";
import {
  calendarChunkSchema,
  calendarOutlineSchema,
} from "@/lib/ai/calendar-schema";
import { designBriefSchema } from "@/lib/ai/design-brief-schema";
import {
  buildCalendarChunkPrompt,
  buildCalendarChunkSystemPrompt,
  buildCalendarOutlinePrompt,
  buildCalendarOutlineSystemPrompt,
} from "@/lib/ai/prompts/calendar";
import {
  buildDesignBriefGenerationPrompt,
  buildDesignBriefSystemPrompt,
} from "@/lib/ai/prompts/design-request";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import {
  buildStrategistSystemPrompt,
  buildStrategyGenerationPrompt,
} from "@/lib/ai/prompts/strategy";
import { getModel } from "@/lib/ai/provider";
import { type Strategy, strategySchema } from "@/lib/ai/strategy-schema";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { resolveStartDate, toCalendarRows } from "@/lib/calendar/schedule";
import {
  createCalendar,
  createNotification,
  createStrategy,
  insertCalendarItems,
  recordUsageEvent,
  updateGenerationJob,
} from "@/lib/db/queries";
import type { brands, strategies } from "@/lib/db/schema";
import {
  assembleCalendarItems,
  mapWithConcurrency,
  withRetry,
} from "@/lib/jobs/calendar-assembly";

type BrandRow = typeof brands.$inferSelect;
type StrategyRow = typeof strategies.$inferSelect;

export function brandSummaryFrom(brand: BrandRow): BrandSummary {
  return {
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
}

interface JobOutcome {
  /** id of a created row (strategy/calendar); omitted for ephemeral results. */
  resultId?: string;
  /** The payload the client reads from the job once it succeeds. */
  result: unknown;
}

export interface JobProgress {
  done: number;
  total: number;
  label: string;
}

export type ReportProgress = (progress: JobProgress) => void;

/**
 * Run one unit of generation work against a job row: pending → running →
 * succeeded/failed. Never throws — every failure lands on the job row so the
 * polling client always gets a terminal state.
 *
 * `work` may report progress; it is parked in the job's `result` column while
 * the job runs (overwritten by the real result on success) so the polling
 * client can show it, and each write refreshes `updatedAt`, which is what the
 * status route's stale-job detection keys off.
 */
export async function executeGenerationJob(
  jobId: string,
  work: (reportProgress: ReportProgress) => Promise<JobOutcome>,
): Promise<void> {
  const reportProgress: ReportProgress = (progress) => {
    // Fire-and-forget: progress is cosmetic, never fail the job over it.
    updateGenerationJob(jobId, { result: { progress } }).catch(() => {});
  };
  try {
    await updateGenerationJob(jobId, { status: "running" });
    const outcome = await work(reportProgress);
    await updateGenerationJob(jobId, {
      status: "succeeded",
      resultId: outcome.resultId,
      result: outcome.result,
    });
  } catch (err) {
    console.error(`generation job ${jobId} failed`, err);
    try {
      await updateGenerationJob(jobId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    } catch (updateErr) {
      console.error(
        `generation job ${jobId}: failed to record failure`,
        updateErr,
      );
    }
  }
}

/** The former body of POST /api/strategy/generate. */
export async function generateStrategyWork(args: {
  brand: BrandRow;
  conversation: string;
  conversationId: string | null;
  userId: string;
  sessionId?: string | null;
}): Promise<JobOutcome> {
  const summary = brandSummaryFrom(args.brand);
  const { object } = await generateObject({
    model: getModel("strategy"),
    schema: strategySchema,
    system: buildStrategistSystemPrompt(summary),
    prompt: buildStrategyGenerationPrompt(args.conversation, summary),
  });
  const strategy = await createStrategy({
    brandId: args.brand.id,
    conversationId: args.conversationId,
    name: object.campaignName,
    structured: object,
    status: "active",
  });
  await recordUsageEvent({
    userId: args.userId,
    brandId: args.brand.id,
    kind: "strategy_generated",
    metadata: { strategyId: strategy.id },
  });
  await captureServerEvent({
    distinctId: args.userId,
    event: "strategy_generated",
    properties: {
      brand_id: args.brand.id,
      strategy_id: strategy.id,
      session_id: args.sessionId ?? null,
    },
  });
  return {
    resultId: strategy.id,
    result: { strategy: object, strategyId: strategy.id },
  };
}

/**
 * The former body of POST /api/calendar/generate, now chunked: one fast
 * outline call plans every posting slot, then one small call per ~weekly
 * segment writes that segment's briefs — in parallel, so wall-clock time is
 * the slowest chunk instead of one giant response that could outlive the
 * serverless window.
 */
export async function generateCalendarWork(
  args: {
    brand: BrandRow;
    strategy: StrategyRow;
    structured: Strategy;
    userId: string;
    sessionId?: string | null;
  },
  reportProgress: ReportProgress = () => {},
): Promise<JobOutcome> {
  const summary = brandSummaryFrom(args.brand);
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const model = getModel("strategy");

  reportProgress({ done: 0, total: 1, label: "Planning the calendar…" });
  const { object: outline } = await withRetry(() =>
    generateObject({
      model,
      schema: calendarOutlineSchema,
      system: buildCalendarOutlineSystemPrompt(summary, todayIso),
      prompt: buildCalendarOutlinePrompt(args.structured, summary, todayIso),
    }),
  );

  const segmentCount = outline.segments.length;
  const total = segmentCount + 1;
  let done = 1;
  reportProgress({ done, total, label: "Calendar planned — writing briefs…" });

  // Bounded concurrency: ~13 simultaneous calls (90-day plans) trip provider
  // throttling, which turns into slow retries and blown serverless windows.
  const chunks = await mapWithConcurrency(
    outline.segments,
    3,
    async (segment, i) => {
      const { object } = await withRetry(() =>
        generateObject({
          model,
          schema: calendarChunkSchema,
          system: buildCalendarChunkSystemPrompt(summary),
          prompt: buildCalendarChunkPrompt({
            strategy: args.structured,
            segment,
            segmentNumber: i + 1,
            segmentCount,
          }),
        }),
      );
      done += 1;
      reportProgress({
        done,
        total,
        label: `Writing briefs — week ${done - 1} of ${segmentCount}…`,
      });
      return object;
    },
  );

  const plan = {
    startDate: outline.startDate,
    items: assembleCalendarItems(outline.segments, chunks),
  };

  // Honor the strategy's timeline via the AI-declared (validated) start date.
  const scheduled = toCalendarRows(plan, resolveStartDate(plan.startDate, now));

  const calendar = await createCalendar({
    brandId: args.brand.id,
    strategyId: args.strategy.id,
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
    userId: args.userId,
    brandId: args.brand.id,
    kind: "calendar_generated",
    metadata: { calendarId: calendar.id, items: scheduled.rows.length },
  });
  // Bell notification so completion reaches the user even if every tab with
  // the watcher is gone. Best-effort: the calendar itself already exists.
  try {
    await createNotification({
      userId: args.userId,
      type: "system",
      payload: {
        kind: "calendar_ready",
        calendarId: calendar.id,
        message: "Your content calendar has been generated.",
      },
    });
  } catch (err) {
    console.error("calendar-ready notification failed", err);
  }
  await captureServerEvent({
    distinctId: args.userId,
    event: "calendar_generated",
    properties: {
      brand_id: args.brand.id,
      calendar_id: calendar.id,
      items: scheduled.rows.length,
      session_id: args.sessionId ?? null,
    },
  });
  return { resultId: calendar.id, result: { calendarId: calendar.id } };
}

/** Turn a design-request conversation into a structured brief (not persisted —
 * the client reviews it, then submits it as a design ticket). */
export async function generateDesignBriefWork(args: {
  brand: BrandRow;
  conversation: string;
  userId: string;
  sessionId?: string | null;
}): Promise<JobOutcome> {
  const summary = brandSummaryFrom(args.brand);
  const { object } = await generateObject({
    model: getModel("strategy"),
    schema: designBriefSchema,
    system: buildDesignBriefSystemPrompt(summary),
    prompt: buildDesignBriefGenerationPrompt(args.conversation, summary),
  });
  await captureServerEvent({
    distinctId: args.userId,
    event: "design_brief_generated",
    properties: {
      brand_id: args.brand.id,
      design_type: object.designType,
      session_id: args.sessionId ?? null,
    },
  });
  return { result: { brief: object } };
}

import { generateObject } from "ai";
import {
  type CalendarChunk,
  type CalendarOutline,
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
  getBrandById,
  getGenerationJobById,
  getStrategyById,
  insertCalendarItems,
  recordUsageEvent,
  touchGenerationJob,
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

/** What resumable work gets from the job runner. */
export interface JobRuntime {
  reportProgress: ReportProgress;
  /** Checkpoint persisted by a previous slice (empty object on first run). */
  checkpoint: Record<string, unknown>;
  /** Merge keys into the checkpoint and persist durably (awaited, so a
      killed invocation can never lose acknowledged work). */
  saveCheckpoint(partial: Record<string, unknown>): Promise<void>;
  /** True once the slice's soft deadline passed — stop taking new work. */
  shouldPause(): boolean;
}

/** Thrown by resumable work to end a slice with the job still "running":
    the checkpoint is kept and a later poll relaunches from it. */
export class JobPausedError extends Error {
  constructor() {
    super("Generation paused at the slice deadline");
    this.name = "JobPausedError";
  }
}

/** Refresh updatedAt this often so a single long model call doesn't look
    like a dead worker to the poll route (stale window is 75s). */
const HEARTBEAT_MS = 20_000;

/**
 * Run one slice of generation work against a job row: pending → running →
 * succeeded/failed, or paused (still "running") when the work hits its slice
 * deadline. Never throws — every failure lands on the job row so the polling
 * client always gets a terminal state.
 *
 * While running, the job's `result` column holds `{ progress, checkpoint,
 * resumeCount }` (overwritten by the real result on success): progress feeds
 * the client's loader, the checkpoint lets a fresh invocation continue after
 * a serverless timeout, and every write doubles as a heartbeat.
 */
export async function executeGenerationJob(
  jobId: string,
  work: (runtime: JobRuntime) => Promise<JobOutcome>,
  { softDeadlineMs }: { softDeadlineMs?: number } = {},
): Promise<void> {
  const row = await getGenerationJobById(jobId);
  const prior = (row?.result ?? {}) as {
    progress?: JobProgress;
    checkpoint?: Record<string, unknown>;
    resumeCount?: number;
  };
  // The poll route's atomic claim guarantees a single worker owns the job,
  // so this in-memory copy is the source of truth between writes.
  const state = {
    progress: prior.progress ?? null,
    checkpoint: prior.checkpoint ?? {},
    resumeCount: prior.resumeCount ?? 0,
  };
  const persist = () => updateGenerationJob(jobId, { result: state });

  const deadline = softDeadlineMs ? Date.now() + softDeadlineMs : null;
  const runtime: JobRuntime = {
    reportProgress: (progress) => {
      state.progress = progress;
      // Fire-and-forget: progress is cosmetic, never fail the job over it.
      persist().catch(() => {});
    },
    checkpoint: state.checkpoint,
    saveCheckpoint: async (partial) => {
      Object.assign(state.checkpoint, partial);
      await persist();
    },
    shouldPause: () => deadline !== null && Date.now() > deadline,
  };

  const heartbeat = setInterval(() => {
    touchGenerationJob(jobId).catch(() => {});
  }, HEARTBEAT_MS);

  try {
    await updateGenerationJob(jobId, { status: "running" });
    const outcome = await work(runtime);
    await updateGenerationJob(jobId, {
      status: "succeeded",
      resultId: outcome.resultId,
      result: outcome.result,
    });
  } catch (err) {
    if (err instanceof JobPausedError) {
      // Deliberate slice end: keep status "running"; the persisted
      // checkpoint lets the next poll-triggered slice continue.
      console.log(`generation job ${jobId} paused for resume`);
      await persist().catch(() => {});
      return;
    }
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
  } finally {
    clearInterval(heartbeat);
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

/** Leave ~60s of headroom under Vercel's 300s kill so an in-flight chunk
    can finish and the slice can end cleanly with its checkpoint written. */
export const CALENDAR_SLICE_BUDGET_MS = 240_000;

/** What a calendar job parks in the runtime checkpoint between slices. */
interface CalendarCheckpoint {
  outline?: CalendarOutline;
  /** Completed chunk per segment index (string keys — jsonb round-trip). */
  chunks?: Record<string, CalendarChunk>;
}

/**
 * The former body of POST /api/calendar/generate, now chunked AND resumable:
 * one outline call plans every posting slot, then one small call per ~weekly
 * segment writes that segment's briefs (3 at a time to stay under provider
 * throttling). Outline and finished chunks are checkpointed, so when the
 * slice deadline passes with work remaining the job pauses and a later
 * invocation continues instead of redoing everything — the 300s serverless
 * ceiling stops being fatal.
 */
export async function generateCalendarWork(
  args: {
    brand: BrandRow;
    strategy: StrategyRow;
    structured: Strategy;
    userId: string;
    sessionId?: string | null;
  },
  runtime: JobRuntime,
): Promise<JobOutcome> {
  const { reportProgress } = runtime;
  const checkpoint = runtime.checkpoint as CalendarCheckpoint;
  const summary = brandSummaryFrom(args.brand);
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const model = getModel("strategy");

  let outline = checkpoint.outline;
  if (!outline) {
    reportProgress({ done: 0, total: 1, label: "Planning the calendar…" });
    const { object } = await withRetry(() =>
      generateObject({
        model,
        schema: calendarOutlineSchema,
        system: buildCalendarOutlineSystemPrompt(summary, todayIso),
        prompt: buildCalendarOutlinePrompt(args.structured, summary, todayIso),
      }),
    );
    outline = object;
    await runtime.saveCheckpoint({ outline });
  }
  const segments = outline.segments;
  const startDate = outline.startDate;

  const segmentCount = segments.length;
  const total = segmentCount + 1;
  const chunks: Record<string, CalendarChunk> = { ...checkpoint.chunks };
  let done = 1 + Object.keys(chunks).length;
  reportProgress({ done, total, label: "Calendar planned — writing briefs…" });

  // Only segments this and previous slices haven't finished yet.
  const missing = segments
    .map((_, i) => i)
    .filter((i) => !(String(i) in chunks));

  // Bounded concurrency: ~13 simultaneous calls (90-day plans) trip provider
  // throttling, which turns into slow retries and blown serverless windows.
  await mapWithConcurrency(
    missing,
    3,
    async (i) => {
      const { object } = await withRetry(() =>
        generateObject({
          model,
          schema: calendarChunkSchema,
          system: buildCalendarChunkSystemPrompt(summary),
          prompt: buildCalendarChunkPrompt({
            strategy: args.structured,
            segment: segments[i],
            segmentNumber: i + 1,
            segmentCount,
          }),
        }),
      );
      chunks[String(i)] = object;
      done += 1;
      reportProgress({
        done,
        total,
        label: `Writing briefs — ${Object.keys(chunks).length} of ${segmentCount} weeks done…`,
      });
      await runtime.saveCheckpoint({ chunks });
    },
    { shouldStop: runtime.shouldPause },
  );

  if (Object.keys(chunks).length < segmentCount) {
    // Slice budget hit with segments left: keep the job running and let the
    // next poll-triggered slice pick up the missing chunks.
    throw new JobPausedError();
  }

  const plan = {
    startDate,
    items: assembleCalendarItems(
      segments,
      segments.map((_, i) => chunks[String(i)] ?? null),
    ),
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

/**
 * Continue a calendar job from its checkpoint in a fresh invocation —
 * called (via `after()`) by the poll route when the previous worker went
 * silent. Rebuilds the work args from the job row; if the strategy or brand
 * has vanished, the job fails cleanly.
 */
export async function resumeCalendarJob(job: {
  id: string;
  userId: string;
  brandId: string;
  input: unknown;
}): Promise<void> {
  const strategyId = (job.input as { strategyId?: string } | null)?.strategyId;
  const strategy = strategyId ? await getStrategyById(strategyId) : null;
  const brand = await getBrandById(job.brandId);
  const parsed = strategy
    ? strategySchema.safeParse(strategy.structured)
    : null;
  if (!strategy || !brand || !parsed?.success) {
    await updateGenerationJob(job.id, {
      status: "failed",
      error: "Generation could not be resumed. Please try again.",
    });
    return;
  }
  await executeGenerationJob(
    job.id,
    (runtime) =>
      generateCalendarWork(
        {
          brand,
          strategy,
          structured: parsed.data,
          userId: job.userId,
          sessionId: null,
        },
        runtime,
      ),
    { softDeadlineMs: CALENDAR_SLICE_BUDGET_MS },
  );
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

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

  const sliceStart = Date.now();
  const elapsed = () => `${Math.round((Date.now() - sliceStart) / 1000)}s`;
  console.log(
    `generation job ${jobId}: slice start (resume ${state.resumeCount}, checkpoint: ${Object.keys(state.checkpoint).join(",") || "empty"})`,
  );

  try {
    await updateGenerationJob(jobId, { status: "running" });
    const outcome = await work(runtime);
    await updateGenerationJob(jobId, {
      status: "succeeded",
      resultId: outcome.resultId,
      result: outcome.result,
    });
    console.log(`generation job ${jobId}: succeeded after ${elapsed()}`);
  } catch (err) {
    if (err instanceof JobPausedError) {
      // Deliberate slice end: keep status "running"; the persisted
      // checkpoint lets the next poll-triggered slice continue.
      console.log(
        `generation job ${jobId}: paused for resume after ${elapsed()}`,
      );
      await persist().catch(() => {});
      return;
    }
    console.error(`generation job ${jobId} failed`, err);
    // Raw AI-SDK errors ("No object generated: response did not match
    // schema.") are log material, not something to show a user.
    const message =
      err instanceof Error && err.name === "AI_NoObjectGeneratedError"
        ? "The AI returned an unusable response. Please try again."
        : err instanceof Error
          ? err.message
          : String(err);
    try {
      await updateGenerationJob(jobId, {
        status: "failed",
        error: message,
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

/** Slots per brief-writing call. Small responses generate fast and are far
    less likely to come back truncated or as malformed JSON than one call
    covering a whole ~9-slot segment. */
const MAX_SLOTS_PER_BRIEF_CALL = 4;

/** What a calendar job parks in the runtime checkpoint between slices. */
interface CalendarCheckpoint {
  outline?: CalendarOutline;
  /** Completed briefs per unit ("segIndex:slotStart" keys), slotIndex
      already segment-relative. */
  chunks?: Record<string, CalendarChunk>;
}

/**
 * The former body of POST /api/calendar/generate, now chunked AND resumable:
 * one outline call plans every posting slot, then small brief-writing calls
 * of at most MAX_SLOTS_PER_BRIEF_CALL slots each (3 in flight to stay under
 * provider throttling). Outline and finished units are checkpointed, so when
 * the slice deadline passes with work remaining the job pauses and a later
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
  if (outline) {
    console.log(
      `calendar outline reused from checkpoint (${outline.segments.length} segments)`,
    );
  } else {
    reportProgress({ done: 0, total: 1, label: "Planning the calendar…" });
    const outlineStart = Date.now();
    const { object } = await withRetry(
      () =>
        generateObject({
          model,
          schema: calendarOutlineSchema,
          system: buildCalendarOutlineSystemPrompt(summary, todayIso),
          prompt: buildCalendarOutlinePrompt(
            args.structured,
            summary,
            todayIso,
          ),
          // A 90-day outline is ~80 slots of structured JSON — the provider
          // default cap (4096 on Bedrock) truncates it into schema failures.
          maxOutputTokens: 16_000,
        }),
      3,
      { label: "calendar outline" },
    );
    outline = object;
    await runtime.saveCheckpoint({ outline });
    console.log(
      `calendar outline generated in ${Math.round((Date.now() - outlineStart) / 1000)}s (${outline.segments.length} segments, ${outline.segments.reduce((n, s) => n + s.slots.length, 0)} slots)`,
    );
  }
  const segments = outline.segments;
  const startDate = outline.startDate;
  const segmentCount = segments.length;

  // Brief-writing is split into units of a few slots each: small JSON
  // responses generate fast and are far less likely to come back malformed
  // or truncated than one 9-brief response. Unit key = "segIndex:slotStart";
  // briefs are stored with segment-relative slotIndex so assembly is
  // unchanged.
  const units = segments.flatMap((segment, segIndex) => {
    const out: Array<{ key: string; segIndex: number; slotStart: number }> = [];
    for (let s = 0; s < segment.slots.length; s += MAX_SLOTS_PER_BRIEF_CALL) {
      out.push({ key: `${segIndex}:${s}`, segIndex, slotStart: s });
    }
    return out;
  });
  const chunks: Record<string, CalendarChunk> = { ...checkpoint.chunks };
  const doneUnits = () => units.filter((u) => u.key in chunks).length;
  const total = units.length + 1;
  reportProgress({
    done: 1 + doneUnits(),
    total,
    label: "Calendar planned — writing briefs…",
  });

  // Only units this and previous slices haven't finished yet.
  const missing = units.filter((u) => !(u.key in chunks));

  // Bounded concurrency: too many simultaneous calls trip provider
  // throttling, which turns into slow retries and blown serverless windows.
  await mapWithConcurrency(
    missing,
    3,
    async (unit) => {
      const segment = segments[unit.segIndex];
      const unitSlots = segment.slots.slice(
        unit.slotStart,
        unit.slotStart + MAX_SLOTS_PER_BRIEF_CALL,
      );
      const unitStart = Date.now();
      let object: CalendarChunk;
      try {
        ({ object } = await withRetry(
          () =>
            generateObject({
              model,
              schema: calendarChunkSchema,
              system: buildCalendarChunkSystemPrompt(summary),
              prompt: buildCalendarChunkPrompt({
                strategy: args.structured,
                segment: { theme: segment.theme, slots: unitSlots },
                segmentNumber: unit.segIndex + 1,
                segmentCount,
              }),
              // Multi-section briefs blow past the provider default output
              // cap (4096 on Bedrock); a truncated response fails the schema.
              maxOutputTokens: 20_000,
            }),
          3,
          { label: `calendar unit ${unit.key}` },
        ));
      } catch (err) {
        // Every retry failed: give this unit's slots fallback briefs at
        // assembly instead of sinking the whole calendar. Loud log — the
        // per-attempt warnings above carry the raw evidence.
        console.error(
          `calendar unit ${unit.key} failed permanently — falling back to template briefs`,
          err instanceof Error ? err.message : err,
        );
        object = { briefs: [] };
      }
      console.log(
        `calendar unit ${unit.key} (${unitSlots.length} slots) finished in ${Math.round((Date.now() - unitStart) / 1000)}s`,
      );
      // Model slotIndex is relative to the slots it saw; remap to the
      // segment-relative index that assembly expects.
      chunks[unit.key] = {
        briefs: object.briefs.map((b) => ({
          ...b,
          slotIndex: unit.slotStart + b.slotIndex,
        })),
      };
      reportProgress({
        done: 1 + doneUnits(),
        total,
        label: `Writing briefs — ${doneUnits()} of ${units.length} done…`,
      });
      await runtime.saveCheckpoint({ chunks });
    },
    { shouldStop: runtime.shouldPause },
  );

  if (doneUnits() < units.length) {
    // Slice budget hit with units left: keep the job running and let the
    // next poll-triggered slice pick up the missing ones.
    console.log(
      `calendar slice pausing with ${units.length - doneUnits()} of ${units.length} units remaining`,
    );
    throw new JobPausedError();
  }

  // A stray fallback is graceful degradation; briefs failing wholesale means
  // something systemic (provider/schema) — surface that instead of quietly
  // delivering a calendar of template briefs.
  const failedUnits = units.filter(
    (u) => chunks[u.key]?.briefs.length === 0,
  ).length;
  if (failedUnits > units.length / 2) {
    throw new Error(
      "Calendar brief generation is failing repeatedly. Please try again.",
    );
  }

  // Merge unit briefs back into one chunk per segment for assembly.
  const perSegment: (CalendarChunk | null)[] = segments.map((_, segIndex) => ({
    briefs: units
      .filter((u) => u.segIndex === segIndex)
      .flatMap((u) => chunks[u.key]?.briefs ?? []),
  }));

  const plan = {
    startDate,
    items: assembleCalendarItems(segments, perSegment),
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

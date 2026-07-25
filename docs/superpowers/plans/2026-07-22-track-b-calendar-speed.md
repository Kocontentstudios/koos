# Track B — Calendar Generation Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a generated calendar usable within ~40 seconds instead of ~5 minutes, and remove the dead 75-second stall that every slice handoff currently pays.

**Architecture:** Two changes to `src/lib/jobs/run-generation.ts` and its supporting queries. **B1** marks a deliberately-paused job with a `paused` flag so the poll route resumes it on the very next poll (≤3s) instead of waiting out the 75s death-detection window. **B2** writes the calendar and its items straight from the outline pass with `brief` left null, then fills briefs per unit as they land — so the calendar exists and is navigable long before every brief is written.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Postgres jsonb, Vitest.

## Global Constraints

- Package manager is `corepack pnpm` — the PATH `pnpm` is a Windows binary and crashes installs. Never use `npm install`.
- Tests: `corepack pnpm test`. Lint: `corepack pnpm lint`. Both must pass before every commit.
- Comment norms (`CLAUDE.md`): no "what" comments, only "why" comments. Never comment out old code — delete it.
- **No database migration.** `calendar_items.brief` is already nullable (`schema.ts:358`), so a null brief is a valid pending state today.
- Job state lives in the `generation_jobs.result` jsonb column alongside `progress`, `checkpoint` and `resumeCount`. Do not add columns.
- No new dependencies.

## Key facts this plan depends on

- `calendar_items.brief` is `text("brief")` — **nullable**. No migration needed for a pending state.
- `insertCalendarItems` returns inserted rows in input order, so ids can be zipped back onto the plan rows that produced them.
- `claimStaleGenerationJob` bumps `resumeCount`. A deliberate pause must **not** consume a resume attempt — `MAX_RESUMES = 3` exists to bound genuine worker deaths, and a legitimate 90-day calendar needs 2–3 pauses. This is why B4 (raising `MAX_RESUMES`) is unnecessary once B1 lands.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/jobs/stale.ts` | Add `isPausedForResume` to the pure stale/resume policy |
| `src/lib/jobs/stale.test.ts` | Extend with paused-flag cases |
| `src/lib/db/queries/index.ts` | Add `claimPausedGenerationJob`, `updateCalendarItemBriefs` |
| `src/app/api/jobs/[id]/route.ts` | Resume immediately on the paused flag |
| `src/lib/ai/calendar-schema.ts` | Add the internal `slotKey` carried onto item plans |
| `src/lib/jobs/calendar-assembly.ts` | Emit `slotKey` from `assembleCalendarItems` |
| `src/lib/calendar/schedule.ts` | Carry `slotKey` through `toCalendarRows` |
| `src/lib/jobs/run-generation.ts` | Outline-first writes, per-unit brief fills, paused marker |
| `src/app/(dashboard)/calendar/calendar-item-drawer.tsx` | Brief-pending state |

---

### Task 1: Paused-resume policy (pure)

**Files:**
- Modify: `src/lib/jobs/stale.ts`
- Test: `src/lib/jobs/stale.test.ts`

**Interfaces:**
- Produces: `isPausedForResume(result: unknown): boolean`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/jobs/stale.test.ts`:

```ts
import { isPausedForResume } from "./stale";

describe("isPausedForResume", () => {
  it("is true when the worker parked a deliberate pause", () => {
    expect(isPausedForResume({ paused: true })).toBe(true);
  });

  it("is false once the flag is cleared by a claim", () => {
    expect(isPausedForResume({ paused: false })).toBe(false);
  });

  it("is false for a job that never paused", () => {
    expect(isPausedForResume({ progress: { done: 1, total: 4 } })).toBe(false);
  });

  it("is false for null or non-object state", () => {
    expect(isPausedForResume(null)).toBe(false);
    expect(isPausedForResume("paused")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/jobs/stale.test.ts`
Expected: FAIL — `isPausedForResume is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/lib/jobs/stale.ts`:

```ts
/**
 * A worker that ends a slice deliberately parks `paused: true` in the job's
 * jsonb state. Unlike silence, this is positive evidence that the job is
 * ready to continue right now, so the poll route resumes it immediately
 * instead of waiting out the death-detection window.
 */
export function isPausedForResume(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    (result as { paused?: unknown }).paused === true
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/lib/jobs/stale.test.ts`
Expected: PASS

- [ ] **Step 5: Lint and commit**

```bash
corepack pnpm lint
git add src/lib/jobs/stale.ts src/lib/jobs/stale.test.ts
git commit -m "feat: paused-for-resume job state predicate"
```

---

### Task 2: Atomic claim for a paused job

**Files:**
- Modify: `src/lib/db/queries/index.ts` (beside `claimStaleGenerationJob`, ~line 821)

**Interfaces:**
- Produces: `claimPausedGenerationJob(id: string): Promise<GenerationJobRow | null>`

**Why no unit test:** this is a single SQL statement whose correctness is the atomicity of the `WHERE` clause — untestable without a live Postgres, and the repo has no DB-integration test harness. Task 4's manual verification covers it.

- [ ] **Step 1: Write the implementation**

Add to `src/lib/db/queries/index.ts`, directly after `claimStaleGenerationJob`:

```ts
/**
 * Atomically claim a job that a worker paused deliberately. Clearing the
 * flag inside the UPDATE makes concurrent pollers race safely: exactly one
 * gets the row back. Unlike a stale claim this does NOT bump resumeCount —
 * MAX_RESUMES bounds genuine worker deaths, and a 90-day calendar
 * legitimately pauses several times.
 */
export async function claimPausedGenerationJob(id: string) {
  const [row] = await db
    .update(generationJobs)
    .set({
      updatedAt: new Date(),
      result: sql`jsonb_set(
        coalesce(${generationJobs.result}, '{}'::jsonb),
        '{paused}',
        'false'::jsonb
      )`,
    })
    .where(
      and(
        eq(generationJobs.id, id),
        inArray(generationJobs.status, ["pending", "running"]),
        sql`${generationJobs.result}->>'paused' = 'true'`,
      ),
    )
    .returning();
  return row ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
corepack pnpm lint
git add src/lib/db/queries/index.ts
git commit -m "feat: atomic claim for deliberately paused generation jobs"
```

---

### Task 3: Park the paused flag when a slice ends

**Files:**
- Modify: `src/lib/jobs/run-generation.ts:169-211` (the `executeGenerationJob` try/catch)

**Interfaces:**
- Consumes: nothing new
- Produces: jobs whose jsonb state carries `paused: true` after a deliberate slice end, and `sliceCount` bounding total slices

- [ ] **Step 1: Add slice accounting to the in-memory state**

In `executeGenerationJob`, the `prior` destructure and `state` object currently read:

```ts
  const prior = (row?.result ?? {}) as {
    progress?: JobProgress;
    checkpoint?: Record<string, unknown>;
    resumeCount?: number;
  };
  const state = {
    progress: prior.progress ?? null,
    checkpoint: prior.checkpoint ?? {},
    resumeCount: prior.resumeCount ?? 0,
  };
```

Replace with:

```ts
  const prior = (row?.result ?? {}) as {
    progress?: JobProgress;
    checkpoint?: Record<string, unknown>;
    resumeCount?: number;
    sliceCount?: number;
  };
  const state = {
    progress: prior.progress ?? null,
    checkpoint: prior.checkpoint ?? {},
    resumeCount: prior.resumeCount ?? 0,
    sliceCount: (prior.sliceCount ?? 0) + 1,
    paused: false,
  };
```

- [ ] **Step 2: Add the slice ceiling constant**

Add above `executeGenerationJob`, next to `HEARTBEAT_MS`:

```ts
/** Backstop against a job that pauses forever without making progress.
    A 90-day calendar needs 2-3 slices; 10 is far above any real run. */
const MAX_SLICES = 10;
```

- [ ] **Step 3: Mark the pause instead of exiting silently**

The `JobPausedError` branch currently reads:

```ts
    if (err instanceof JobPausedError) {
      console.log(
        `generation job ${jobId}: paused for resume after ${elapsed()}`,
      );
      await persist().catch(() => {});
      return;
    }
```

Replace with:

```ts
    if (err instanceof JobPausedError) {
      if (state.sliceCount >= MAX_SLICES) {
        console.error(
          `generation job ${jobId}: hit the ${MAX_SLICES}-slice ceiling without finishing`,
        );
        await updateGenerationJob(jobId, {
          status: "failed",
          error: "Generation is taking longer than expected. Please try again.",
        }).catch(() => {});
        return;
      }
      // Positive evidence the job is ready to continue NOW. Without this the
      // poll route waits out CALENDAR_STALE_MS (75s) of silence before it
      // will treat a deliberate handoff as resumable.
      state.paused = true;
      console.log(
        `generation job ${jobId}: paused for resume after ${elapsed()} (slice ${state.sliceCount})`,
      );
      await persist().catch(() => {});
      return;
    }
```

- [ ] **Step 4: Verify existing job tests still pass**

Run: `corepack pnpm vitest run src/lib/jobs/run-generation.test.ts`
Expected: PASS.

The existing pause test asserts `updateGenerationJob` was called with the persisted state. That state now carries two extra keys, so an assertion written as an exact object match will fail. Change any such assertion to `expect.objectContaining({ checkpoint: ... })` rather than widening the expected object — the point of the test is the checkpoint, not the bookkeeping fields.

Add one new test pinning the new behavior:

```ts
it("marks a deliberately paused slice as ready to resume", async () => {
  await executeGenerationJob(
    "job-1",
    async () => {
      throw new JobPausedError();
    },
    { softDeadlineMs: 1 },
  );

  const persisted = vi
    .mocked(updateGenerationJob)
    .mock.calls.map(([, patch]) => patch)
    .findLast((patch) => patch.result !== undefined);
  expect(persisted?.result).toMatchObject({ paused: true, sliceCount: 1 });
});
```

- [ ] **Step 5: Lint and commit**

```bash
corepack pnpm lint
git add src/lib/jobs/run-generation.ts
git commit -m "feat: mark deliberately paused calendar slices for immediate resume"
```

---

### Task 4: Resume immediately on the paused flag

**Files:**
- Modify: `src/app/api/jobs/[id]/route.ts`

**Interfaces:**
- Consumes: `isPausedForResume` (Task 1), `claimPausedGenerationJob` (Task 2)

- [ ] **Step 1: Add the imports**

```ts
import {
  claimPausedGenerationJob,
  claimStaleGenerationJob,
  getGenerationJobById,
  updateGenerationJob,
} from "@/lib/db/queries";
import {
  isPausedForResume,
  resolveStaleAction,
  resumeCountFrom,
  staleMsFor,
} from "@/lib/jobs/stale";
```

- [ ] **Step 2: Insert the paused branch before the stale branch**

Directly after the `resolveStaleAction` call and before `if (action === "fail")`, insert:

```ts
  // A deliberately paused job is ready now — resume without waiting for it
  // to look dead. Checked before the stale branch so a pause that also went
  // silent still takes the cheap path and keeps its resume budget.
  if (isPausedForResume(job.result)) {
    const claimed = await claimPausedGenerationJob(job.id);
    if (claimed) {
      console.log(`continuing paused generation job ${job.id}`);
      after(() =>
        resumeCalendarJob(claimed).catch((err) => {
          console.error(
            `continuation of generation job ${job.id} crashed`,
            err,
          );
        }),
      );
    }
    return Response.json({
      status: job.status,
      kind: job.kind,
      result: null,
      error: null,
      progress: progressFrom(job.result),
    });
  }
```

- [ ] **Step 3: Typecheck and lint**

Run: `corepack pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors

Run: `corepack pnpm lint`
Expected: no errors

- [ ] **Step 4: Manual verification**

Use the `verify` skill to launch the dev server, then generate a calendar from a strategy with a 90-day timeline. In the server logs, confirm:
- `generation job <id>: paused for resume after ...s (slice 1)`
- `continuing paused generation job <id>` follows within ~3 seconds, **not** ~75.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/jobs/[id]/route.ts"
git commit -m "feat: resume paused calendar jobs on the next poll"
```

---

### Task 5: Carry a stable slot key onto item plans

**Files:**
- Modify: `src/lib/ai/calendar-schema.ts`
- Modify: `src/lib/jobs/calendar-assembly.ts`
- Modify: `src/lib/calendar/schedule.ts`
- Test: `src/lib/jobs/calendar-assembly.test.ts`

**Interfaces:**
- Produces: `CalendarItemPlan.slotKey: string` (format `"<segIndex>:<slotIndex>"`), carried through `CalendarRow.slotKey`

**Why:** Task 6 must map a finished brief unit back to the calendar item rows it belongs to. `toCalendarRows` re-sorts by (date, time), so positional matching is unsafe. A key assigned at assembly and carried through the sort makes the mapping exact.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/jobs/calendar-assembly.test.ts`:

```ts
describe("assembleCalendarItems slot keys", () => {
  it("assigns a segment-and-slot key to every item", () => {
    const segments = [
      {
        theme: "Launch",
        slots: [
          {
            dayOffset: 0,
            time: "9:00 AM",
            platform: "Instagram",
            contentType: "post",
            title: "A",
            designRequired: false,
          },
          {
            dayOffset: 1,
            time: "9:00 AM",
            platform: "Instagram",
            contentType: "post",
            title: "B",
            designRequired: false,
          },
        ],
      },
      {
        theme: "Grow",
        slots: [
          {
            dayOffset: 7,
            time: "9:00 AM",
            platform: "Instagram",
            contentType: "post",
            title: "C",
            designRequired: false,
          },
        ],
      },
    ];
    const items = assembleCalendarItems(segments, [null, null]);
    expect(items.map((i) => i.slotKey)).toEqual(["0:0", "0:1", "1:0"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/jobs/calendar-assembly.test.ts`
Expected: FAIL — `slotKey` is `undefined` on every item

- [ ] **Step 3: Add `slotKey` to the item plan type**

In `src/lib/ai/calendar-schema.ts`, replace both the `CalendarItemPlan` and `CalendarPlan` type exports:

```ts
export type CalendarItemPlan = z.infer<typeof calendarItemPlanSchema>;
export type CalendarPlan = z.infer<typeof calendarPlanSchema>;
```

with:

```ts
/** Server-assigned identity for a planned item, stable across the (date,
 * time) re-sort in toCalendarRows. Never comes from the model — it is how a
 * finished brief unit finds the rows it belongs to. */
export type CalendarItemPlan = z.infer<typeof calendarItemPlanSchema> & {
  slotKey: string;
};

/** Items carry the server-assigned slotKey, so the plan type cannot be a
 * plain z.infer of the schema — the schema describes only what the model
 * returns. */
export type CalendarPlan = Omit<z.infer<typeof calendarPlanSchema>, "items"> & {
  items: CalendarItemPlan[];
};
```

Leave the `calendarPlanSchema` and `calendarItemPlanSchema` Zod objects themselves unchanged — `slotKey` is never parsed from model output.

- [ ] **Step 4: Emit the key from assembly**

In `src/lib/jobs/calendar-assembly.ts`, the `assembleCalendarItems` return currently reads:

```ts
    return segment.slots.map((slot, j) => ({
      ...slot,
      brief: briefBySlot.get(j) ?? fallbackBrief(slot),
    }));
```

Replace with:

```ts
    return segment.slots.map((slot, j) => ({
      ...slot,
      slotKey: `${i}:${j}`,
      brief: briefBySlot.get(j) ?? fallbackBrief(slot),
    }));
```

- [ ] **Step 5: Carry the key through scheduling**

In `src/lib/calendar/schedule.ts`, add the field to `CalendarRow`:

```ts
export interface CalendarRow {
  date: Date;
  time: string;
  platform: string;
  contentType: string;
  title: string;
  brief: string;
  designRequired: boolean;
  designType?: string;
  dimensions?: string;
  sortOrder: number;
  slotKey: string;
}
```

`toCalendarRows` spreads each item plan, so `slotKey` flows through without further change.

- [ ] **Step 6: Run tests to verify they pass**

Run: `corepack pnpm test`
Expected: PASS — no regressions

- [ ] **Step 7: Lint and commit**

```bash
corepack pnpm lint
git add src/lib/ai/calendar-schema.ts src/lib/jobs/calendar-assembly.ts src/lib/calendar/schedule.ts src/lib/jobs/calendar-assembly.test.ts
git commit -m "feat: stable slot keys on planned calendar items"
```

---

### Task 6: Write the calendar from the outline, fill briefs per unit

**Files:**
- Modify: `src/lib/db/queries/index.ts`
- Modify: `src/lib/jobs/run-generation.ts` (`generateCalendarWork`)

**Interfaces:**
- Consumes: `slotKey` from Task 5
- Produces: `updateCalendarItemBriefs(updates: { id: string; brief: string }[]): Promise<void>`; checkpoint gains `calendarId` and `itemIdsBySlotKey`

- [ ] **Step 1: Add the bulk brief update query**

Add to `src/lib/db/queries/index.ts`, near `updateCalendarItem`:

```ts
/** Fill in briefs for items whose slots have finished generating. Sequential
    rather than a single CASE statement: batches are small (at most 4 slots)
    and one failed row must not lose the others. */
export async function updateCalendarItemBriefs(
  updates: { id: string; brief: string }[],
): Promise<void> {
  for (const { id, brief } of updates) {
    await db
      .update(calendarItems)
      .set({ brief, updatedAt: new Date() })
      .where(eq(calendarItems.id, id));
  }
}
```

- [ ] **Step 2: Extend the calendar checkpoint type**

In `src/lib/jobs/run-generation.ts`, replace the `CalendarCheckpoint` interface:

```ts
interface CalendarCheckpoint {
  outline?: CalendarOutline;
  chunks?: Record<string, CalendarChunk>;
  /** Calendar row written straight after the outline pass. */
  calendarId?: string;
  /** slotKey -> calendar_items.id, so a finished unit can fill its briefs. */
  itemIdsBySlotKey?: Record<string, string>;
}
```

- [ ] **Step 3: Write the calendar immediately after the outline**

In `generateCalendarWork`, directly after the outline block (after `const segmentCount = segments.length;`), insert:

```ts
  // The outline already carries every date, platform, time, title and design
  // flag. Writing it now makes the calendar usable in ~40s instead of ~5min,
  // and means a job that later fails still leaves a real schedule behind.
  let calendarId = checkpoint.calendarId;
  let itemIdsBySlotKey = checkpoint.itemIdsBySlotKey;
  if (!calendarId || !itemIdsBySlotKey) {
    // Passing all-null chunks means every item comes back with a fallback
    // brief; those are discarded below in favour of an explicit null. The
    // call is here for its slot fields and slotKeys, not its briefs.
    const skeleton = {
      startDate,
      items: assembleCalendarItems(
        segments,
        segments.map(() => null),
      ),
    };
    const scheduled = toCalendarRows(skeleton, resolveStartDate(startDate, now));
    const calendar = await createCalendar({
      brandId: args.brand.id,
      strategyId: args.strategy.id,
      startDate: scheduled.startDate,
      endDate: scheduled.endDate,
    });
    const inserted = await insertCalendarItems(
      scheduled.rows.map((r) => ({
        calendarId: calendar.id,
        date: r.date,
        time: r.time,
        platform: r.platform,
        contentType: r.contentType,
        title: r.title,
        // Null brief IS the pending state — the column is nullable and the
        // drawer renders "writing brief" for it.
        brief: null,
        designRequired: r.designRequired,
        designType: r.designType,
        dimensions: r.dimensions,
        sortOrder: r.sortOrder,
      })),
    );
    calendarId = calendar.id;
    itemIdsBySlotKey = Object.fromEntries(
      // insertCalendarItems returns rows in input order.
      scheduled.rows.map((r, i) => [r.slotKey, inserted[i].id]),
    );
    await runtime.saveCheckpoint({ calendarId, itemIdsBySlotKey });
    console.log(
      `calendar ${calendarId} written from outline with ${inserted.length} items (briefs pending)`,
    );
  }
```

- [ ] **Step 4: Fill briefs as each unit lands**

Inside the `mapWithConcurrency` callback, directly after `chunks[unit.key] = { ... }` and before `reportProgress`, insert:

```ts
      const segmentSlotCount = segment.slots.length;
      const filled = chunks[unit.key].briefs
        .filter((b) => b.slotIndex < segmentSlotCount)
        .map((b) => ({
          id: itemIdsBySlotKey[`${unit.segIndex}:${b.slotIndex}`],
          brief: b.brief,
        }))
        .filter((u) => Boolean(u.id));
      await updateCalendarItemBriefs(filled);
```

- [ ] **Step 5: Replace the tail with fallback fills**

The block from `// Merge unit briefs back into one chunk per segment for assembly.` through the `insertCalendarItems(...)` call currently rebuilds and inserts the whole calendar. Replace that entire block with:

```ts
  // Any slot whose unit failed permanently still needs an executable brief.
  // Filling before the systemic-failure check means the user always ends up
  // with a complete calendar, even when the job itself reports failure.
  const perSegment: (CalendarChunk | null)[] = segments.map((_, segIndex) => ({
    briefs: units
      .filter((u) => u.segIndex === segIndex)
      .flatMap((u) => chunks[u.key]?.briefs ?? []),
  }));
  const briefedSlotKeys = new Set(
    segments.flatMap((_, segIndex) =>
      (perSegment[segIndex]?.briefs ?? []).map(
        (b) => `${segIndex}:${b.slotIndex}`,
      ),
    ),
  );
  const fallbacks = assembleCalendarItems(segments, perSegment)
    .filter((item) => !briefedSlotKeys.has(item.slotKey))
    .map((item) => ({
      id: itemIdsBySlotKey[item.slotKey],
      brief: item.brief,
    }))
    .filter((u) => Boolean(u.id));
  await updateCalendarItemBriefs(fallbacks);

  const failedUnits = units.filter(
    (u) => chunks[u.key]?.briefs.length === 0,
  ).length;
  if (failedUnits > units.length / 2) {
    throw new Error(
      "Calendar brief generation is failing repeatedly. Please try again.",
    );
  }

  const itemCount = Object.keys(itemIdsBySlotKey).length;
```

Then replace the trailing `recordUsageEvent` / notification / analytics block — which currently references `calendar.id` and `scheduled.rows.length`, both now out of scope at this point in the function — with:

```ts
  await recordUsageEvent({
    userId: args.userId,
    brandId: args.brand.id,
    kind: "calendar_generated",
    metadata: { calendarId, items: itemCount },
  });
  // Bell notification so completion reaches the user even if every tab with
  // the watcher is gone. Best-effort: the calendar itself already exists.
  try {
    await createNotification({
      userId: args.userId,
      type: "system",
      payload: {
        kind: "calendar_ready",
        calendarId,
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
      calendar_id: calendarId,
      items: itemCount,
      session_id: args.sessionId ?? null,
    },
  });
  return { resultId: calendarId, result: { calendarId } };
```

- [ ] **Step 6: Surface the calendar id in progress**

So the client can offer "view your calendar" before briefs finish, change the post-outline `reportProgress` call to carry it. In `JobProgress` (`run-generation.ts:80`) add:

```ts
export interface JobProgress {
  done: number;
  total: number;
  label: string;
  /** Present once the calendar exists, before briefs are complete. */
  calendarId?: string;
}
```

and mirror the same optional field in `src/lib/generation/poll-job.ts`'s `JobProgress` interface.

Then add `calendarId` to the two `reportProgress` calls that run after the calendar exists. The post-outline call becomes:

```ts
  reportProgress({
    done: 1 + doneUnits(),
    total,
    label: "Calendar planned — writing briefs…",
    calendarId,
  });
```

and the per-unit call inside `mapWithConcurrency` becomes:

```ts
      reportProgress({
        done: 1 + doneUnits(),
        total,
        label: `Writing briefs — ${doneUnits()} of ${units.length} done…`,
        calendarId,
      });
```

Leave the pre-outline `"Planning the calendar…"` call unchanged — no calendar exists yet.

- [ ] **Step 7: Run the full suite**

Run: `corepack pnpm test`
Expected: PASS. `run-generation.test.ts` mocks the DB queries — add `updateCalendarItemBriefs` to its mocks and assert that `insertCalendarItems` is called with `brief: null`.

- [ ] **Step 8: Lint and commit**

```bash
corepack pnpm lint
git add src/lib/db/queries/index.ts src/lib/jobs/run-generation.ts src/lib/generation/poll-job.ts src/lib/jobs/run-generation.test.ts
git commit -m "feat: write calendars from the outline and stream briefs in"
```

---

### Task 7: Brief-pending state in the calendar UI

**Files:**
- Modify: `src/app/(dashboard)/calendar/calendar-item-drawer.tsx:210-215`

**Interfaces:**
- Consumes: `item.brief` being `null` while a brief is still generating

- [ ] **Step 1: Render the pending state**

The drawer currently renders the brief only when present:

```tsx
              {item.brief && (
```

Replace that conditional block's opening so a null brief shows progress instead of nothing:

```tsx
              {item.brief ? (
                <div className="border-t border-[var(--divider)] py-3">
                  <Markdown className="text-[13px]">{item.brief}</Markdown>
                </div>
              ) : (
                <div className="border-t border-[var(--divider)] py-3">
                  <p className="text-[13px] italic text-[var(--text-muted)]">
                    KO is still writing this brief. It will appear here
                    shortly — the rest of the item is ready to use now.
                  </p>
                </div>
              )}
```

Match the surrounding markup exactly when replacing; the existing block already wraps `Markdown` in a `border-t` container.

- [ ] **Step 2: Run the full suite and lint**

Run: `corepack pnpm test`
Expected: PASS

Run: `corepack pnpm lint`
Expected: no errors

- [ ] **Step 3: Manual verification**

Use the `verify` skill to launch the dev server, then generate a 90-day calendar and, while it is still running, open `/calendar`. Confirm:
- The calendar renders with all items within ~40 seconds.
- Opening an item whose brief has not landed shows the pending copy.
- Briefs appear on refresh as units complete.
- The job eventually reaches `succeeded` and no item is left with a null brief.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/calendar/calendar-item-drawer.tsx"
git commit -m "feat: show a pending state for briefs still being written"
```

---

## Out of scope

- A separate faster model tier for brief-writing (`AI_CALENDAR_MODEL`). Deferred
  pending production logs.
- Raising `MAX_RESUMES`. Task 2 deliberately does not consume a resume
  attempt for a planned pause, which removes the pressure that motivated it.
- Shortening the 90-day calendar window.
- Live-updating the calendar page as briefs land (requires polling or
  streaming on the calendar route; a refresh suffices for now).

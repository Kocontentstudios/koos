# Platform Upgrades (12 items) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 12 approved platform upgrades: clickable dashboard stats, calendar month-view default, AI-assisted design-request chat mode, fresh-chat-by-default, AI chat titles, strategy-driven calendar timelines, structured briefs, mobile chat wrapping, and PostHog analytics.

**Architecture:** Five independent workstreams (A–E) on `feat/upgrades-001`, one commit each. The design-request flow reuses the existing strategy chat workspace behind a `mode` flag; calendar timelines move from a hardcoded 14-day/next-Monday window to an AI-declared `startDate` + up to 90 `dayOffset`s validated server-side; PostHog is wired behind env vars so it is a no-op until keys exist.

**Tech Stack:** Next.js 15 App Router, Vercel AI SDK (`streamText`/`generateObject`), Drizzle + Postgres (hand-written SQL migrations via `scripts/migrate.mjs`), zod, vitest, biome. New deps: `posthog-js`, `posthog-node`.

**Spec:** `docs/superpowers/specs/2026-07-11-platform-upgrades-design.md`

## Global Constraints

- Branch: `feat/upgrades-001`; one commit per task; conventional commit messages.
- Migrations: hand-written SQL in `drizzle/NNNN_name.sql` (next number: `0009`); never `db:push`; `drizzle/meta` is gitignored.
- All new UI copy/styling must use theme tokens (`--status-*-fg`, `var(--text-*)`) — no hardcoded light/dark hexes.
- Verify per task: `npx vitest run <touched tests>`; full gate at the end: `npm run lint && npx tsc --noEmit && npx vitest run`.
- PostHog must be a silent no-op when `NEXT_PUBLIC_POSTHOG_KEY` is unset.
- Calendar cap: 90 days (`dayOffset` 0–89). Duration-only strategies start **today** (UTC).

---

### Task A: Quick wins (items 1, 2, 3, 7, 9, 11)

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx` (hero stats + CTA)
- Modify: `src/app/(dashboard)/calendar/calendar-client.tsx:75`
- Modify: `src/app/(dashboard)/strategy/strategy-history.tsx:78`
- Modify: `src/app/(dashboard)/calendar/calendar-item-drawer.tsx:212,309`
- Modify: `src/app/(dashboard)/strategy/message-list.tsx`
- Modify: `src/components/ui/markdown.tsx` (overflow containment)

**Interfaces:** none produced; pure UI edits.

- [ ] **Step A1: Clickable hero stats.** In `dashboard/page.tsx`, wrap the two `setupComplete` stat blocks in `Link`s (keep inner markup identical):

```tsx
<Link
  href="/calendar"
  className="group flex items-center gap-3 rounded-xl -m-2 p-2 transition-colors hover:bg-white/10"
>
  {/* existing icon + count + "Posts this week" markup */}
</Link>
<Link
  href="/design-request"
  className="group flex items-center gap-3 rounded-xl -m-2 p-2 transition-colors hover:bg-white/10"
>
  {/* existing icon + count + "Open design tickets" markup */}
</Link>
```

- [ ] **Step A2: Remove duplicate calendar CTA.** Same file: render the hero CTA link only during setup:

```tsx
{!setupComplete && (
  <Link href={setup.nextCta.href} className="...unchanged...">
    {setup.nextCta.label} <ArrowRight size={16} />
  </Link>
)}
```

- [ ] **Step A3: Month view default.** `calendar-client.tsx`: `parseAsStringLiteral(VIEWS).withDefault("week")` → `.withDefault("month")`.

- [ ] **Step A4: Rename button.** `strategy-history.tsx`: button text `New Strategy` → `New Chat`.

- [ ] **Step A5: Rename labels.** `calendar-item-drawer.tsx`: both `label="Caption / Brief"` → `label="Brief"`.

- [ ] **Step A6: Mobile wrapping.** `message-list.tsx`: on the bubble div add `min-w-0` and `break-words`; the flex row wrapper keeps `max-w-[85%]`. In `markdown.tsx`, ensure `pre` renders inside `overflow-x-auto max-w-full` and `table` inside a `div.overflow-x-auto`; add `break-words` on `p`/`li`. (Inspect the tail of markdown.tsx first; add `pre`/`code`/`table` component overrides if missing.)

- [ ] **Step A7: Verify + commit.**

```bash
npm run lint && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(dashboard,calendar,chat): quick wins — clickable stats, month default, renames, mobile wrap"
```

---

### Task B: Fresh chat by default + AI titles (items 5, 6)

**Files:**
- Modify: `src/app/(dashboard)/strategy/page.tsx` (stop loading latest conversation)
- Modify: `src/app/api/chat/ensure-conversation.ts` (+`created` flag, title helpers)
- Create: `src/app/api/chat/title.ts` (title prompt + sanitizer)
- Test: `src/app/api/chat/title.test.ts`
- Modify: `src/app/api/chat/route.ts` (fire title generation in onFinish)
- Modify: `src/lib/db/queries/index.ts` (add `updateConversationTitle`)

**Interfaces:**
- Produces: `updateConversationTitle(id: string, title: string): Promise<void>`; `cleanGeneratedTitle(raw: string): string | null`; `buildTitlePrompt(userText: string, assistantText: string): string`; `ensureConversation` result gains `created: boolean` on ok.

- [ ] **Step B1: Fresh chat.** `strategy/page.tsx`: delete the `getLatestConversationForBrand` / `getConversationMessages` / `rowsToUiMessages` usage; pass `initialMessages={[]}` and `initialConversationId={null}` (client already mints a UUID when null). Keep `getRecentConversationsForBrand` for the history list. Remove now-unused imports.

- [ ] **Step B2: Failing test for title sanitizer** (`title.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { cleanGeneratedTitle } from "./title";

describe("cleanGeneratedTitle", () => {
  it("strips quotes/markdown and trailing punctuation", () => {
    expect(cleanGeneratedTitle('"30-Day Launch Awareness Content Plan."')).toBe(
      "30-Day Launch Awareness Content Plan",
    );
  });
  it("collapses whitespace and caps at 80 chars", () => {
    const long = `A ${"very ".repeat(40)}long title`;
    expect(cleanGeneratedTitle(long)?.length).toBeLessThanOrEqual(80);
  });
  it("returns null for empty output", () => {
    expect(cleanGeneratedTitle("  \n ")).toBeNull();
  });
});
```

- [ ] **Step B3: Implement `title.ts`**:

```ts
export function buildTitlePrompt(userText: string, assistantText: string): string {
  return `Write a short, specific title (3–7 words) for this marketing chat. Describe the topic, not the participants. No quotes, no trailing punctuation. Examples: "30-Day Launch Awareness Content Plan", "Instagram Carousel for Product Launch".\n\nUser: ${userText.slice(0, 800)}\n\nAssistant: ${assistantText.slice(0, 800)}\n\nTitle:`;
}

export function cleanGeneratedTitle(raw: string): string | null {
  const cleaned = raw
    .replace(/^["'`“”#*\s]+|["'`“”*\s.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
}
```

- [ ] **Step B4:** `ensureConversation` returns `{ ok: true; created: boolean }`; update its unit test (`ensure-conversation.test.ts`) expectations.

- [ ] **Step B5:** Add query:

```ts
export async function updateConversationTitle(id: string, title: string) {
  await db
    .update(chatConversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(chatConversations.id, id));
}
```

- [ ] **Step B6:** In `route.ts` `onFinish`, after persisting messages, when `ensured.created` and there is a first user message: `generateText({ model: getModel("chat"), prompt: buildTitlePrompt(userText, text) })` → `cleanGeneratedTitle` → `updateConversationTitle`. Wrap in its own try/catch (title failure must not affect the chat).

- [ ] **Step B7: Verify + commit** (`npx vitest run src/app/api/chat`, then full gate, commit `feat(chat): fresh chat by default + AI-generated conversation titles`).

---

### Task C: AI design-request mode + structured briefs (items 4, 10)

**Files:**
- Create: `drizzle/0009_conversation_mode.sql`
- Modify: `src/lib/db/schema.ts` (conversation `mode` enum/column; `design_brief` job kind)
- Modify: `src/lib/db/queries/index.ts` (`createConversation` mode; recent conversations return mode)
- Create: `src/lib/ai/prompts/brief-structures.ts` (shared per-format templates)
- Create: `src/lib/ai/prompts/design-request.ts` (chat + generation prompts)
- Create: `src/lib/ai/design-brief-schema.ts`
- Test: `src/lib/ai/design-brief-schema.test.ts`
- Modify: `src/lib/jobs/run-generation.ts` (`generateDesignBriefWork`; `JobOutcome.resultId` optional)
- Create: `src/app/api/design-brief/generate/route.ts`
- Modify: `src/app/api/chat/route.ts` + `ensure-conversation.ts` (mode-aware)
- Modify: `src/app/(dashboard)/strategy/page.tsx` (read `?mode=design`)
- Modify: `src/app/(dashboard)/strategy/strategy-client.tsx` (mode state, Generate Design Brief, brief panel)
- Create: `src/app/(dashboard)/strategy/design-brief-panel.tsx`
- Modify: `src/app/(dashboard)/strategy/strategy-history.tsx` (mode badge on chats)
- Modify: `src/app/(dashboard)/strategy/prompt-chips.tsx` (design-mode chips)
- Modify: `src/app/(dashboard)/dashboard/page.tsx` ("Request a Design" → `/strategy?mode=design`)
- Modify: `src/app/(dashboard)/design-request/page.tsx` ("New Request" button)
- Modify: `src/lib/ai/prompts/calendar.ts` (structured briefs)
- Modify: `src/app/(dashboard)/calendar/calendar-item-drawer.tsx` (render brief as Markdown)
- Modify: admin ticket detail view (render brief as Markdown — locate under `src/app/admin/tickets`)

**Interfaces:**
- Produces: `ConversationMode = "strategy" | "design"`; chat POST body gains `mode?: ConversationMode`; `designBriefSchema` → `{ title, designType, dimensions?, slides?, briefMarkdown, notes? }`; `POST /api/design-brief/generate` body `{ brandId, conversation, conversationId }` → `202 { jobId }`, job result `{ brief: DesignBrief }`; `BRIEF_STRUCTURES: string` (markdown templates block usable in any prompt).

- [ ] **Step C1: Migration** `drizzle/0009_conversation_mode.sql`:

```sql
CREATE TYPE "public"."conversation_mode" AS ENUM('strategy', 'design');
ALTER TABLE "chat_conversations" ADD COLUMN "mode" "conversation_mode" NOT NULL DEFAULT 'strategy';
ALTER TYPE "public"."generation_job_kind" ADD VALUE IF NOT EXISTS 'design_brief';
```

(Confirm `scripts/migrate.mjs` transaction behavior; on PG12+ ADD VALUE inside a transaction is fine as long as the value isn't used in the same transaction.) Run `node scripts/migrate.mjs` against local DB.

- [ ] **Step C2: Schema + queries.** Add `conversationModeEnum` and `mode` column (default `"strategy"`) to `chatConversations`; add `"design_brief"` to `generationJobKindEnum`. `createConversation` accepts optional `mode`; `getRecentConversationsForBrand` selects `mode`.

- [ ] **Step C3: Brief structures** (`brief-structures.ts`) — exact section lists from the spec for Carousel / Single Static / LinkedIn / Video, exported as one markdown instruction block `BRIEF_STRUCTURES`, plus the rule "adapt the structure to the requested format; include CTA, caption, visual direction, branding notes".

- [ ] **Step C4: Design-request prompts** (`design-request.ts`):
  - `buildDesignRequestChatPrompt(context: ChatBrandContext)`: KO knows the user wants to REQUEST A DESIGN (not a campaign/strategy); gather in 1–2 questions per turn: subject, objective, format (flyer/carousel/banner/…), requirements & branding; once enough is known, summarize and tell the user to click **Generate Design Brief**. Same tone rules as `buildChatPrompt`.
  - `buildDesignBriefSystemPrompt(brand: BrandSummary)` + `buildDesignBriefGenerationPrompt(conversation: string, brand: BrandSummary)`: produce the structured brief object; `briefMarkdown` MUST follow the matching `BRIEF_STRUCTURES` template; `designType` should match one of the standard options when possible (list them).

- [ ] **Step C5: Schema + failing test.** `designBriefSchema` as in Interfaces; test valid parse + rejects empty briefMarkdown + slides bounds (2–10). Run test → fails (no module) → implement → passes.

- [ ] **Step C6: Job work.** In `run-generation.ts`: make `JobOutcome.resultId?: string`; add:

```ts
export async function generateDesignBriefWork(args: {
  brand: BrandRow; conversation: string; userId: string;
}): Promise<JobOutcome> {
  const summary = brandSummaryFrom(args.brand);
  const { object } = await generateObject({
    model: getModel("strategy"),
    schema: designBriefSchema,
    system: buildDesignBriefSystemPrompt(summary),
    prompt: buildDesignBriefGenerationPrompt(args.conversation, summary),
  });
  return { result: { brief: object } };
}
```

- [ ] **Step C7: API route** `src/app/api/design-brief/generate/route.ts` — copy the strategy/generate pattern: auth → rate limit (`design-brief:${userId}`, 10/hr) → validate body → brand ownership → `createGenerationJob({ kind: "design_brief", … })` → `after(executeGenerationJob(...))` → `202 { jobId }`.

- [ ] **Step C8: Mode-aware chat.** Chat route body gains `mode`; validate to `"strategy" | "design"` (default strategy); pick system prompt accordingly; pass mode to `ensureConversation` → `createConversation`.

- [ ] **Step C9: Strategy page + client.** `page.tsx` reads `searchParams` (Promise in Next 15) → `initialMode`. Client: `mode` state; sent in every chat body; design mode changes: welcome bubble copy, design chips, button label **Generate Design Brief** → `handleGenerateBrief` (POST /api/design-brief/generate + poll → `setBrief`), right panel renders `DesignBriefPanel` instead of `StrategyPanel`. `handleSelectConversation` sets mode from the conversation row. "New Chat" keeps current mode.

- [ ] **Step C10: `design-brief-panel.tsx`.** Mirror `StrategyPanel` layout: header "Design Brief", meta rows (type/dimensions/slides), `<Markdown>{brief.briefMarkdown}</Markdown>`, **Request Design** button POSTing `/api/design-tickets` `{ brandId, designType, dimensions, slides, brief: briefMarkdown, notes }`; success state shows ticket number + "View My Tickets" link (`/design-request`); error shown inline; collapsible + mobile drawer props identical to StrategyPanel.

- [ ] **Step C11: Entry points.** Dashboard "Request a Design" card `href: "/strategy?mode=design"`, desc "Chat with KO AI to build a design brief and send it to the design team."; `/design-request` page header gains `New Request` button → same href; empty state button too.

- [ ] **Step C12: Structured calendar briefs.** Append `BRIEF_STRUCTURES` + "write each brief as structured markdown matching its content type" to both calendar prompt builders. Drawer view section renders `<Markdown>{item.brief}</Markdown>`; admin ticket brief view renders Markdown too (edit textareas stay raw).

- [ ] **Step C13: Verify + commit** (full gate; manual: open `/strategy?mode=design`, run a design conversation, generate brief, submit ticket). Commit `feat(design): AI-assisted design request mode with structured briefs`.

---

### Task D: Calendar timeline fix (item 8)

**Files:**
- Modify: `src/lib/ai/calendar-schema.ts` (startDate + dayOffset cap)
- Modify: `src/lib/ai/prompts/calendar.ts` (timeline-aware, today's date)
- Modify: `src/lib/calendar/schedule.ts` (`resolveStartDate`)
- Test: `src/lib/calendar/schedule.test.ts` (extend)
- Modify: `src/lib/jobs/run-generation.ts` (use plan.startDate)

**Interfaces:**
- Produces: `calendarPlanSchema` gains `startDate: string ("YYYY-MM-DD")`; `resolveStartDate(planStartDate: string | undefined, today: Date): Date`.

- [ ] **Step D1: Failing tests** for `resolveStartDate`: valid future date → that UTC midnight; past date → today; malformed → today; >366 days out → today.
- [ ] **Step D2: Implement**:

```ts
export function resolveStartDate(planStartDate: string | undefined, today: Date): Date {
  const todayUtc = utcMidnight(today);
  if (!planStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(planStartDate)) return todayUtc;
  const parsed = new Date(`${planStartDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return todayUtc;
  if (parsed < todayUtc) return todayUtc;
  if (parsed.getTime() - todayUtc.getTime() > 366 * DAY_MS) return todayUtc;
  return parsed;
}
```

- [ ] **Step D3: Schema.** `dayOffset: z.number().int().min(0).max(89)`, plan gains `startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`.
- [ ] **Step D4: Prompts.** Both builders accept `todayIso: string`. System: "Derive the calendar window from the strategy's timeline. Explicit month/dates → use them (next future occurrence if past). Duration only (e.g. '30 days') → start today. No timeline info → 14 days from today. Never exceed 90 days (dayOffset 0–89). Return startDate as YYYY-MM-DD." Generation prompt includes `Today's date: ${todayIso}` and the strategy timeline (already in the JSON).
- [ ] **Step D5: Wire.** `run-generation.ts`: `toCalendarRows(plan, resolveStartDate(plan.startDate, new Date()))`; drop `upcomingMonday` import (keep the function + its tests — still used elsewhere? grep first; delete if orphaned).
- [ ] **Step D6: Verify + commit** — `npx vitest run src/lib/calendar`, full gate, commit `fix(calendar): generate calendars matching the strategy timeline (start date + up to 90 days)`.

---

### Task E: PostHog analytics (item 12)

**Files:**
- Modify: `package.json` (add `posthog-js`, `posthog-node`)
- Create: `src/lib/analytics/posthog-server.ts`
- Create: `src/components/analytics/posthog-provider.tsx` (client pageviews)
- Modify: `src/components/providers.tsx` or `src/app/layout.tsx` (mount provider)
- Modify call sites: `src/app/(auth)/actions.ts` (signup), `src/app/(auth)/auth/callback/route.ts` (Google signup), `src/app/(dashboard)/brand/actions.ts` (brand_brain_started/completed), `src/app/api/chat/route.ts` (chat_started w/ mode), `src/lib/jobs/run-generation.ts` (strategy_generated, calendar_generated, design_brief_generated), `src/app/api/design-tickets/route.ts` (design_ticket_submitted)
- Create: `docs/analytics.md`
- Test: `src/lib/analytics/posthog-server.test.ts` (no-op without key)

**Interfaces:**
- Produces: `captureServerEvent(args: { distinctId: string; event: string; properties?: Record<string, unknown> }): Promise<void>` — resolves immediately when `NEXT_PUBLIC_POSTHOG_KEY` unset; never throws.

- [ ] **Step E1:** `npm install posthog-js posthog-node`.
- [ ] **Step E2: Failing test** — with env unset, `captureServerEvent` resolves without constructing a client (mock `posthog-node`); with key set, calls `captureImmediate` with distinctId/event/properties and swallows errors.
- [ ] **Step E3: Implement `posthog-server.ts`** — lazy singleton `PostHog(key, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com", flushAt: 1, flushInterval: 0 })`; `captureImmediate`; full try/catch.
- [ ] **Step E4: Client provider** — standard Next.js App Router pattern: init posthog-js once (key + host from env, `capture_pageview: false`), `usePathname`/`useSearchParams` effect capturing `$pageview`; render nothing when no key. Mount inside existing `Providers`. Wrap the pageview tracker in `<Suspense>` (useSearchParams requirement).
- [ ] **Step E5: Server events.** At each call site, include `user_id`, `brand_id` (when known) and `session_id` (from the auth session row id when available via `getAuthUser`; check what it returns and thread it — fallback omit). Events: `signed_up`, `brand_brain_started` (first save, draft), `brand_brain_completed` (onboardingStatus → completed), `chat_started` ({ mode }, only when conversation created), `strategy_generated`, `calendar_generated`, `design_brief_generated`, `design_ticket_submitted`. All calls `void`-ed or awaited inside try/catch — never block/fail the request.
- [ ] **Step E6: `docs/analytics.md`** — env vars (`NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`), event dictionary, and the two funnels: signed_up → brand_brain_completed; brand_brain_completed → strategy_generated (same session_id).
- [ ] **Step E7: Verify + commit** — full gate; commit `feat(analytics): PostHog client + server events behind env vars`.

---

### Task F: Final verification

- [ ] `npm run lint && npx tsc --noEmit && npx vitest run` — all green.
- [ ] Run the app; manually drive: dashboard stat links, month default, fresh chat, new-chat naming, design mode end-to-end, calendar generation, mobile-width chat (devtools), no PostHog network calls without keys.
- [ ] Push branch + summarize.

## Self-Review

- Spec coverage: A→items 1,2,3,7,9,11; B→5,6; C→4,10; D→8; E→12. ✔
- Type consistency: `mode` name used in chat body, schema column, and client state; `briefMarkdown` consistent across schema/panel/ticket POST. ✔
- Placeholders: admin ticket brief view location deliberately says "locate under src/app/admin/tickets" — resolved at execution (single grep). ✔

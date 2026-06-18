# KO OS Phase 2 — AI Strategy Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Build the Strategy Workspace at `/strategy` — a brand-grounded AI chat that, on demand, produces a **structured Content Strategy** (per UI spec §2.1), persists it, and hands off to calendar generation (Phase 3). Retire the old `/chat` route.

**Architecture:** Reuse the existing v6 AI stack (`streamText` + `useChat`/`DefaultChatTransport`) for the conversational back-and-forth; add a separate **structured generation** step (`generateObject` + a Zod `strategySchema`) triggered by a "Build Strategy" action. Persist conversations (existing helpers) and strategies (new helpers) and record a `usage_events` row. The structured strategy renders as a card with **Edit** / **Generate Calendar** actions.

**Tech Stack:** Next.js 16, React 19, `ai`@6 + `@ai-sdk/react`@3 + `@ai-sdk/openai`@3 (model `gpt-4o`), Drizzle/Postgres, @base-ui/react, Vitest/RTL, Biome, lucide-react.

**Source of truth:** spec §2.1 (strategy output), §3.1 (strategy-first), §8E (workspace UI), §5.4–5.5 (journey).

**Verification reality:** No `OPENAI_API_KEY` and no `DATABASE_URL` here → the chat route, the generation action, and persistence **cannot be run**. Authoritative gates: `pnpm exec tsc --noEmit`, `pnpm test` (Vitest/RTL on the Zod schema + the strategy card + any pure logic), `pnpm exec biome check`. AI/DB code is type-checked + reviewed only. **This phase in particular should be exercised against a real key + DB before it is trusted** — flagged in the final task.

**Existing API facts (from recon):** `/api/chat` (POST `{messages: UIMessage[], brandContext}`) streams via `streamText({model: chatModel, system, messages: convertToModelMessages(messages)}).toUIMessageStreamResponse()`. `buildChatPrompt(ChatBrandContext)` builds the system prompt. `chatModel`/`campaignModel = openai("gpt-4o")` in `src/lib/ai/provider.ts`. Conversation helpers: `getRecentConversations`, `getConversationMessages`, `createConversation`, `createMessage`. `useChat` v3 returns `{ messages, status, sendMessage, stop, error, regenerate, setMessages }`; messages are `UIMessage` with `parts[]`.

---

## File Structure

**Create:**
- `src/lib/ai/strategy-schema.ts` (+ `.test.ts`) — Zod `strategySchema` + `Strategy` type (§2.1).
- `src/lib/ai/prompts/strategy.ts` — strategist system prompt + structured-generation instruction.
- `src/app/api/strategy/generate/route.ts` — POST: conversation + brandId → `generateObject(strategySchema)` → persist strategy + usage event → return `{ strategy, strategyId }`.
- `src/app/(dashboard)/strategy/page.tsx` — server wrapper (auth + requireBrand + load history).
- `src/app/(dashboard)/strategy/strategy-client.tsx` — `"use client"` workspace (chat + panels).
- `src/app/(dashboard)/strategy/strategy-card.tsx` (+ `.test.tsx`) — renders a structured strategy with Edit / Generate Calendar.
- `src/app/(dashboard)/strategy/prompt-chips.tsx` — suggested prompt chips (empty state).
- `src/app/(dashboard)/strategy/actions.ts` — `generateCalendarHandoff` (persist strategy active + return route) — minimal Phase-2 stub for the Phase-3 handoff.

**Modify:**
- `src/lib/db/queries/index.ts` — add strategy + usage-event helpers.
- `src/app/api/chat/route.ts` — keep, but optionally persist messages (see Task 7); rename system-prompt usage to strategist tone (reuse `buildChatPrompt` or new `buildStrategistPrompt`).
- `src/app/(dashboard)/dashboard/page.tsx` — repoint `/chat` links to `/strategy`.
- `src/lib/supabase/middleware.ts` — `/strategy` already protected (Phase 1); remove `/chat` from protected list (or keep as alias — see Task 8).

**Delete:**
- `src/app/(dashboard)/chat/` (whole dir) — replaced by `/strategy`. (Keep `/api/chat` — the workspace uses it.)

---

## Task 1: Strategy Zod schema (TDD)

**Files:** Create `src/lib/ai/strategy-schema.ts`, `src/lib/ai/strategy-schema.test.ts`.

- [ ] **Step 1: Failing test** — `src/lib/ai/strategy-schema.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { strategySchema } from "./strategy-schema";

const VALID = {
  campaignName: "The Fresh Drop",
  objective: "Drive 300+ pre-orders in 21 days",
  targetAudience: "Women 22-38, urban, skincare-curious",
  keyMessage: "Clean beauty in 3 steps.",
  channels: [{ name: "Instagram", rationale: "Primary buzz" }],
  contentMix: [{ type: "Carousel", count: 6 }],
  timeline: [{ phase: "Teaser", dateRange: "Days 1-7", focus: "Build anticipation" }],
  themes: [{ title: "Behind the Scenes", description: "How we source ingredients" }],
  postingSchedule: [{ channel: "Instagram", cadence: "Tue/Thu 9am" }],
};

describe("strategySchema", () => {
  it("parses a valid strategy", () => {
    expect(strategySchema.parse(VALID)).toMatchObject({ campaignName: "The Fresh Drop" });
  });
  it("requires at least one channel", () => {
    expect(strategySchema.safeParse({ ...VALID, channels: [] }).success).toBe(false);
  });
  it("rejects a missing required scalar", () => {
    const { keyMessage, ...rest } = VALID;
    expect(strategySchema.safeParse(rest).success).toBe(false);
  });
  it("coerces/validates contentMix count as a non-negative integer", () => {
    expect(strategySchema.safeParse({ ...VALID, contentMix: [{ type: "Reel", count: -1 }] }).success).toBe(false);
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/lib/ai/strategy-schema.ts`:
```ts
import { z } from "zod";

export const strategySchema = z.object({
  campaignName: z.string().min(1),
  objective: z.string().min(1),
  targetAudience: z.string().min(1),
  keyMessage: z.string().min(1),
  channels: z
    .array(z.object({ name: z.string().min(1), rationale: z.string() }))
    .min(1),
  contentMix: z
    .array(z.object({ type: z.string().min(1), count: z.number().int().nonnegative() }))
    .min(1),
  timeline: z
    .array(z.object({ phase: z.string().min(1), dateRange: z.string(), focus: z.string() }))
    .min(1),
  themes: z
    .array(z.object({ title: z.string().min(1), description: z.string() }))
    .min(1),
  postingSchedule: z
    .array(z.object({ channel: z.string().min(1), cadence: z.string() }))
    .min(1),
});

export type Strategy = z.infer<typeof strategySchema>;
```
- [ ] **Step 4: Run** → PASS (4).
- [ ] **Step 5: Commit** — biome check both; `git commit -m "feat: add strategy Zod schema"`.

---

## Task 2: Strategy + usage-event query helpers

**Files:** Modify `src/lib/db/queries/index.ts`.

- [ ] **Step 1:** Add imports for `strategies` and `usageEvents` from the schema (extend the existing schema import). Ensure `eq`, `desc` are imported.
- [ ] **Step 2:** Add helpers:
```ts
export async function createStrategy(data: typeof strategies.$inferInsert) {
  const [row] = await db.insert(strategies).values(data).returning();
  return row;
}

export async function getStrategyById(id: string) {
  const [row] = await db.select().from(strategies).where(eq(strategies.id, id)).limit(1);
  return row ?? null;
}

export async function getStrategiesByBrand(brandId: string) {
  return db
    .select()
    .from(strategies)
    .where(eq(strategies.brandId, brandId))
    .orderBy(desc(strategies.updatedAt));
}

export async function updateStrategy(
  id: string,
  data: Partial<Pick<typeof strategies.$inferInsert, "name" | "structured" | "status">>,
) {
  const [row] = await db
    .update(strategies)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(strategies.id, id))
    .returning();
  return row;
}

export async function recordUsageEvent(data: typeof usageEvents.$inferInsert) {
  const [row] = await db.insert(usageEvents).values(data).returning();
  return row;
}
```
- [ ] **Step 3: Verify** `pnpm exec tsc --noEmit` + `pnpm exec biome check src/lib/db/queries/index.ts`.
- [ ] **Step 4: Commit** — `git commit -m "feat: add strategy and usage-event query helpers"`.

---

## Task 3: Strategist prompts

**Files:** Create `src/lib/ai/prompts/strategy.ts`.

- [ ] **Step 1:** Implement two builders. `buildStrategistSystemPrompt(brand)` — a system prompt instructing the AI to act as "KO," a content strategist, to ask a few clarifying questions (goal, audience, platforms, timeline, budget) then recommend, grounded in the brand profile. `buildStrategyGenerationPrompt(conversationText, brand)` — an instruction to produce a complete structured content strategy from the conversation, matching the strategySchema sections, on-brand (tone/audience). Accept a typed `brand` summary object (name, overview, targetAudience, tone, primaryGoal). Keep prompts concise, plain, no placeholders.
```ts
export interface BrandSummary {
  name: string;
  overview?: string | null;
  targetAudience?: string | null;
  tone?: string | null;
  primaryGoal?: string | null;
}

export function buildStrategistSystemPrompt(brand: BrandSummary): string { /* ... */ }
export function buildStrategyGenerationPrompt(conversationText: string, brand: BrandSummary): string { /* ... */ }
```
- [ ] **Step 2: Verify** tsc + biome. **Commit** — `git commit -m "feat: add strategist prompts"`.

---

## Task 4: Strategy card component (TDD)

**Files:** Create `src/app/(dashboard)/strategy/strategy-card.tsx`, `.test.tsx`.

Renders a `Strategy` per §8E "AI Strategy Output Display": STRATEGY badge + campaign name; labeled sections (Objective, Target, Key Message, Channels, Content Mix, Timeline, Themes, Posting Schedule); footer buttons **Edit Strategy** (secondary) + **Generate Calendar** (primary). Card styling: `bg-surface-1`, `border border-[rgba(19,139,200,0.3)]`, left border `border-l-[3px] border-l-primary`, rounded, padded.

**Contract:** `StrategyCard({ strategy, onEdit, onGenerateCalendar, generating }: { strategy: Strategy; onEdit?: () => void; onGenerateCalendar?: () => void; generating?: boolean })`.

- [ ] **Step 1: Failing test** — `strategy-card.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StrategyCard } from "./strategy-card";
import type { Strategy } from "@/lib/ai/strategy-schema";

const S: Strategy = {
  campaignName: "The Fresh Drop",
  objective: "Drive 300+ pre-orders",
  targetAudience: "Women 22-38",
  keyMessage: "Clean beauty in 3 steps",
  channels: [{ name: "Instagram", rationale: "Buzz" }],
  contentMix: [{ type: "Carousel", count: 6 }],
  timeline: [{ phase: "Teaser", dateRange: "Days 1-7", focus: "Anticipation" }],
  themes: [{ title: "BTS", description: "Sourcing" }],
  postingSchedule: [{ channel: "Instagram", cadence: "Tue/Thu" }],
};

describe("StrategyCard", () => {
  it("shows the campaign name and key sections", () => {
    render(<StrategyCard strategy={S} />);
    expect(screen.getByText("The Fresh Drop")).toBeInTheDocument();
    expect(screen.getByText(/Drive 300/)).toBeInTheDocument();
    expect(screen.getByText("Instagram")).toBeInTheDocument();
  });
  it("fires onGenerateCalendar when the primary button is clicked", async () => {
    const onGen = vi.fn();
    render(<StrategyCard strategy={S} onGenerateCalendar={onGen} />);
    await userEvent.click(screen.getByRole("button", { name: /generate calendar/i }));
    expect(onGen).toHaveBeenCalled();
  });
  it("disables the generate button while generating", () => {
    render(<StrategyCard strategy={S} generating onGenerateCalendar={() => {}} />);
    expect(screen.getByRole("button", { name: /generating|generate calendar/i })).toBeDisabled();
  });
});
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** to satisfy the contract + §8E styling. **Step 4: Run** → PASS (3). **Step 5:** biome; `git commit -m "feat: add StrategyCard component"`.

---

## Task 5: Strategy generation route

**Files:** Create `src/app/api/strategy/generate/route.ts`. (AI+DB dependent — tsc + review only.)

- [ ] **Step 1:** POST handler. Body: `{ brandId: string; conversation: string }` (the client sends the flattened conversation text). Steps: `getAuthUser()` (401 if none); load the brand via `getBrandById(brandId)` (404 if not owned/none — verify `brand.userId === dbUser.id`); build a `BrandSummary`; call:
```ts
const { object } = await generateObject({
  model: campaignModel, // gpt-4o
  schema: strategySchema,
  system: buildStrategistSystemPrompt(brand),
  prompt: buildStrategyGenerationPrompt(conversation, brand),
});
```
Persist: `createStrategy({ brandId, name: object.campaignName, structured: object, status: "active" })`; `recordUsageEvent({ userId: dbUser.id, brandId, kind: "strategy_generated", metadata: { strategyId } })`. Return `Response.json({ strategy: object, strategyId })`. Wrap in try/catch → on error return `Response.json({ error: "..." }, { status: 500 })` (the UI shows Try Again). Import `generateObject` from `ai`, `campaignModel` from `@/lib/ai/provider`.
- [ ] **Step 2: Verify** tsc + biome. **Commit** — `git commit -m "feat: add strategy generation route"`.

---

## Task 6: Prompt chips + Strategy workspace UI (§8E)

**Files:** Create `src/app/(dashboard)/strategy/prompt-chips.tsx`, `strategy-client.tsx`, `page.tsx`.

**Acceptance criteria (§8E):**
- `page.tsx` (server): `const { dbUser, brand } = await requireBrand();` (redirects as needed); load recent conversations (`getRecentConversations(dbUser.id)`) + the brand's strategies (`getStrategiesByBrand(brand.id)`) for the history/preview panels; pass a `BrandSummary` + history to `<StrategyClient />`.
- `prompt-chips.tsx`: a `PromptChips({ onPick }: { onPick: (text: string) => void })` rendering the spec chips ("I am launching a new product", "Running a seasonal sale", "Building brand awareness", "Re-engaging customers", "Growing social media", "Content for a new platform") as pill buttons (`rounded-full bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(19,139,200,0.12)]`).
- `strategy-client.tsx` (`"use client"`): full-height layout. Center = chat: empty state (KO icon, "What are you working on?", subtitle, `<PromptChips>`); message list (reuse the existing chat-client bubble rendering: user right `bg-surface-2`, AI left `bg-surface-1` w/ avatar, extract text from `parts`); typing-dots while `status` is submitted/streaming; **error state** with a `Try Again` button (regenerate) when `error` is set; chat input bar (textarea auto-resize, send button, Enter to send / Shift+Enter newline). Uses `useChat({ transport: new DefaultChatTransport({ api: "/api/chat", body: { brandContext } }) })` — memoize the transport with `useMemo` keyed on brandContext (fixes the recon's noted re-creation issue). A **"Build Strategy"** primary button (shown once the conversation has a few messages) flattens `messages` to text and POSTs to `/api/strategy/generate` with `{ brandId, conversation }`; while pending show a loading state; on success, render `<StrategyCard strategy={...} onGenerateCalendar={...} onEdit={...} />` inline at the end of the chat; on error show an inline error + Try Again. Left panel (desktop ≥lg): conversation/strategy history list + "New Strategy" button (clears messages via `setMessages([])`). Right panel (desktop ≥lg, collapsible): strategy preview (the current strategy's sections in a scannable accordion) — only when a strategy exists. Mobile: chat only.
- `onGenerateCalendar`: call the Phase-2 handoff (Task 7) then `router.push("/calendar")`. `onEdit`: clear the rendered card and let the user continue chatting / rebuild.
- A11y: input labelled; buttons have names; `aria-live="polite"` on the AI message region.
- Split into subcomponents if `strategy-client.tsx` exceeds ~250 lines (e.g. `message-list.tsx`, `chat-input.tsx`, `strategy-history.tsx`) and note it.

- [ ] **Step 1:** Create `prompt-chips.tsx`.
- [ ] **Step 2:** Create `strategy-client.tsx` per the criteria (read the existing `src/app/(dashboard)/chat/chat-client.tsx` to reuse its proven v6 `useChat` wiring and bubble rendering).
- [ ] **Step 3:** Create `page.tsx` (server wrapper).
- [ ] **Step 4: Verify** `pnpm exec tsc --noEmit`, `pnpm exec biome check` on the new files, `pnpm test` still green. (Read `provider.ts`, `prompts/chat.ts`, and the existing chat-client for exact APIs before wiring.)
- [ ] **Step 5: Commit** — `git commit -m "feat: add Strategy workspace UI"`.

---

## Task 7: Calendar handoff stub + conversation persistence

**Files:** Create `src/app/(dashboard)/strategy/actions.ts`; optionally modify `src/app/api/chat/route.ts`.

- [ ] **Step 1:** `actions.ts` — a server action `markStrategyActive(strategyId: string)` that sets the strategy `status: "active"` (via `updateStrategy`) and returns `{ ok: true }`; this is the Phase-2 placeholder for the calendar handoff (real calendar generation is Phase 3). The client's `onGenerateCalendar` calls this then routes to `/calendar`.
- [ ] **Step 2 (optional, low-risk):** leave `/api/chat` persistence as-is for Phase 2 (conversation persistence is not required for the strategy flow, which sends the flattened conversation directly). Do NOT add DB writes to the streaming route in this phase to avoid untestable complexity. (Note this decision in the commit.)
- [ ] **Step 3: Verify** tsc + biome. **Commit** — `git commit -m "feat: add calendar handoff stub for strategy"`.

---

## Task 8: Route swap — `/strategy` in, `/chat` out

**Files:** Delete `src/app/(dashboard)/chat/`; modify `src/app/(dashboard)/dashboard/page.tsx`, `src/lib/supabase/middleware.ts`.

- [ ] **Step 1:** `git rm -r "src/app/(dashboard)/chat"`.
- [ ] **Step 2:** In `dashboard/page.tsx` repoint the two `/chat` links → `/strategy` (quick action label "Open AI Chat" → "Open Strategy"; the hardcoded `href="/chat"`).
- [ ] **Step 3:** In `middleware.ts` remove `/chat` from `protectedRoutes` (keep `/strategy`, which is already present). Keep `/api/chat` working (API routes aren't in `protectedRoutes`; confirm the matcher doesn't block it).
- [ ] **Step 4:** `grep -rn "/chat\b" src` → only `/api/chat` references should remain (the workspace transport + the API route itself). Resolve any stale page links.
- [ ] **Step 5: Verify** `pnpm exec tsc --noEmit`, biome on changed files. **Commit** — `git commit -m "feat: replace /chat route with /strategy workspace"`.

---

## Task 9: Phase 2 verification gate + final review

- [ ] **Step 1:** `pnpm exec tsc --noEmit` clean.
- [ ] **Step 2:** `pnpm test` — Phase 0/1 (29) + strategy-schema (4) + strategy-card (3) = ~36 pass.
- [ ] **Step 3:** `pnpm exec biome check` on all Phase-2 files clean.
- [ ] **Step 4:** `grep -rn "/chat\b" src` → only `/api/chat` remains.
- [ ] **Step 5: RUNTIME CAVEAT (must state in report):** the chat stream, `/api/strategy/generate`, and all persistence are UNVERIFIED here (no `OPENAI_API_KEY`, no `DATABASE_URL`). Before trusting Phase 2: set both env vars, apply the migration, and manually exercise: chat replies → Build Strategy → structured card renders → strategy persisted → usage_event written → Generate Calendar handoff. List this as the required manual acceptance.
- [ ] **Step 6:** `git tag phase-2-strategy`.

---

## Self-Review Notes (author)
- **Spec coverage:** §2.1 strategy shape (T1 schema, T4 card, T5 generation), §3.1 strategy-first / §8E workspace (T6), persistence (T2), prompts (T3), handoff (T7), routing (T8).
- **Coherence:** `strategySchema` (T1) ↔ `generateObject` (T5) ↔ `StrategyCard` props (T4) ↔ `structured` jsonb (T2). `requireBrand` (Phase 1) ↔ `page.tsx` (T6). `campaignModel` reused for generation. Transport `api:"/api/chat"` matches the kept route.
- **Deliberate scope limits:** no message persistence in the streaming route (untestable, not needed for strategy gen); real calendar generation is Phase 3 (T7 is a status stub + route to `/calendar`).
- **Biggest risk:** the whole phase is AI/DB-dependent and unrun here — runtime acceptance is mandatory (T9 Step 5) before relying on it.
```
